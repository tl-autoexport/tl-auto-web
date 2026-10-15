/** Rebuild Encar option presence from the saved run payload; no listing requests. */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import { mapEncarOptions, type EncarOptionCatalog } from "../src/server/imports/encar-options";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
const write = process.env.TL_AUTO_ENCAR_OPTION_REPAIR_WRITE === "true";
const catalogFile = process.env.TL_AUTO_STANDARD_OPTION_CATALOG?.trim();
const dbUrl = process.env.SUPABASE_DB_URL;
if (!runId) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID is required");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const key = (row: { category: string; name_original: string | null; price_krw: number | string | null }) =>
  `${row.category.toLocaleLowerCase()}|${(row.name_original ?? "").trim().toLocaleLowerCase()}|${row.price_krw == null ? "" : String(row.price_krw)}`;

async function main() {
  let catalog: EncarOptionCatalog;
  if (catalogFile) {
    catalog = JSON.parse(await readFile(catalogFile, "utf8")) as EncarOptionCatalog;
  } else {
    if (!process.env.ENCAR_PROXY_URL?.trim() || process.env.ENCAR_PROXY_REQUIRED !== "true") {
      throw new Error("A saved option catalog or ENCAR_PROXY_URL with ENCAR_PROXY_REQUIRED=true is required");
    }
    catalog = await fetchStandardOptionCatalog();
  }
  if (!Array.isArray(catalog.options) || catalog.options.length === 0) throw new Error("Encar standard option catalog is empty");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await db.connect();
  try {
    const cars = (await db.query<{ id: string; source_id: string; raw_payload: Obj }>(`
      select c.id,c.source_id,s.raw_payload
      from public.cars c
      join public.encar_enrichment_staging s
        on s.run_id=$1::uuid and s.source_listing_id=c.source_id and s.source='encar'
      where c.primary_source='encar' and c.vehicle_specs->>'enrichment_run_id'=$1::text
      order by c.source_id`, [runId])).rows;
    if (!cars.length) throw new Error(`No published Encar cards found for run ${runId}`);

    const carIds = cars.map((car) => car.id);
    const existing = (await db.query<{
      id: string; car_id: string; category: string; source_code: string | null;
      name_original: string | null; price_krw: string | null; is_present: boolean | null;
    }>(`select id,car_id,category,source_code,name_original,price_krw,is_present
      from public.car_options where source='encar' and car_id=any($1::uuid[]) order by car_id,sort_order,id`, [carIds])).rows;
    const existingByCar = new Map<string, typeof existing>();
    for (const row of existing) existingByCar.set(row.car_id, [...(existingByCar.get(row.car_id) ?? []), row]);

    const updates: Array<{ id: string; is_present: boolean | null }> = [];
    const perCarCounts: Record<string, number> = {};
    for (const car of cars) {
      const payload = obj(car.raw_payload);
      const detail = obj(payload.detail);
      const optionData = obj(detail.options);
      const standardCodes = Array.isArray(optionData.standard) ? optionData.standard.map(String) : [];
      const selectedChoiceCodes = Array.isArray(optionData.choice) ? optionData.choice.map(String) : undefined;
      const mapped = mapEncarOptions(catalog, standardCodes, payload.choiceOptions, selectedChoiceCodes);
      const mappedByKey = new Map<string, (typeof mapped)[number]>();
      for (const option of mapped) {
        const optionKey = key(option);
        if (mappedByKey.has(optionKey)) throw new Error(`Duplicate reconstructed option for listing ${car.source_id}: ${optionKey}`);
        mappedByKey.set(optionKey, option);
      }
      const rows = existingByCar.get(car.id) ?? [];
      if (rows.length !== mapped.length) {
        throw new Error(`Option row mismatch for ${car.source_id}: database=${rows.length}, reconstructed=${mapped.length}`);
      }
      const seen = new Set<string>();
      for (const row of rows) {
        const optionKey = key(row);
        const reconstructed = mappedByKey.get(optionKey);
        if (!reconstructed || seen.has(optionKey)) throw new Error(`Cannot uniquely match saved option for listing ${car.source_id}: ${optionKey}`);
        seen.add(optionKey);
        updates.push({ id: row.id, is_present: reconstructed.is_present });
        const state = String(reconstructed.is_present);
        perCarCounts[state] = (perCarCounts[state] ?? 0) + 1;
      }
      if (seen.size !== mappedByKey.size) throw new Error(`Unmatched reconstructed options for listing ${car.source_id}`);
    }
    if (existing.length !== updates.length) throw new Error(`Run option row scope mismatch: database=${existing.length}, reconstructed=${updates.length}`);

    const oldCounts = { true: 0, false: 0, null: 0 };
    const newCounts = { true: 0, false: 0, null: 0 };
    const currentById = new Map(existing.map((row) => [row.id, row.is_present]));
    for (const update of updates) {
      const previous = currentById.get(update.id);
      const oldState = previous == null ? "null" : String(previous);
      const newState = String(update.is_present);
      oldCounts[oldState as keyof typeof oldCounts]++;
      newCounts[newState as keyof typeof newCounts]++;
    }
    const changed = updates.filter((update) => currentById.get(update.id) !== update.is_present).length;
    const report = { runId, dryRun: !write, publishedCars: cars.length, optionRows: existing.length,
      changedRows: changed, oldPresenceCounts: oldCounts, correctedPresenceCounts: newCounts,
      correctedRowsPerState: perCarCounts, listingRequests: 0, source: "saved encar_enrichment_staging.raw_payload" };
    if (!write) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-encar-option-presence-repair'))");
      const result = await db.query(`with patch as (
        select * from jsonb_to_recordset($1::jsonb) as p(id uuid,is_present boolean)
      ) update public.car_options o set is_present=p.is_present
        from patch p where o.id=p.id and o.source='encar' and o.is_present is distinct from p.is_present`, [JSON.stringify(updates)]);
      if (result.rowCount !== changed) throw new Error(`Expected ${changed} option updates, wrote ${result.rowCount}`);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }

    const after = await db.query(`select is_present,count(*)::int as rows,count(distinct car_id)::int as cars
      from public.car_options where source='encar' and car_id=any($1::uuid[]) group by is_present order by is_present nulls first`, [carIds]);
    console.log(JSON.stringify({ ...report, dryRun: false, writtenRows: changed, verifiedPresenceCounts: after.rows }, null, 2));
  } finally {
    await db.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
