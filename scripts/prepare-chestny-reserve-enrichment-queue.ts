import { Client } from "pg";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

// The script is read-only unless this explicit switch is supplied. It never
// calls Encar; a created run remains awaiting_approval until a separate,
// user-approved worker starts it.
const write = process.env.CHESTNY_QUEUE_DRY_RUN === "false";
const requestedLimit = Math.max(1, Number(process.env.CHESTNY_QUEUE_LIMIT ?? 3017));
const rulesVersion = "reserve-local-v1";

const quota: Record<string, number> = {
  Hyundai: 1400, Kia: 1000, "Mercedes-Benz": 500, Chevrolet: 350, Volkswagen: 350,
  BMW: 300, Audi: 250, MINI: 250, "Land Rover": 250, KGM: 200, "Renault Korea": 150,
};
const aliases: Record<string, string> = {
  canival: "Carnival", santafe: "Santa Fe", ray: "Ray", morning: "Morning",
  tiboli: "Tivoli", "x2 (f39)": "X2", "1-series": "1 Series", "2-series": "2 Series",
};
const normalize = (value: string | null) => aliases[(value ?? "").trim().toLowerCase()] ?? (value ?? "").trim();
const key = (value: string | null) => normalize(value).toLowerCase().replace(/[\s_-]+/g, "");
const fuel = (value: string | null) => {
  const raw = (value ?? "").toLowerCase();
  if (raw.includes("디젤") || raw.includes("diesel")) return "diesel";
  if (raw.includes("전기") || raw.includes("electric")) return "electric";
  if (raw.includes("하이브리드") || raw.includes("hybrid")) return "hybrid";
  if (raw.includes("가솔린") || raw.includes("gas")) return "gasoline";
  return null;
};
const images = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item)).length
  : 0;
const sourceEncarId = (value: string | null) => value?.match(/[?&]carid=(\d+)/i)?.[1] ?? null;

type StageRow = {
  source_listing_id: string;
  source_url: string | null;
  manufacturer: string | null;
  model: string | null;
  model_year: number | null;
  mileage_km: number | null;
  price_krw: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  exterior_color: string | null;
  image_urls: unknown;
  source_updated_at: string | null;
  last_seen_at: string | null;
  imported_at: string | null;
};

type Candidate = StageRow & { brand: string; modelName: string; freshness: string; imageCount: number };

