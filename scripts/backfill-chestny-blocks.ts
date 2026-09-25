/**
 * Transfer confirmed Chestny blocks into TL Auto — hardened transfer.
 *
 * Scope, as approved: options -> `car_options` source='chestny'; history and
 * inspection -> `car_condition_reports` source='chestny' with Chestny-specific
 * report_types. `cars` counters are not written at this stage.
 *
 * Safety rules, changed deliberately after review:
 *   * nothing is deleted and nothing is updated in place: a block that already has
 *     Chestny data is skipped and the reason is recorded;
 *   * emptiness is checked atomically with the insert (`insert ... select ... where
 *     not exists`), so the check cannot race the write;
 *   * only displayable, non-empty content is written — an option whose name cannot be
 *     shown and an inspection without structure are skipped, never stored invisible;
 *   * a source that reports `available=false` gets no report and no zeros; the state
 *     stays in sync accounting;
 *   * each card is written in one transaction, and the ids of every inserted row go
 *     into a batch manifest, which is the only reliable rollback handle
 *     (`car_options` has no raw_payload).
 *
 * There is no `applied_at` here: the source is the live Chestny database, not a
 * staging row. `applied_at` belongs to the Encar applier, where it is written inside
 * the same transaction as the data.
 *
 * Dry-run by default. CHESTNY_BACKFILL_WRITE=true enables the write.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchStandardOptionCatalog, type EncarOptionCatalog, type EncarOptionRow } from "../src/server/imports/encar";
import {
  asArray, asRow, historyIsAvailable, historySummaryFrom, inspectionItemsFrom,
  isOptionRowDisplayable, optionRowsFromCodes, optionRowsFromChoice,
} from "../src/server/chestny/blocks";

config({ path: ".env.local", override: true, quiet: true });
const tlUrl = process.env.SUPABASE_DB_URL;
const chestnyUrl = process.env.CHESTNY_SUPABASE_URL?.replace(/\/$/, "");
const chestnyKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
if (!tlUrl) throw new Error("SUPABASE_DB_URL is required");
if (!chestnyUrl || !chestnyKey) throw new Error("Chestny credentials are required");

const write = process.env.CHESTNY_BACKFILL_WRITE === "true";
const limit = Math.max(0, Number(process.env.CHESTNY_BACKFILL_LIMIT ?? 0));
const blocks = new Set((process.env.CHESTNY_BACKFILL_BLOCKS ?? "options,history,inspection").split(",").map((value) => value.trim()).filter(Boolean));

type TlCar = { id: string; source_id: string; no_options: boolean; no_meaningful_report: boolean; no_history: boolean };
type ChestnyRow = Record<string, unknown>;
type Plan = {
  car: TlCar;
  options: EncarOptionRow[] | null;
  history: { summary: Record<string, unknown>; raw: ChestnyRow } | null;
  inspection: { summary: Record<string, unknown>; items: unknown[]; raw: ChestnyRow } | null;
};

async function chestnyIn(table: string, select: string, ids: string[]): Promise<ChestnyRow[]> {
  const out: ChestnyRow[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const filter = `source_listing_id=in.(${chunk.map((id) => `"${id}"`).join(",")})`;
    for (let offset = 0; ; offset += 1000) {
      const url = `${chestnyUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filter}&limit=1000&offset=${offset}`;
      const response = await fetch(url, { headers: { apikey: chestnyKey!, Authorization: `Bearer ${chestnyKey}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`Chestny ${table} HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
      const page = await response.json() as ChestnyRow[];
      out.push(...page);
      if (page.length < 1000) break;
    }
  }
  return out;
}

async function main() {
  // A remote database with no statement/query timeout turns a network stall into a
  // silent hang (observed: the run stopped mid-batch and never wrote again). These
  // bounds convert a stall into an error, which the per-card catch rolls back.
  const db = new Client({
    connectionString: tlUrl, ssl: { rejectUnauthorized: false },
    statement_timeout: 30000, query_timeout: 30000, connectionTimeoutMillis: 15000, keepAlive: true,
  });
  await db.connect();
  const result: Record<string, unknown> = { write, limit: limit || "all", blocks: [...blocks], carsTableTouched: false };
  const batchId = `chestny-transfer-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const manifestPath = `output/${batchId}.jsonl`;
  const details: Array<Record<string, unknown>> = [];
  // Header before the first commit and one line per card after its commit: a crash can
  // lose at most the card in flight, never the ids of rows already written.
  const startManifest = () => {
    if (!write) return;
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify({ batchId, source: "chestny_live", kind: "header" })}\n`);
  };
  const appendManifest = (detail: Record<string, unknown>) => {
    if (!write) return;
    appendFileSync(manifestPath, `${JSON.stringify(detail)}\n`);
  };
  startManifest();

  try {
    await db.query("begin read only");
    const cars = (await db.query<TlCar>(`
      select c.id, c.source_id,
             (not exists (select 1 from public.car_options o where o.car_id = c.id)) as no_options,
             (not exists (select 1 from public.car_condition_reports r
                          where r.car_id = c.id and r.items is not null and r.items <> '[]'::jsonb)) as no_meaningful_report,
             (c.accident_count is null and c.insurance_payout_count is null
              and not exists (select 1 from public.car_condition_reports r
                              where r.car_id = c.id and r.source = 'chestny'
                                and r.report_type = 'chestny_carhistory')) as no_history
      from public.cars c
      where c.is_available and c.primary_source = 'chestny_prigon'
      order by c.source_id`)).rows;
    await db.query("rollback");

    const ids = cars.map((car) => car.source_id);
    const vehicles = await chestnyIn("vehicles", "source_listing_id,status,is_public", ids);
    const catalog = await chestnyIn("catalog_vehicles", "source_listing_id,image_urls,report_status,report_options,inspection_summary,accident_summary", ids);
    const vehicleBySource = new Map(vehicles.map((row) => [String(row.source_listing_id), row]));
    const catalogBySource = new Map(catalog.map((row) => [String(row.source_listing_id), row]));
    const optionCatalog: EncarOptionCatalog = blocks.has("options") ? await fetchStandardOptionCatalog() : { options: [] };

    const plans: Plan[] = [];
    const skipped = { notEligible: 0, optionRowsInvisible: 0, optionNoData: 0, historyUnavailable: 0, inspectionNoStructure: 0 };

    for (const car of cars) {
      const vehicle = vehicleBySource.get(car.source_id);
      const meta = catalogBySource.get(car.source_id);
      if (!vehicle || String(vehicle.status) !== "active" || vehicle.is_public !== true) { skipped.notEligible++; continue; }
      const summary = asRow(meta?.inspection_summary);
      const accident = asRow(meta?.accident_summary);

      let optionRows: EncarOptionRow[] | null = null;
      if (blocks.has("options") && car.no_options) {
        const codes = asArray(summary.standardOptionCodes).map(String);
        const rows = [...optionRowsFromCodes(optionCatalog, codes), ...optionRowsFromChoice(meta?.report_options)];
        const displayable = rows.filter(isOptionRowDisplayable);
        skipped.optionRowsInvisible += rows.length - displayable.length;
        if (displayable.length) optionRows = displayable;
        else skipped.optionNoData++;
      }

      let history: Plan["history"] = null;
      if (blocks.has("history") && car.no_history) {
        if (historyIsAvailable(accident)) history = { summary: historySummaryFrom(accident), raw: accident };
        else skipped.historyUnavailable++;
      }

      let inspection: Plan["inspection"] = null;
      if (blocks.has("inspection") && car.no_meaningful_report) {
        const items = inspectionItemsFrom(summary);
        if (items.length) inspection = { summary: { source: "chestny", has_structured_report: true, checks: asArray(summary.checks).length, body_findings: asArray(summary.bodyFindings).length }, items, raw: summary };
        else skipped.inspectionNoStructure++;
      }

      if (optionRows || history || inspection) plans.push({ car, options: optionRows, history, inspection });
    }

    const selected = limit > 0 ? plans.slice(0, limit) : plans;
    result.planned = {
      eligiblePublicCars: cars.length - skipped.notEligible,
      cardsWithSomethingToWrite: plans.length,
      selectedForThisRun: selected.length,
      optionCards: selected.filter((plan) => plan.options).length,
      optionRows: selected.reduce((sum, plan) => sum + (plan.options?.length ?? 0), 0),
      historyCards: selected.filter((plan) => plan.history).length,
      inspectionCards: selected.filter((plan) => plan.inspection).length,
    };
    result.skipped = skipped;
    const written = { cards: 0, skippedAlreadyPresent: 0, errors: 0, optionRows: 0, historyReports: 0, inspectionReports: 0 };

    for (const plan of selected) {
      if (!write) { details.push({ sourceId: plan.car.source_id, status: "dry_run" }); continue; }
      const detail: Record<string, unknown> = {
        sourceId: plan.car.source_id, carId: plan.car.id, status: "skipped",
        skipped: [] as string[], inserted: { options: [] as string[], reports: [] as string[] }, error: null,
      };
      const cardStart = Date.now();
      console.error(`[card] start ${plan.car.source_id}`);
      try {
        await db.query("begin");
        // Serialise writers on the card row and re-check eligibility under the lock: the
        // card could have left the catalogue since selection, and car_options has no
        // unique constraint to stop two runs from both seeing the block empty.
        const locked = await db.query("select id from public.cars where id = $1 and is_available = true and primary_source = 'chestny_prigon' for update", [plan.car.id]);
        if (!locked.rowCount) {
          await db.query("rollback");
          (detail.skipped as string[]).push("card_not_eligible_under_lock");
          written.skippedAlreadyPresent++;
          details.push(detail);
          appendManifest(detail);
          continue;
        }
        if (plan.options?.length) {
          const inserted = await db.query<{ id: string }>(`
            insert into public.car_options(car_id, source, category, source_code, name_original, name_ru,
                                           value_original, value_ru, price_krw, description_original, description_ru,
                                           is_present, sort_order)
            select $1, 'chestny', r.category, r.source_code, r.name_original, r.name_ru, r.value_original, r.value_ru,
                   r.price_krw, r.description_original, r.description_ru, r.is_present, r.sort_order
            from jsonb_to_recordset($2::jsonb) as r(category text, source_code text, name_original text, name_ru text,
                   value_original text, value_ru text, price_krw bigint, description_original text, description_ru text,
                   is_present boolean, sort_order integer)
            where not exists (select 1 from public.car_options where car_id = $1)
            returning id`, [plan.car.id, JSON.stringify(plan.options)]);
          if (inserted.rowCount) (detail.inserted as { options: string[] }).options.push(...inserted.rows.map((row) => row.id));
          else (detail.skipped as string[]).push("options_already_present");
        }
        if (plan.history) {
          const inserted = await db.query<{ id: string }>(`
            insert into public.car_condition_reports(car_id, source, report_type, summary, items, raw_payload)
            select $1, 'chestny', 'chestny_carhistory', $2::jsonb, '[]'::jsonb, $3::jsonb
            where not exists (select 1 from public.car_condition_reports
                              where car_id = $1 and source = 'chestny' and report_type = 'chestny_carhistory')
            returning id`, [plan.car.id, JSON.stringify(plan.history.summary), JSON.stringify(plan.history.raw)]);
          if (inserted.rowCount) (detail.inserted as { reports: string[] }).reports.push(...inserted.rows.map((row) => row.id));
          else (detail.skipped as string[]).push("history_already_present");
        }
        if (plan.inspection) {
          const inserted = await db.query<{ id: string }>(`
            insert into public.car_condition_reports(car_id, source, report_type, summary, items, raw_payload)
            select $1, 'chestny', 'chestny_inspection', $2::jsonb, $3::jsonb, $4::jsonb
            where not exists (select 1 from public.car_condition_reports
                              where car_id = $1 and items is not null and items <> '[]'::jsonb)
            returning id`, [plan.car.id, JSON.stringify(plan.inspection.summary), JSON.stringify(plan.inspection.items), JSON.stringify(plan.inspection.raw)]);
          if (inserted.rowCount) (detail.inserted as { reports: string[] }).reports.push(...inserted.rows.map((row) => row.id));
          else (detail.skipped as string[]).push("inspection_already_present");
        }
        const insertedCount = ((detail.inserted as { options: string[] }).options.length) + ((detail.inserted as { reports: string[] }).reports.length);
        detail.status = insertedCount > 0 ? "written" : "skipped";
        // The journal is written BEFORE the commit: the other order could leave committed
        // rows whose ids never reached the manifest, while this order can only leave ids
        // of rows that were never committed, which a rollback deletes harmlessly.
        appendManifest(detail);
        await db.query("commit");
        if (insertedCount > 0) {
          written.cards++;
          written.optionRows += (detail.inserted as { options: string[] }).options.length;
          written.historyReports += plan.history && (detail.inserted as { reports: string[] }).reports.length ? 1 : 0;
          written.inspectionReports += plan.inspection && (detail.inserted as { reports: string[] }).reports.length ? 1 : 0;
        } else written.skippedAlreadyPresent++;
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        detail.status = "error";
        detail.error = error instanceof Error ? error.message : String(error);
        written.errors++;
        appendManifest(detail);
      }
      details.push(detail);
      console.error(`[card] done ${plan.car.source_id} ${String(detail.status)} ${Date.now() - cardStart}ms`);
    }

    result.manifestPath = write ? manifestPath : null;
    result.written = written;
    result.sample = details.slice(0, 3);
  } catch (error) {
    throw error;
  } finally {
    await db.end();
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
