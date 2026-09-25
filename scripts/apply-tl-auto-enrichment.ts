/**
 * Apply collected Encar enrichment to TL Auto cards — hardened transfer.
 *
 * Behaviour was changed deliberately after review of the previous version, which
 * deleted existing rows before inserting. That is not acceptable for this transfer:
 *   * nothing is deleted; a block that already has data is skipped and the reason is
 *     recorded (previous Encar data must never be lost);
 *   * emptiness is checked atomically with the insert (`insert ... select ... where
 *     not exists`), so a check-then-write race cannot overwrite anything;
 *   * empty content is never written: an inspection without `items` and an option set
 *     without readable names are skipped, because the card would render an empty block;
 *   * each card is written in one transaction, and `applied_at` is set inside that same
 *     transaction, so a card can never be transferred without being marked, or marked
 *     without being transferred;
 *   * the ids of every inserted row are written to a batch manifest, which is the only
 *     reliable rollback handle (`car_media` and `car_options` have no raw_payload).
 *
 * Dry-run by default; TL_AUTO_ENRICHMENT_APPLY=true enables the write.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { categorizeOption, translateInspectionLabel, translateInspectionStatus, translateOption } from "../src/server/normalization/display";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

config({ path: ".env", quiet: true });
config({ path: ".env.local", quiet: true });
const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID ?? "349fe610-17e0-4df8-8053-bcd7d234983d";
const write = process.env.TL_AUTO_ENRICHMENT_APPLY === "true";
const approvedIds = process.env.TL_AUTO_ENRICHMENT_APPROVED_IDS?.split(",").map((value) => value.trim()).filter(Boolean);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const dbUrl = process.env.SUPABASE_DB_URL;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service key are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Obj = Record<string, unknown>;
type Queue = { source_listing_id: string; status: string; task: Obj; result: Obj | null };
type Stage = { source_listing_id: string; raw_payload: Obj | null };
type Car = { id: string; source_id: string };
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const photoUrl = (path: string) => path.startsWith("http") ? path : `https://ci.encar.com${path}`;
const ready = (q: Queue, task: string) => {
  const probe = task === "insurance" ? "inspection" : task === "gallery" ? "detail" : task;
  const probes = obj(obj(q.result).probes);
  return Boolean(obj(probes[probe]).classification === "ready");
};

type SelectedRows = ReturnType<ReturnType<typeof db.from>["select"]>;
type RowFilter = (query: SelectedRows) => SelectedRows;
async function pages<T>(table: string, columns: string, filter: RowFilter) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

function inspectionReport(carId: string, payload: Obj) {
  const inspection = obj(payload.inspection); const summary = obj(payload.inspectionSummary);
  const master = obj(inspection.master); const detail = obj(master.detail);
  const formats = Array.isArray(inspection.formats) ? inspection.formats : [];
  const items = Array.isArray(inspection.inners) ? inspection.inners.map((node) => {
    const item = obj(node); const type = obj(item.type); const status = obj(item.statusType);
    return { code: text(type.code), label_original: text(type.title), label_ru: translateInspectionLabel(text(type.title)), status_code: text(status.code), status_original: text(status.title), status_ru: translateInspectionStatus(text(status.title)), description_original: text(item.description), price: typeof item.price === "number" ? item.price : null, children: Array.isArray(item.children) ? item.children : [] };
  }) : [];
  return {
    summary: { formats, has_structured_report: formats.includes("TABLE"), inspection_date: text(master.registrationDate), supply_number: text(master.supplyNum), accident: master.accdient ?? null, simple_repair: master.simpleRepair ?? null, inspector_name: text(summary.inspName) ?? text(detail.inspName), body_findings_count: Array.isArray(inspection.outers) ? inspection.outers.length : 0, body_findings: Array.isArray(summary.outerSummarys) ? summary.outerSummarys : [] },
    items, raw_payload: { inspection, summary },
  };
}

/** Only options the card can actually render are written. */
function options(carId: string, payload: Obj) {
  if (!Array.isArray(payload.choiceOptions)) return [];
  return payload.choiceOptions.flatMap((raw, index) => {
    const option = obj(raw); const original = text(option.optionName);
    const nameRu = translateOption(original);
    if (!nameRu) return [];
    return [{ car_id: carId, source: "encar", category: categorizeOption(original, nameRu), source_code: null, name_original: original, name_ru: nameRu, value_original: null, value_ru: null, description_original: null, description_ru: null, price_krw: typeof option.price === "number" ? option.price : null, is_present: true, sort_order: 1000 + index }];
  });
}

