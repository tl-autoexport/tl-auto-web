import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { categorizeOption, translateInspectionLabel, translateInspectionStatus, translateOption } from "../src/server/normalization/display";

config({ path: ".env", quiet: true });
const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID ?? "349fe610-17e0-4df8-8053-bcd7d234983d";
const write = process.env.TL_AUTO_ENRICHMENT_APPLY === "true";
const approvedIds = process.env.TL_AUTO_ENRICHMENT_APPROVED_IDS?.split(",").map((value) => value.trim()).filter(Boolean);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
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
  return obj(obj(q.result).probes)[probe] && obj(obj(q.result).probes)[probe] instanceof Object
    && obj(obj(obj(q.result).probes)[probe]).classification === "ready";
};
// Table names are dynamic here, so the filter is typed from the client itself
// instead of the generated database types.
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
  const inspection = obj(payload.inspection); const summary = obj(payload.inspectionSummary); const master = obj(inspection.master); const detail = obj(master.detail);
  const formats = Array.isArray(inspection.formats) ? inspection.formats : [];
  const items = Array.isArray(inspection.inners) ? inspection.inners.map((node) => {
    const item = obj(node); const type = obj(item.type); const status = obj(item.statusType);
    return { code: text(type.code), label_original: text(type.title), label_ru: translateInspectionLabel(text(type.title)), status_code: text(status.code), status_original: text(status.title), status_ru: translateInspectionStatus(text(status.title)), description_original: text(item.description), price: typeof item.price === "number" ? item.price : null, children: Array.isArray(item.children) ? item.children : [] };
  }) : [];
  return { car_id: carId, source: "encar", report_type: "encar_inspection", summary: { formats, has_structured_report: formats.includes("TABLE"), inspection_date: text(master.registrationDate), supply_number: text(master.supplyNum), accident: master.accdient ?? null, simple_repair: master.simpleRepair ?? null, inspector_name: text(summary.inspName) ?? text(detail.inspName), body_findings_count: Array.isArray(inspection.outers) ? inspection.outers.length : 0, body_findings: Array.isArray(summary.outerSummarys) ? summary.outerSummarys : [] }, items, raw_payload: { inspection, summary } };
}
function options(carId: string, payload: Obj) {
  return Array.isArray(payload.choiceOptions) ? payload.choiceOptions.map((raw, index) => {
    const option = obj(raw); const original = text(option.optionName);
    return { car_id: carId, source: "encar", category: categorizeOption(original, translateOption(original)), source_code: null, name_original: original, name_ru: translateOption(original), value_original: null, value_ru: null, description_original: null, description_ru: null, price_krw: typeof option.price === "number" ? option.price : null, is_present: true, sort_order: 1000 + index };
  }) : [];
}
function gallery(carId: string, payload: Obj) {
  const detail = obj(payload.detail); return Array.isArray(detail.photos) ? detail.photos.flatMap((raw, index) => {
    const photo = obj(raw); const path = text(photo.path); if (!path) return [];
    const type = text(photo.type)?.toLowerCase(); const category = ["outer", "inner", "option", "thumbnail"].includes(type ?? "") ? type : "photo";
    return [{ car_id: carId, source: "encar", media_type: "image", category, url: photoUrl(path), thumbnail_url: photoUrl(path), sort_order: index, is_primary: index === 0, legal_mode: "external_url" }];
  }) : [];
}
async function main() {
  const [queue, staging, cars] = await Promise.all([
    pages<Queue>("encar_enrichment_queue", "source_listing_id,status,task,result", (q) => q.eq("run_id", runId)),
    pages<Stage>("encar_enrichment_staging", "source_listing_id,raw_payload", (q) => q.eq("run_id", runId)),
    pages<Car>("cars", "id,source_id", (q) => q.eq("is_available", true)),
  ]);
  const stageBySource = new Map(staging.map((row) => [row.source_listing_id, row])); const carBySource = new Map(cars.map((row) => [row.source_id, row]));
  const work = queue.filter((q) => q.status === "succeeded" && (!approvedIds || approvedIds.includes(q.source_listing_id)) && stageBySource.get(q.source_listing_id)?.raw_payload && carBySource.has(q.source_listing_id));
  const report = { runId, write, allowlistApplied: Boolean(approvedIds), allowlistedIds: approvedIds?.length ?? null, matchedCars: work.length, reports: 0, options: 0, galleryImages: 0, galleriesSkippedEmpty: 0, errors: [] as string[] };
  for (const q of work) {
    const car = carBySource.get(q.source_listing_id)!; const payload = stageBySource.get(q.source_listing_id)!.raw_payload!;
    const reportReady = Boolean(q.task.insurance) && ready(q, "insurance"); const optionReady = Boolean(q.task.options) && ready(q, "options"); const galleryReady = Boolean(q.task.gallery) && ready(q, "gallery");
    const reportRow = reportReady ? inspectionReport(car.id, payload) : null; const optionRows = optionReady ? options(car.id, payload) : []; const galleryRows = galleryReady ? gallery(car.id, payload) : [];
    report.reports += reportRow ? 1 : 0; report.options += optionRows.length; report.galleryImages += galleryRows.length; if (galleryReady && !galleryRows.length) report.galleriesSkippedEmpty++;
    if (!write) continue;
    if (reportRow) { const { error } = await db.from("car_condition_reports").delete().eq("car_id", car.id).eq("source", "encar").eq("report_type", "encar_inspection"); if (error) throw new Error(error.message); const inserted = await db.from("car_condition_reports").insert(reportRow); if (inserted.error) throw new Error(inserted.error.message); }
    if (optionReady) { const { error } = await db.from("car_options").delete().eq("car_id", car.id).eq("source", "encar"); if (error) throw new Error(error.message); if (optionRows.length) { const inserted = await db.from("car_options").insert(optionRows); if (inserted.error) throw new Error(inserted.error.message); } }
    if (galleryReady && galleryRows.length) { const { error } = await db.from("car_media").delete().eq("car_id", car.id).eq("source", "encar").in("category", ["outer", "inner", "option", "thumbnail", "photo"]); if (error) throw new Error(error.message); const inserted = await db.from("car_media").insert(galleryRows); if (inserted.error) throw new Error(inserted.error.message); }
    const applied = await db.from("encar_enrichment_staging").update({ applied_at: new Date().toISOString() }).eq("run_id", runId).eq("source_listing_id", q.source_listing_id); if (applied.error) throw new Error(applied.error.message);
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