async function main() {
  const inventory = JSON.parse(await readFile("docs/chestny-required-models-audit.json", "utf8")) as {
    groups: Array<{ manufacturer: string; requestedModel: string }>;
  };
  const requestedModels = new Set(inventory.groups.map((group) => `${key(group.manufacturer)}|${key(group.requestedModel)}`));
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // Use sequential queries on this single client. pg serializes them either
    // way, and this avoids an ambiguous concurrent-query warning in the audit.
    const stagingResult = await client.query<StageRow>(`
        select source_listing_id,source_url,manufacturer,model,model_year,mileage_km,price_krw,
               engine_cc,fuel_type,transmission,drive_type,exterior_color,image_urls,
               source_updated_at,last_seen_at,imported_at
          from public.chestny_catalog_staging
         where source_status='active'
           and promotion_status not in ('published','rejected','auto_rejected','source_unavailable')
      `);
    const activeResult = await client.query<{ source_id: string; brand: string | null }>(`
        select source_id,brand from public.cars
         where is_available=true and primary_source in ('encar','chestny_prigon')
      `);
    const existingQueueResult = await client.query<{ source_listing_id: string }>(`
        select source_listing_id from public.catalog_enrichment_queue
         where source='chestny_catalog_staging'
           and status in ('queued','leased','succeeded','unavailable')
      `);

    const activeIds = new Set(activeResult.rows.map((row) => row.source_id));
    const alreadyQueued = new Set(existingQueueResult.rows.map((row) => row.source_listing_id));
    const seen = new Set<string>();
    const localCandidates: Candidate[] = [];
    const exclusionCounts: Record<string, number> = {};
    const exclude = (reason: string) => { exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1; };

    for (const row of stagingResult.rows) {
      const brand = normalize(row.manufacturer);
      const modelName = normalize(row.model);
      if (!requestedModels.has(`${key(brand)}|${key(modelName)}`)) { exclude("not_in_customer_model_list"); continue; }
      if (activeIds.has(row.source_listing_id)) { exclude("already_in_public_catalog"); continue; }
      if (alreadyQueued.has(row.source_listing_id)) { exclude("already_queued_or_finalized"); continue; }
      if (seen.has(row.source_listing_id)) { exclude("duplicate_source_listing_id"); continue; }
      if (!sourceEncarId(row.source_url)) { exclude("missing_encar_id"); continue; }
      if (!row.model_year || row.model_year < 2015) { exclude("invalid_year"); continue; }
      if (row.mileage_km == null || row.mileage_km < 0) { exclude("missing_mileage"); continue; }
      if (!row.price_krw || row.price_krw <= 0) { exclude("missing_price"); continue; }
      if (!row.engine_cc || row.engine_cc <= 0) { exclude("missing_engine_cc"); continue; }
      const freshness = row.source_updated_at ?? row.last_seen_at ?? row.imported_at;
      if (!freshness || Number.isNaN(Date.parse(freshness))) { exclude("missing_freshness"); continue; }
      seen.add(row.source_listing_id);
      localCandidates.push({ ...row, brand, modelName, freshness, imageCount: images(row.image_urls) });
    }

    const currentByBrand = Object.fromEntries(Object.keys(quota).map((brand) => [
      brand, activeResult.rows.filter((row) => row.brand === brand).length,
    ]));
    const selected: Candidate[] = [];
    const selectedByBrand: Record<string, number> = {};
    localCandidates.sort((a, b) => Date.parse(b.freshness) - Date.parse(a.freshness) || b.imageCount - a.imageCount || a.source_listing_id.localeCompare(b.source_listing_id));
    for (const candidate of localCandidates) {
      if (selected.length >= requestedLimit) break;
      const room = (quota[candidate.brand] ?? 0) - (currentByBrand[candidate.brand] ?? 0) - (selectedByBrand[candidate.brand] ?? 0);
      if (room <= 0) continue;
      selected.push(candidate);
      selectedByBrand[candidate.brand] = (selectedByBrand[candidate.brand] ?? 0) + 1;
    }

    const summary = {
      encarRequests: 0,
      dryRun: !write,
      sourceRows: stagingResult.rowCount,
      locallyEligible: localCandidates.length,
      selectedForQueue: selected.length,
      requestedLimit,
      excluded: exclusionCounts,
      selectedByBrand,
      selectedWithLocalPhotos: selected.filter((row) => row.imageCount > 0).length,
      selectedWithFuel: selected.filter((row) => fuel(row.fuel_type) != null).length,
      selectedWithDrive: selected.filter((row) => Boolean(row.drive_type)).length,
      selectedWithColor: selected.filter((row) => Boolean(row.exterior_color)).length,
      note: "Queue is local-only. No Encar request is sent until a run is explicitly approved.",
    };

    if (!write) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await client.query("begin");
    try {
      const run = await client.query<{ id: string }>(`
        insert into public.catalog_enrichment_runs(source,status,requested_limit,candidate_count,local_rules_version,summary)
        values ('chestny_catalog_staging','awaiting_approval',$1,$2,$3,$4::jsonb)
        returning id
      `, [requestedLimit, selected.length, rulesVersion, JSON.stringify(summary)]);
      const runId = run.rows[0]?.id;
      if (!runId) throw new Error("Queue run was not created");
      for (let offset = 0; offset < selected.length; offset += 250) {
        const batch = selected.slice(offset, offset + 250);
        const values: unknown[] = [];
        const tuples = batch.map((row, index) => {
          const base = index * 5;
          values.push(
            runId,
            row.source_listing_id,
            row.source_url,
            JSON.stringify({
              brand: row.brand, model: row.modelName, year: row.model_year, mileageKm: row.mileage_km,
              priceKrw: row.price_krw, engineCc: row.engine_cc, fuel: fuel(row.fuel_type),
              transmission: row.transmission, drive: row.drive_type, color: row.exterior_color,
              imageCount: row.imageCount, freshness: row.freshness, encarId: sourceEncarId(row.source_url),
            }),
            new Date().toISOString(),
          );
          return `($${base + 1},'chestny_catalog_staging',$${base + 2},$${base + 3},'queued',0,$${base + 4}::jsonb,$${base + 5})`;
        }).join(",");
        await client.query(`
          insert into public.catalog_enrichment_queue(run_id,source,source_listing_id,source_url,status,attempt_count,candidate_snapshot,created_at)
          values ${tuples}
          on conflict(source,source_listing_id) do nothing
        `, values);
      }
      await client.query("commit");
      console.log(JSON.stringify({ ...summary, runId, runStatus: "awaiting_approval" }, null, 2));
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
