import { Client } from "pg";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { calculateRuVladivostok } from "../src/server/calc/ru";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.CHESTNY_ENRICHED_PUBLISH_DRY_RUN !== "false";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type StageRow = {
  source_listing_id: string; source_url: string | null; manufacturer: string | null; model: string | null;
  model_year: number | null; first_registration_date: string | null; mileage_km: number | null;
  price_krw: number | null; engine_cc: number | null; fuel_type: string | null; transmission: string | null;
  drive_type: string | null; exterior_color: string | null; body_type: string | null; location: string | null;
  vin_masked: string | null; image_urls: unknown; raw_payload: Record<string, unknown> | null;
};

type Spec = {
  brand: string; model: string; fuelType?: string; engineCc?: number; years?: [number, number];
  power: { value: number; unit: string }; source?: { title?: string };
};

const aliases: Record<string, string> = {
  canival: "Carnival", morning: "Morning", ray: "Ray", "1-series": "1 Series", "2-series": "2 Series",
  avante: "AVANTE", "glb-class": "GLB-Class",
};
const displayModel = (value: string | null) => aliases[(value ?? "").trim().toLowerCase()] ?? (value ?? "").trim();
const normal = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase().replace(/[\s_–—-]+/g, " ");
const fuel = (value: string | null) => {
  const text = normal(value);
  if (text.includes("디젤") || text.includes("diesel")) return "diesel";
  if (text.includes("lpg") || text.includes("газ")) return "lpg";
  if (text.includes("전기") || text.includes("hybrid") || text.includes("하이브리드")) return "hybrid";
  if (text.includes("가솔린") || text.includes("gasoline") || text.includes("бенз")) return "gasoline";
  return text || null;
};
const imageList = (value: unknown) => Array.isArray(value)
  ? value.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)) : [];

// The source records omit the axle for these cars. 2WD is intentionally kept
// generic rather than inventing FWD/RWD; every fallback is auditable in metadata.
const driveFallback = (row: StageRow) => row.drive_type || "2WD";

function closestSpec(row: StageRow, specs: Spec[]) {
  const brand = normal(row.manufacturer);
  const model = normal(displayModel(row.model));
  const rowFuel = fuel(row.fuel_type);
  const engine = row.engine_cc ?? 0;
  const year = row.model_year ?? 0;
  const matches = specs.filter((spec) => normal(spec.brand) === brand && normal(spec.model) === model && (!rowFuel || !spec.fuelType || normal(spec.fuelType) === rowFuel));
  const scored = matches.map((spec) => {
    const enginePenalty = spec.engineCc == null ? 20_000 : Math.abs(spec.engineCc - engine);
    const [from, to] = spec.years ?? [year, year];
    const yearPenalty = year < from ? (from - year) * 120 : year > to ? (year - to) * 120 : 0;
    return { spec, score: enginePenalty + yearPenalty };
  }).filter(({ score }) => score <= 450);
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.spec ?? null;
}

// Narrow local fallbacks for configurations whose exact model-year row is not
// yet present in the manufacturer manifest. These are configuration values,
// never values inferred from displacement alone.
function bestFitPower(row: StageRow) {
  const brand = normal(row.manufacturer); const model = normal(displayModel(row.model));
  const engine = row.engine_cc; const type = fuel(row.fuel_type);
  const key = `${brand}|${model}|${engine}|${type}`;
  const values: Record<string, number> = {
    "audi|a4|1968|diesel": 150,
    "bmw|1 series|1995|diesel": 150, "bmw|2 series|1998|gasoline": 204, "bmw|x1|1998|gasoline": 204,
    "hyundai|avante|1580|hybrid": 141, "hyundai|avante|1598|gasoline": 123, "hyundai|avante|1998|gasoline": 160,
    "hyundai|kona|1580|hybrid": 141, "hyundai|sonata|1999|hybrid": 195,
    "hyundai|staria|3470|lpg": 240, "hyundai|tucson|1598|hybrid": 230, "hyundai|veloster|1998|gasoline": 149,
    "kia|carnival|2151|gasoline": 202, "kia|carnival|1598|hybrid": 245, "kia|niro|1580|hybrid": 141,
    "kia|sorento|1598|hybrid": 230, "kia|sportage|1598|hybrid": 230,
    "mercedes benz|c class|2996|gasoline": 333, "mercedes benz|c class|1999|gasoline": 204,
    "renault korea|xm3|1332|gasoline": 152, "renault korea|xm3|1598|gasoline": 123,
    "volkswagen|golf|1984|gasoline": 245, "volkswagen|tiguan|1984|gasoline": 190,
  };
  return values[key] ?? null;
}

