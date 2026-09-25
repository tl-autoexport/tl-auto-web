/**
 * Record the manually reviewed provisional power estimates from the 2026-09-25
 * Encar AI research remainder. Writes only vehicle_power_automatic_reference;
 * never changes cars, calculations, prices, evidence approvals, or publication.
 * Read-only unless MANUAL_POWER_REFERENCE_WRITE=true.
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Candidate = {
  brand: string; model: string; year: number; engineCc: number; fuelType: string;
  driveType: string | null; badge: string; powerPs: number; listingId: string;
  sourceUrl: string; rationale: string;
};

const candidates: Candidate[] = [
  { brand: "BMW", model: "Gran Turismo", year: 2024, engineCc: 2998, fuelType: "gasoline", driveType: "4WD", badge: "630i xdrive m sport", powerPs: 258, listingId: "42326237", sourceUrl: "https://carlexandria.com/download/51567/?tmstv=1772985662&v=51568", rationale: "Korean-market G32 630i specification; distinguish from 640i's 340 PS. Provisional due to late-registration/model-year nuance." },
  { brand: "BMW", model: "X4", year: 2024, engineCc: 2998, fuelType: "gasoline", driveType: "4WD", badge: "xdrive m40i", powerPs: 387, listingId: "42463665", sourceUrl: "https://www.press.bmwgroup.com/korea/article/detail/T0315685KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EB%89%B4-x3-%EB%B0%8F-%EB%89%B4-x4-%EA%B3%A0%EC%84%B1%EB%8A%A5-%EB%9D%BC%EC%9D%B8%EC%97%85-%EC%B6%9C%EC%8B%9C", rationale: "BMW Korea M40i output in metric PS; prefer Korean-market rated value over a global-market hp conversion." },
  { brand: "BMW", model: "X5", year: 2021, engineCc: 2993, fuelType: "diesel", driveType: "4WD", badge: "xdrive 30d m sport", powerPs: 286, listingId: "42338596", sourceUrl: "https://ro2109.tistory.com/99", rationale: "Korean 2021 xDrive30d 48V mild-hybrid specification; 286 PS is selected over earlier/non-hybrid 265 PS and unrelated-market 249 PS." },
  { brand: "Citroen-DS", model: "DS7", year: 2022, engineCc: 1199, fuelType: "gasoline", driveType: null, badge: "1.2 puretech grand chic", powerPs: 131, listingId: "42533940", sourceUrl: "https://www.kyungjeilbo.com/view/20220607134701555", rationale: "Korean 2022 Grand Chic launch specification reports 131 PS; resolves provider disagreement 131 vs 130 in favor of the local-market figure." },
  { brand: "Ford", model: "Explorer", year: 2021, engineCc: 2956, fuelType: "gasoline", driveType: "4WD", badge: "3.0 platinum 4wd", powerPs: 370, listingId: "42109821", sourceUrl: "https://v.daum.net/v/cgSCwQ3Kit", rationale: "Best-fit Korean-market 3.0 EcoBoost Platinum rating: 370 PS. Do not convert US hp figures into this market rating." },
  { brand: "Ford", model: "Ranger", year: 2025, engineCc: 1996, fuelType: "diesel", driveType: null, badge: "2.0", powerPs: 205, listingId: "42347769", sourceUrl: "https://www.cardong.co.kr/newcar/vehicle/11394", rationale: "Best-fit Korean 2025 2.0 diesel Wildtrak configuration is 205 PS (Bi-Turbo); selected over the 170 PS single-turbo alternative because the Korean-market 2025 listing/model range and local spec align with Wildtrak. Badge does not conclusively identify turbo variant; retain explicitly provisional." },
  { brand: "Genesis", model: "GV70", year: 2021, engineCc: 2151, fuelType: "diesel", driveType: "4WD", badge: "2.2 diesel awd", powerPs: 210, listingId: "42119464", sourceUrl: "https://dpg.danawa.com/news/view?boardSeq=60&listSeq=4627035&past=Y", rationale: "Korean-market 2.2 diesel AWD rating; foreign-market 199–201 PS figures are not applied." },
  { brand: "Genesis", model: "GV70", year: 2023, engineCc: 2151, fuelType: "diesel", driveType: "4WD", badge: "2.2 diesel awd", powerPs: 210, listingId: "42234640", sourceUrl: "https://autocatalogarchive.com/wp-content/uploads/2023/01/Genesis-GV70-2023-KR.pdf", rationale: "Korean 2023 GV70 2.2 diesel AWD catalogue rating: 210 PS." },
  { brand: "Hyundai", model: "Elantra", year: 2026, engineCc: 1598, fuelType: "gasoline", driveType: null, badge: "1.6", powerPs: 123, listingId: "41882260", sourceUrl: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2020-avante-cn7", rationale: "CN7 Smartstream G1.6 rated 123 PS; same 1.6 configuration continues in the current listing year." },
  { brand: "Hyundai", model: "Grandeur", year: 2023, engineCc: 3470, fuelType: "gasoline", driveType: "4WD", badge: "3,5 gasoline 4wd", powerPs: 300, listingId: "42562680", sourceUrl: "https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/catalog/en/grandeur-catalog-eng.pdf", rationale: "GN7 3.5 gasoline AWD Korean catalogue rating: 300 PS; not the 304 PS conversion candidate." },
  { brand: "Hyundai", model: "Tucson", year: 2023, engineCc: 1998, fuelType: "diesel", driveType: "4WD", badge: "diesel 2.0 4wd", powerPs: 186, listingId: "42444569", sourceUrl: "https://www.hyundai.com/kr/ko/vehicles/tucson/20my/specifications.html", rationale: "Best-fit Korean 2.0 diesel AWD rated output is 186 PS. Listing displacement is 1998 cc while Hyundai's spec table may show nominal 1995 cc; keep provisional." },
  { brand: "Hyundai", model: "Tucson", year: 2022, engineCc: 1998, fuelType: "diesel", driveType: "4WD", badge: "diesel 2.0 4wd", powerPs: 186, listingId: "42619032", sourceUrl: "https://www.hyundai.com/kr/ko/vehicles/tucson/20my/specifications.html", rationale: "Best-fit Korean NX4 2.0 diesel AWD rating 186 PS; displacement representation differs slightly across catalogue/listing, so provisional." },
  { brand: "Kia", model: "K9", year: 2024, engineCc: 3778, fuelType: "gasoline", driveType: "4WD", badge: "3.8 gdi awd", powerPs: 315, listingId: "42464557", sourceUrl: "https://www.kia.com/kr/vehicles/k9/specification", rationale: "Kia Korea 3.8 GDI AWD, 3778 cc, 315 PS; distinct from the 3.3T 370 PS version." },
  { brand: "Lincoln", model: "Nautilus", year: 2022, engineCc: 2694, fuelType: "gasoline", driveType: "4WD", badge: "2.7 202a awd", powerPs: 333, listingId: "42627541", sourceUrl: "https://www.premiermotors.co.kr/lincoln/pdf/22_Nautilus_catalog_ko.pdf", rationale: "Korean Nautilus 2.7 AWD 202A catalogue/market rating selected as the best-fit 333 PS; 202A trim is identified, though catalogue excerpt does not independently state output. Provisional, not US-market 335 hp." },
  { brand: "Mercedes-Benz", model: "C-Class", year: 2021, engineCc: 1991, fuelType: "gasoline", driveType: null, badge: "c200 coupe", powerPs: 184, listingId: "42554601", sourceUrl: "https://korexport.co/en/vehicules/2021-mercedes-benz-c-class-nyfe", rationale: "Korean-market C200 Coupe 1.991 cc specification is 184 PS; retained as provisional pending VIN/type code." },
  { brand: "Mercedes-Benz", model: "E-Class", year: 2023, engineCc: 1991, fuelType: "gasoline", driveType: "4WD", badge: "e350 4matic exclusive", powerPs: 299, listingId: "42753231", sourceUrl: "https://semocha.co.kr/entry/2023%EB%85%84-%EB%B2%A4%EC%B8%A0-E%ED%81%B4%EB%9E%98%EC%8A%A4-E350-4MATIC-%EC%A0%95%EB%B3%B4-%EB%B0%8F-%EC%9E%A5%EB%8B%A8%EC%A0%90", rationale: "Korean W213 E350 4MATIC 1.991 cc candidate, 299 PS; secondary-market source, so provisional." },
  { brand: "Mercedes-Benz", model: "GLE", year: 2026, engineCc: 2999, fuelType: "gasoline", driveType: "4WD", badge: "gle450 4matic amg line", powerPs: 381, listingId: "42596896", sourceUrl: "https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20230828.html", rationale: "Korean GLE450 4MATIC rated 381 PS; applies to the 3.0L 48V powertrain, not older 367 PS specification." },
  { brand: "Mercedes-Benz", model: "GLS", year: 2024, engineCc: 3982, fuelType: "gasoline", driveType: "4WD", badge: "gls580 4matic", powerPs: 557, listingId: "42535089", sourceUrl: "https://economyfactory.com/wp-content/uploads/2024/01/Mercedes-Benz_GLS_Catalogue_20231120.pdf", rationale: "Korean GLS580 4MATIC 3,982 cc rating 557 PS; do not use 517 PS converted from a different hp convention." },
  { brand: "Mercedes-Benz", model: "S-Class", year: 2025, engineCc: 2999, fuelType: "gasoline", driveType: "4WD", badge: "s500l 4matic", powerPs: 449, listingId: "42783755", sourceUrl: "https://manuals.plus/m/85043ef5c2397c5554fe508a15051f0121f2f72188800a68babe6fb4e910a797.pdf", rationale: "Korean S500L 4MATIC 2,999 cc market rating 449 PS; provisional pending VIN-specific confirmation." },
  { brand: "Porsche", model: "718", year: 2023, engineCc: 3995, fuelType: "gasoline", driveType: null, badge: "4.0 gts", powerPs: 407, listingId: "42744011", sourceUrl: "https://models.porsche.com/ko-KR/model-start/718", rationale: "Porsche Korea 4.0 GTS rating 407 PS; Cayman/Boxster body distinction does not alter this listed engine output." },
  { brand: "Porsche", model: "Panamera", year: 2026, engineCc: 2894, fuelType: "gasoline", driveType: "4WD", badge: "2.9 awd", powerPs: 360, listingId: "42497493", sourceUrl: "https://www.porsche.com/korea/ko/models/panamera/panamera-models/panamera-4/", rationale: "Porsche Korea Panamera 4 2.9L output 360 PS; prefer local rating over market-dependent hp conversion." },
  { brand: "Volkswagen", model: "Passat", year: 2021, engineCc: 1968, fuelType: "diesel", driveType: "4WD", badge: "2.0 tdi 4motion prestige", powerPs: 190, listingId: "42108281", sourceUrl: "https://web.getcha.kr/cars/%ED%8F%AD%EC%8A%A4%EB%B0%94%EA%B2%90/Passat-GT?gradeId=7862&id=808", rationale: "Korean Passat GT 2.0 TDI 4Motion Prestige rating 190 PS." },
  { brand: "Volkswagen", model: "Passat", year: 2022, engineCc: 1968, fuelType: "diesel", driveType: "4WD", badge: "2.0 tdi 4motion prestige", powerPs: 190, listingId: "42753615", sourceUrl: "https://web.getcha.kr/cars/%ED%8F%AD%EC%8A%A4%EB%B0%94%EA%B2%90/Passat-GT?gradeId=7862&id=808", rationale: "Same Korean 2.0 TDI 4Motion Prestige specification, 190 PS; year is registration/model-year grouping." },
  { brand: "Volvo", model: "XC60", year: 2023, engineCc: 1969, fuelType: "gasoline", driveType: null, badge: "b6 ultimate bright", powerPs: 300, listingId: "42780606", sourceUrl: "https://www.volvocars.com/images/v/-/media/market-assets/korea/applications/localpages/test/spec-and-option-sub-image/xc60/my23-xc60-specifications_v2.pdf", rationale: "Volvo Korea MY23 B6: combustion engine 300 PS plus separate 10 PS motor. Reference stores engine power (300), not an unsupported 310 PS sum." },
  { brand: "Audi", model: "Q7", year: 2021, engineCc: 2967, fuelType: "diesel", driveType: "4WD", badge: "45 tdi quattro premium", powerPs: 231, listingId: "42713077", sourceUrl: "https://admin-bayernauto.d2.co.kr/upload/catalDownload/20210427_1qO_1619524924458.pdf", rationale: "Korean Audi Q7 45 TDI quattro technical specification reports 231 PS; exact local trim and 2,967 cc align." },
  { brand: "BMW", model: "2 Series", year: 2025, engineCc: 1998, fuelType: "gasoline", driveType: "4WD", badge: "m235 xdrive", powerPs: 300, listingId: "42268888", sourceUrl: "https://www.youtube.com/watch?v=qTlfaykldzk", rationale: "F74 M235 xDrive 1998 cc AWD, 221 kW / 300 PS; resolves model disagreement in favor of the Korean-market test's metric rating." },
];

const write = process.env.MANUAL_POWER_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const rows = candidates.map((c) => {
  const configuration_key = [norm(c.brand), norm(c.model), norm(c.fuelType), c.engineCc, norm(c.driveType), norm(c.badge), "", `year=${c.year}-${c.year}`].join("|");
  return {
    configuration_key, brand: c.brand, model: c.model, fuel_type: c.fuelType, engine_cc: c.engineCc,
    drive_type: c.driveType, badge: c.badge, badge_detail: null, year_from: c.year, year_to: c.year,
    power_hp: c.powerPs, power_kw: Number((c.powerPs * 0.73549875).toFixed(4)),
    source: "manual_web_research", status: "automatic",
    note: `Предварительная мощность, ручная сверка корейской/подходящей спецификации; не утверждённая спецификация TKS. Encar listing ${c.listingId}. ${c.rationale} Источник: ${c.sourceUrl}`,
  };
});

async function main() {
  if (rows.length !== 26) throw new Error(`Expected 26 reviewed records, got ${rows.length}`);
  if (new Set(rows.map((r) => r.configuration_key)).size !== rows.length) throw new Error("Duplicate configuration keys; refusing to continue");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const existing = await db.query<{ configuration_key: string; status: string; power_hp: string; source: string }>(
      `select configuration_key,status,power_hp::text,source from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`,
      [rows.map((r) => r.configuration_key)],
    );
    const protectedRows = existing.rows.filter((r) => r.status !== "automatic");
    if (protectedRows.length) throw new Error(`Protected/non-automatic references found; refusing: ${JSON.stringify(protectedRows)}`);
    const existingByKey = new Map(existing.rows.map((r) => [r.configuration_key, r]));
    console.log(JSON.stringify({
      write, manuallyReviewedConfigurations: rows.length,
      newReferences: rows.filter((r) => !existingByKey.has(r.configuration_key)).length,
      existingAutomaticReferences: existing.rows.length,
      changedExistingAutomaticReferences: rows.filter((r) => existingByKey.has(r.configuration_key) && Number(existingByKey.get(r.configuration_key)!.power_hp) !== r.power_hp).length,
      candidates: rows.map(({ configuration_key, brand, model, year_from, engine_cc, drive_type, badge, power_hp, source }) => ({ configuration_key, brand, model, year: year_from, engine_cc, drive_type, badge, power_ps: power_hp, source })),
      effects: { carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publicationsChanged: 0 },
    }, null, 2));
    if (!write) return;
    await db.query("begin");
    await db.query(
      `insert into public.vehicle_power_automatic_reference
        (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
       select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
              x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
       from jsonb_to_recordset($1::jsonb) as x(
         configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
         badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
         source text,status text,note text)
       on conflict (configuration_key) do update set
         power_hp=excluded.power_hp,power_kw=excluded.power_kw,source=excluded.source,note=excluded.note,updated_at=now()
       where vehicle_power_automatic_reference.status='automatic'`, [JSON.stringify(rows)],
    );
    const verify = await db.query<{ count: string }>(
      `select count(*)::text as count from public.vehicle_power_automatic_reference where configuration_key=any($1::text[]) and source='manual_web_research' and status='automatic'`,
      [rows.map((r) => r.configuration_key)],
    );
    if (Number(verify.rows[0]?.count) !== rows.length) throw new Error(`Post-write verification found ${verify.rows[0]?.count}/${rows.length}`);
    await db.query("commit");
    console.log(JSON.stringify({ applied: rows.length, referenceOnly: true, evidenceFinality: "preliminary", carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publicationsChanged: 0 }));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
