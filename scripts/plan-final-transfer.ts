/**
 * Single dry-run for the final transfer: exact ids and a reason per block.
 *
 * Sources:
 *   * Encar — the already collected run `bce9455e` (staging payloads + `result.probes`),
 *     never a new network request; readiness comes from `probes` and from the payload
 *     content, not from `succeeded` or `result.blocks`;
 *   * Chestny — the live database, as the already verified transfer.
 *
 * Decisions are computed against the *current* database state, not against the run
 * snapshot, so a card filled meanwhile is reported as `already_filled` and skipped.
 *
 * Nothing is written. The full id lists go to `output/final-transfer-plan-<ts>.json`.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import {
  asArray, asRow, historyIsAvailable, inspectionItemsFrom, isOptionRowDisplayable,
  optionRowsFromCodes, optionRowsFromChoice,
} from "../src/server/chestny/blocks";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const chestnyUrl = process.env.CHESTNY_SUPABASE_URL?.replace(/\/$/, "");
const chestnyKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
const runId = process.env.FINAL_TRANSFER_ENCAR_RUN_ID ?? "bce9455e-32b0-4180-95fe-2106f8394d42";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!chestnyUrl || !chestnyKey) throw new Error("Chestny credentials are required");

type Row = Record<string, unknown>;
const obj = asRow;
const arr = asArray;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

type Counts = { candidates: number; write: number; alreadyFilled: number; excluded: number; notFound: number; probeNotReady: number; emptyContent: number; noStructure: number; noData: number };
const newCounts = (): Counts => ({ candidates: 0, write: 0, alreadyFilled: 0, excluded: 0, notFound: 0, probeNotReady: 0, emptyContent: 0, noStructure: 0, noData: 0 });

async function chestnyIn(table: string, select: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const filter = `source_listing_id=in.(${chunk.map((id) => `"${id}"`).join(",")})`;
    for (let offset = 0; ; offset += 1000) {
      const url = `${chestnyUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filter}&limit=1000&offset=${offset}`;
      const response = await fetch(url, { headers: { apikey: chestnyKey!, Authorization: `Bearer ${chestnyKey}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`Chestny ${table} HTTP ${response.status}`);
      const page = await response.json() as Row[];
      out.push(...page);
      if (page.length < 1000) break;
    }
  }
  return out;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const ids: Record<string, string[]> = { encarGallery: [], encarOptions: [], encarInspection: [], chestnyOptions: [], chestnyHistory: [], chestnyInspection: [] };
  const checks: Record<string, Counts> = {
    encarGallery: newCounts(), encarOptions: newCounts(), encarInspection: newCounts(),
    chestnyOptions: newCounts(), chestnyHistory: newCounts(), chestnyInspection: newCounts(),
  };
  const result: Record<string, unknown> = { readOnly: true, databaseWrites: 0, encarListingRequests: 0, encarStaticCatalogs: 1, encarRunId: runId };
  try {
    await db.query("begin read only");
    // Current state of every active Chestny card, keyed by the Encar listing id in its URL.
    const cars = (await db.query<{
      id: string; source_id: string; listing_id: string | null;
      has_encar_gallery: boolean; has_encar_options: boolean; has_encar_inspection: boolean;
      has_any_options: boolean; has_any_structured_report: boolean; has_chestny_history: boolean;
      no_history: boolean;
    }>(`
      select c.id, c.source_id, substring(c.source_url from '[0-9]{6,}') as listing_id,
             exists (select 1 from public.car_media m where m.car_id = c.id and m.source = 'encar') as has_encar_gallery,
             exists (select 1 from public.car_options o where o.car_id = c.id and o.source = 'encar') as has_encar_options,
             exists (select 1 from public.car_condition_reports r where r.car_id = c.id and r.source = 'encar'
                     and r.report_type = 'encar_inspection') as has_encar_inspection,
             exists (select 1 from public.car_options o where o.car_id = c.id) as has_any_options,
             exists (select 1 from public.car_condition_reports r where r.car_id = c.id
                     and r.items is not null and r.items <> '[]'::jsonb) as has_any_structured_report,
             exists (select 1 from public.car_condition_reports r where r.car_id = c.id and r.source = 'chestny'
                     and r.report_type = 'chestny_carhistory') as has_chestny_history,
             (c.accident_count is null and c.insurance_payout_count is null) as no_history
      from public.cars c
      where c.is_available and c.primary_source = 'chestny_prigon'`)).rows;
    await db.query("rollback");

    const carByListing = new Map(cars.filter((car) => car.listing_id).map((car) => [car.listing_id!, car]));

    // ---------- Encar side: from the stored run only ----------
    const queue = (await db.query<{ source_listing_id: string; status: string; result: Row | null }>(`
      select source_listing_id, status, result from public.encar_enrichment_queue where run_id = $1`, [runId])).rows;
    const staging = (await db.query<{ source_listing_id: string; raw_payload: Row | null }>(`
      select source_listing_id, raw_payload from public.encar_enrichment_staging where run_id = $1`, [runId])).rows;
    const payloadByListing = new Map(staging.map((row) => [row.source_listing_id, row.raw_payload]));

    const probeReady = (result: Row | null, block: string) => {
      const probe = block === "inspection" ? "inspection" : block === "gallery" ? "detail" : block;
      return String(obj(obj(obj(result).probes)[probe]).classification ?? "") === "ready";
    };

    for (const row of queue) {
      const car = carByListing.get(row.source_listing_id);
      const exclusion = String(obj(row.result).exclusion ?? "none");
      const payload = payloadByListing.get(row.source_listing_id);
      const detail = obj(obj(payload).detail);
      const photos = Array.isArray(detail.photos) ? detail.photos.length : 0;
      const choiceOptions = Array.isArray(obj(payload).choiceOptions) ? (obj(payload).choiceOptions as unknown[]).length : 0;
      const inspection = obj(obj(payload).inspection);
      const inners = Array.isArray(inspection.inners) ? inspection.inners.length : 0;
      const probes = obj(obj(row.result).probes);

      for (const block of ["encarGallery", "encarOptions", "encarInspection"] as const) {
        const counts = checks[block];
        counts.candidates++;
        if (exclusion !== "none") { counts.excluded++; continue; }
        if (String(obj(probes.detail).status ?? "") === "404" || !car) { counts.notFound++; continue; }
        if (!probeReady(row.result, block === "encarGallery" ? "gallery" : block === "encarOptions" ? "options" : "inspection")) { counts.probeNotReady++; continue; }
        if (block === "encarGallery" && car.has_encar_gallery) { counts.alreadyFilled++; continue; }
        if (block === "encarOptions" && car.has_encar_options) { counts.alreadyFilled++; continue; }
        if (block === "encarInspection" && car.has_encar_inspection) { counts.alreadyFilled++; continue; }
        const hasContent = block === "encarGallery" ? photos > 0 : block === "encarOptions" ? choiceOptions > 0 : inners > 0;
        if (!hasContent) { counts.emptyContent++; continue; }
        counts.write++;
        ids[block].push(`${car.source_id} (listing ${row.source_listing_id})`);
      }
    }

    // ---------- Chestny side ----------
    const chestnyIds = cars.map((car) => car.source_id);
    const vehicles = await chestnyIn("vehicles", "source_listing_id,status,is_public", chestnyIds);
    const meta = await chestnyIn("catalog_vehicles", "source_listing_id,report_options,inspection_summary,accident_summary", chestnyIds);
    const vehicleBySource = new Map(vehicles.map((row) => [String(row.source_listing_id), row]));
    const metaBySource = new Map(meta.map((row) => [String(row.source_listing_id), row]));
    const optionCatalog = await fetchStandardOptionCatalog();

    for (const car of cars) {
      const vehicle = vehicleBySource.get(car.source_id);
      const row = metaBySource.get(car.source_id);
      const publicActive = vehicle && String(vehicle.status) === "active" && vehicle.is_public === true;
      const summary = obj(row?.inspection_summary);
      const accident = obj(row?.accident_summary);

      const optionRows = publicActive ? [...optionRowsFromCodes(optionCatalog, arr(summary.standardOptionCodes).map(String)), ...optionRowsFromChoice(row?.report_options)].filter(isOptionRowDisplayable) : [];
      checks.chestnyOptions.candidates++;
      if (!publicActive) checks.chestnyOptions.excluded++;
      else if (car.has_any_options) checks.chestnyOptions.alreadyFilled++;
      else if (!optionRows.length) checks.chestnyOptions.noData++;
      else { checks.chestnyOptions.write++; ids.chestnyOptions.push(car.source_id); }

      checks.chestnyHistory.candidates++;
      if (!publicActive) checks.chestnyHistory.excluded++;
      else if (car.has_chestny_history || !car.no_history) checks.chestnyHistory.alreadyFilled++;
      else if (!historyIsAvailable(accident)) checks.chestnyHistory.noData++;
      else { checks.chestnyHistory.write++; ids.chestnyHistory.push(car.source_id); }

      const items = publicActive ? inspectionItemsFrom(summary) : [];
      checks.chestnyInspection.candidates++;
      if (!publicActive) checks.chestnyInspection.excluded++;
      else if (car.has_any_structured_report) checks.chestnyInspection.alreadyFilled++;
      else if (!items.length) checks.chestnyInspection.noStructure++;
      else { checks.chestnyInspection.write++; ids.chestnyInspection.push(car.source_id); }
    }

    result.checks = checks;
    result.totals = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.write]));
    result.idLists = Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value.length]));
    const artifact = `output/final-transfer-plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, JSON.stringify({ ...result, ids }, null, 2));
    result.artifact = artifact;
    result.samples = Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value.slice(0, 5)]));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