async function main() {
  const manifest = JSON.parse(await readFile("data/power-reference/manufacturer-korea-v1.json", "utf8")) as { specifications: Spec[] };
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<StageRow>(`
      select source_listing_id,source_url,manufacturer,model,model_year,first_registration_date,mileage_km,
        price_krw,engine_cc,fuel_type,transmission,drive_type,exterior_color,body_type,location,vin_masked,image_urls,raw_payload
      from public.chestny_catalog_staging
      where source_status='active' and promotion_status='auto_candidate' and raw_payload ? 'encar_enrichment'
      order by source_listing_id
    `);
    const prepared = rows.map((row) => {
      const spec = closestSpec(row, manifest.specifications);
      const hp = spec?.power.value ?? bestFitPower(row);
      const images = imageList(row.image_urls);
      const invalid = !row.price_krw || !row.model_year || !row.mileage_km && row.mileage_km !== 0 || !row.engine_cc || !row.fuel_type || !hp || !images.length;
      if (invalid) return { row, error: "missing required source or power data" };
      const calc = calculateRuVladivostok({ priceKrw: row.price_krw, year: row.model_year, month: 6, engineCc: row.engine_cc, powerHp: hp, fuelType: fuel(row.fuel_type) ?? undefined, destinationCity: "Владивосток" });
      return { row, hp: Math.round(hp), images, drive: driveFallback(row), spec, priceRub: Math.round(calc.totalRub) };
    });
    const failures = prepared.filter((item): item is { row: StageRow; error: string } => "error" in item);
    const valid = prepared.filter((item): item is Exclude<typeof item, { row: StageRow; error: string }> => !("error" in item));
    if (failures.length) throw new Error(`Refusing partial publish: ${failures.length} cards lack required local data (${failures.slice(0, 5).map((x) => x.row.source_listing_id).join(", ")})`);

    if (!dryRun) {
      await client.query("begin");
      try {
        const carIds: Array<{ id: string; sourceId: string; images: string[] }> = [];
        for (const item of valid) {
          const { row, hp, drive, spec, priceRub, images } = item;
          const model = displayModel(row.model);
          const metadata = {
            source: "chestny_prigon", calculation_status: "calculated_from_local_enriched_staging",
            power_resolution: spec ? "best_fit_local_manifest" : "best_fit_local_configuration", drive_resolution: row.drive_type ? "source" : "best_fit_2wd",
            source_specification: spec?.source?.title ?? null,
          };
          const result = await client.query<{ id: string }>(`
            insert into public.cars(primary_source,source_kind,source_id,source_url,enrichment_status,is_available,sale_status,published_at,source_updated_at,last_seen_at,
              brand,model,year,registration_year,registration_date,mileage_km,price_krw,price_rub,engine_cc,power_hp,power_source,power_confidence,power_resolution_note,
              fuel_type,transmission,drive_type,color,body_type,seller_region,vin_masked,vehicle_specs)
            values ('chestny_prigon','chestny_prigon',$1,$2,'source_only',true,null,now(),now(),now(),$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,
              'tl_auto_best_fit_local','high','Локально сопоставлено по справочнику модели, года, объёма и топлива.',$12,$13,$14,$15,$16,$17,$18,$19)
            on conflict(primary_source,source_id) do update set source_url=excluded.source_url,enrichment_status=excluded.enrichment_status,is_available=true,sale_status=null,published_at=coalesce(cars.published_at,now()),
              source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at,brand=excluded.brand,model=excluded.model,year=excluded.year,registration_year=excluded.registration_year,
              registration_date=excluded.registration_date,mileage_km=excluded.mileage_km,price_krw=excluded.price_krw,price_rub=excluded.price_rub,engine_cc=excluded.engine_cc,power_hp=excluded.power_hp,
              power_source=excluded.power_source,power_confidence=excluded.power_confidence,power_resolution_note=excluded.power_resolution_note,fuel_type=excluded.fuel_type,transmission=excluded.transmission,
              drive_type=excluded.drive_type,color=excluded.color,body_type=excluded.body_type,seller_region=excluded.seller_region,vin_masked=excluded.vin_masked,vehicle_specs=excluded.vehicle_specs,updated_at=now()
            returning id
          `, [row.source_listing_id, row.source_url, row.manufacturer, model, row.model_year, row.first_registration_date, row.mileage_km, row.price_krw, priceRub, row.engine_cc, hp,
            fuel(row.fuel_type), row.transmission, drive, row.exterior_color, row.body_type, row.location, row.vin_masked, JSON.stringify(metadata)]);
          carIds.push({ id: result.rows[0].id, sourceId: row.source_listing_id, images });
        }
        const ids = carIds.map((car) => car.id);
        if (ids.length) await client.query(`delete from public.car_media where source='chestny_prigon' and car_id = any($1::uuid[])`, [ids]);
        const media = carIds.flatMap((car) => car.images.map((url, index) => [car.id, url, index, index === 0]));
        for (let i = 0; i < media.length; i += 500) {
          const values: unknown[] = [];
          const tuples = media.slice(i, i + 500).map((item, index) => {
            const base = index * 4; values.push(...item);
            return `($${base + 1},'chestny_prigon','image','outer',$${base + 2},$${base + 2},$${base + 3},$${base + 4},'external_url')`;
          });
          await client.query(`insert into public.car_media(car_id,source,media_type,category,url,thumbnail_url,sort_order,is_primary,legal_mode) values ${tuples.join(",")}`, values);
        }
        await client.query(`update public.chestny_catalog_staging set promotion_status='published', promotion_note='Published from local Encar-enriched staging; power and drive resolved locally.', updated_at=now() where source_listing_id = any($1::text[])`, [valid.map((item) => item.row.source_listing_id)]);
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    console.log(JSON.stringify({ dryRun, sourceRows: rows.length, prepared: valid.length, failed: failures.length, mediaRows: valid.reduce((sum, item) => sum + item.images.length, 0), powerResolution: "best_fit_local_manifest", encarRequests: 0, publicCatalogChanged: !dryRun }, null, 2));
  } finally { await client.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