function gallery(carId: string, payload: Obj) {
  const detail = obj(payload.detail); return Array.isArray(detail.photos) ? detail.photos.flatMap((raw, index) => {
    const photo = obj(raw); const path = text(photo.path); if (!path) return [];
    const type = text(photo.type)?.toLowerCase(); const category = ["outer", "inner", "option", "thumbnail"].includes(type ?? "") ? type : "photo";
    return [{ car_id: carId, source: "encar", media_type: "image", category, url: photoUrl(path), thumbnail_url: photoUrl(path), sort_order: index, is_primary: index === 0, legal_mode: "external_url" }];
  }) : [];
}

const PROBE_PAYLOAD_KEY = "detail";
type CardResult = {
  sourceListingId: string; carId: string; status: "written" | "skipped" | "error";
  skipped: string[]; inserted: { reports: string[]; options: string[]; media: string[] }; error: string | null;
};

async function main() {
  const [queue, staging, cars] = await Promise.all([
    pages<Queue>("encar_enrichment_queue", "source_listing_id,status,task,result", (q) => q.eq("run_id", runId)),
    pages<Stage>("encar_enrichment_staging", "source_listing_id,raw_payload", (q) => q.eq("run_id", runId)),
    pages<Car>("cars", "id,source_id", (q) => q.eq("is_available", true).eq("primary_source", "chestny_prigon")),
  ]);
  const stageBySource = new Map(staging.map((row) => [row.source_listing_id, row]));
  const carBySource = new Map(cars.map((row) => [row.source_id, row]));
  const work = queue.filter((q) => q.status === "succeeded" && (!approvedIds || approvedIds.includes(q.source_listing_id))
    && stageBySource.get(q.source_listing_id)?.raw_payload && carBySource.has(q.source_listing_id));

  const report = {
    runId, write, allowlistApplied: Boolean(approvedIds), allowlistedIds: approvedIds?.length ?? null,
    matchedCars: work.length,
    plans: { reports: 0, options: 0, galleryImages: 0, skippedEmptyInspection: 0, skippedEmptyOptions: 0, skippedEmptyGallery: 0 },
    results: { written: 0, skipped: 0, errors: 0 },
    details: [] as CardResult[], manifestPath: null as string | null,
  };

  const pg = write ? new Client({
    connectionString: dbUrl, ssl: { rejectUnauthorized: false },
    statement_timeout: 30000, query_timeout: 30000, connectionTimeoutMillis: 15000, keepAlive: true,
  }) : null;
  if (pg) await pg.connect();
  const batchId = `final-transfer-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const manifestPath = `output/${batchId}.jsonl`;
  // The header is written before the first commit, and every card appends its own
  // line right after committing, so a crash can lose at most the card in flight —
  // never the ids of cards that are already in the database.
  const startManifest = () => {
    if (!write) return;
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify({ batchId, runId, kind: "header" })}\n`);
  };
  const appendManifest = (detail: CardResult) => {
    if (!write) return;
    appendFileSync(manifestPath, `${JSON.stringify(detail)}\n`);
  };
  startManifest();

  try {
    for (const q of work) {
      const car = carBySource.get(q.source_listing_id)!; const payload = stageBySource.get(q.source_listing_id)!.raw_payload!;
      const inspection = ready(q, "insurance") ? inspectionReport(car.id, payload) : null;
      const optionRows = ready(q, "options") ? options(car.id, payload) : [];
      const galleryRows = ready(q, "gallery") ? gallery(car.id, payload) : [];

      if (inspection && !inspection.items.length) report.plans.skippedEmptyInspection++;
      if (ready(q, "options") && !optionRows.length) report.plans.skippedEmptyOptions++;
      if (ready(q, "gallery") && !galleryRows.length) report.plans.skippedEmptyGallery++;

      const writeInspection = Boolean(inspection && inspection.items.length);
      const writeOptions = optionRows.length > 0;
      const writeGallery = galleryRows.length > 0;
      report.plans.reports += writeInspection ? 1 : 0;
      report.plans.options += optionRows.length;
      report.plans.galleryImages += galleryRows.length;

      const detail: CardResult = { sourceListingId: q.source_listing_id, carId: car.id, status: "skipped", skipped: [], inserted: { reports: [], options: [], media: [] }, error: null };
      if (!writeInspection && !writeOptions && !writeGallery) { report.details.push(detail); appendManifest(detail); }
      else if (!pg) {
        detail.skipped.push("dry_run");
        report.details.push(detail);
      } else {        try {
          await pg.query("begin");
          // Serialise writers on the card row and re-check eligibility under the lock: the
          // card could have left the catalogue or changed source since selection, and two
          // runs could otherwise both see the block empty (car_options and car_media have
          // no unique constraint to stop duplicates).
          const locked = await pg.query("select id from public.cars where id = $1 and is_available = true and primary_source = 'chestny_prigon' for update", [car.id]);
          if (!locked.rowCount) {
            await pg.query("rollback");
            detail.skipped.push("card_not_eligible_under_lock");
            report.results.skipped++;
            report.details.push(detail);
            appendManifest(detail);
            continue;
          }
          if (writeInspection) {
            const inserted = await pg.query<{ id: string }>(`
              insert into public.car_condition_reports(car_id, source, report_type, summary, items, raw_payload)
              select $1, 'encar', 'encar_inspection', $2::jsonb, $3::jsonb, $4::jsonb
              where not exists (select 1 from public.car_condition_reports
                                where car_id = $1 and source = 'encar' and report_type = 'encar_inspection')
              returning id`,
              [car.id, JSON.stringify(inspection!.summary), JSON.stringify(inspection!.items), JSON.stringify(inspection!.raw_payload)]);
            if (inserted.rowCount) detail.inserted.reports.push(...inserted.rows.map((row) => row.id));
            else detail.skipped.push("inspection_already_present");
          }
          if (writeOptions) {
            const inserted = await pg.query<{ id: string }>(`
              insert into public.car_options(car_id, source, category, source_code, name_original, name_ru,
                                             value_original, value_ru, price_krw, description_original, description_ru,
                                             is_present, sort_order)
              select $1, 'encar', r.category, r.source_code, r.name_original, r.name_ru, r.value_original, r.value_ru,
                     r.price_krw, r.description_original, r.description_ru, r.is_present, r.sort_order
              from jsonb_to_recordset($2::jsonb) as r(category text, source_code text, name_original text, name_ru text,
                     value_original text, value_ru text, price_krw bigint, description_original text, description_ru text,
                     is_present boolean, sort_order integer)
              where not exists (select 1 from public.car_options where car_id = $1 and source = 'encar')
              returning id`,
              [car.id, JSON.stringify(optionRows)]);
            if (inserted.rowCount) detail.inserted.options.push(...inserted.rows.map((row) => row.id));
            else detail.skipped.push("options_already_present");
          }
          if (writeGallery) {
            const inserted = await pg.query<{ id: string }>(`
              insert into public.car_media(car_id, source, media_type, category, url, thumbnail_url, sort_order, is_primary, legal_mode)
              select $1, 'encar', r.media_type, r.category, r.url, r.thumbnail_url, r.sort_order, r.is_primary, r.legal_mode
              from jsonb_to_recordset($2::jsonb) as r(media_type text, category text, url text, thumbnail_url text,
                     sort_order integer, is_primary boolean, legal_mode text)
              where not exists (select 1 from public.car_media
                                where car_id = $1 and source = 'encar'
                                  and category in ('outer', 'inner', 'option', 'thumbnail', 'photo'))
              returning id`,
              [car.id, JSON.stringify(galleryRows)]);
            if (inserted.rowCount) detail.inserted.media.push(...inserted.rows.map((row) => row.id));
            else detail.skipped.push("gallery_already_present");
          }
          const wroteSomething = detail.inserted.reports.length + detail.inserted.options.length + detail.inserted.media.length > 0;
          detail.status = wroteSomething ? "written" : "skipped";
          // The mark is written inside the same transaction as the data, and only when
          // something was actually transferred: a card must never be marked as applied
          // without data, nor receive data without the mark.
          if (wroteSomething) {
            await pg.query(`update public.encar_enrichment_staging set applied_at = now() where run_id = $1 and source_listing_id = $2`, [runId, q.source_listing_id]);
          }
          // The journal is written BEFORE the commit: the other order could leave committed
          // rows whose ids never reached the manifest, while this order can only leave ids
          // of rows that were never committed, which a rollback deletes harmlessly. The
          // status is set before this line so the journal does not mislabel a written card.
          appendManifest(detail);
          await pg.query("commit");
          if (wroteSomething) report.results.written++; else report.results.skipped++;
        } catch (error) {
          await pg.query("rollback").catch(() => undefined);
          detail.status = "error";
          detail.error = error instanceof Error ? error.message : String(error);
          report.results.errors++;
          appendManifest(detail);
        }
        report.details.push(detail);
      }
    }
  } finally {
    if (pg) await pg.end();
  }
  report.manifestPath = write ? manifestPath : null;
  report.details = report.details.slice(0, 25);
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
