import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";
import {
  translateInspectionLabel,
  translateInspectionStatus,
  translateOption,
} from "../src/server/normalization/display";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const write = process.env.CHESTNY_ENCAR_ENRICH_DRY_RUN === "false";
const requestedIds = (process.env.CHESTNY_ENCAR_ENRICH_IDS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const limit = Math.max(1, Number(process.env.CHESTNY_ENCAR_ENRICH_LIMIT ?? 2161));
const concurrency = Math.min(6, Math.max(1, Number(process.env.CHESTNY_ENCAR_ENRICH_CONCURRENCY ?? 3)));
const force = process.env.CHESTNY_ENCAR_ENRICH_FORCE === "true";

if (!url || !key) throw new Error("TL Auto Supabase admin credentials are required");

type RecordValue = Record<string, unknown>;
type Car = { id: string; source_id: string; source_url: string | null; brand: string | null; model: string | null };
type StandardOption = {
  optionCd?: string; optionName?: string; optionTitle?: string; groupOptionName?: string;
  optionTypeCd?: string; sort?: number; description?: string; subOptions?: StandardOption[];
};

function object(value: unknown): RecordValue { return value && typeof value === "object" ? value as RecordValue : {}; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function encarId(sourceUrl: string | null) { return sourceUrl?.match(/[?&]carid=(\d+)/i)?.[1] ?? null; }
function imageUrl(path: string) { return path.startsWith("http") ? path : `https://ci.encar.com${path}`; }

async function getJson<T>(requestUrl: string): Promise<T> {
  // Encar's public FEM card reads these endpoints directly.  Do not use the
  // legacy IP-verification helper here: it currently rejects our server IP
  // before the otherwise public readside endpoint is reached.
  const response = await fetch(requestUrl, {
    headers: ENCAR_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Encar HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function normalizeInspection(node: unknown): RecordValue {
  const item = object(node); const type = object(item.type); const status = object(item.statusType);
  return {
    code: text(type.code), label_original: text(type.title), label_ru: translateInspectionLabel(text(type.title)),
    status_code: text(status.code), status_original: text(status.title), status_ru: translateInspectionStatus(text(status.title)),
    description_original: text(item.description), price: typeof item.price === "number" ? item.price : null,
    children: Array.isArray(item.children) ? item.children.map(normalizeInspection) : [],
  };
}

function selectedOptions(catalog: StandardOption[], codes: string[]) {
  const selected = new Set(codes);
  return catalog.flatMap((option, index) => {
    const subOptions = (option.subOptions ?? []).filter((sub) => Boolean(sub.optionCd && selected.has(sub.optionCd)));
    const present = Boolean(option.optionCd && selected.has(option.optionCd)) || subOptions.length > 0;
    if (!present) return [];
    const nameOriginal = option.optionTitle ?? option.groupOptionName ?? option.optionName ?? null;
    const values = subOptions.map((sub) => sub.groupOptionName ?? sub.optionName).filter((value): value is string => Boolean(value));
    return [{
      source: "encar", category: `Опции Encar · ${option.optionTypeCd ?? "прочее"}`, source_code: option.optionCd ?? null,
      name_original: nameOriginal, name_ru: translateOption(nameOriginal), value_original: values.join(", ") || null,
      value_ru: values.map(translateOption).filter(Boolean).join(", ") || null, description_original: option.description ?? null,
      description_ru: null, price_krw: null, is_present: true, sort_order: Number(option.sort ?? index),
    }];
  });
}

async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const cars: Car[] = [];
  for (let from = 0; from < limit; from += 1000) {
    let query = db.from("cars").select("id,source_id,source_url,brand,model").eq("primary_source", "chestny_prigon").eq("is_available", true).order("source_id").range(from, Math.min(from + 999, limit - 1));
    if (requestedIds.length) query = query.in("source_id", requestedIds);
    const { data, error } = await query; if (error) throw error;
    cars.push(...((data ?? []) as Car[])); if (!data || data.length < 1000 || requestedIds.length) break;
  }
  const { data: existingReports, error: existingReportsError } = await db
    .from("car_condition_reports")
    .select("car_id")
    .eq("source", "encar")
    .eq("report_type", "encar_inspection")
    .limit(10_000);
  if (existingReportsError) throw existingReportsError;
  const enrichedCarIds = new Set((existingReports ?? []).map((report) => String(report.car_id)));
  const selectedCars = force || requestedIds.length ? cars : cars.filter((car) => !enrichedCarIds.has(car.id));
  const catalog = await getJson<{ options?: StandardOption[] }>("https://api.encar.com/v1/readside/vehicles/car/options/standard");
  const results: Array<RecordValue> = []; let cursor = 0;

  async function enrich(car: Car) {
    const id = encarId(car.source_url);
    if (!id) return { sourceId: car.source_id, status: "missing_encar_id" };
    try {
      const detail = object(await getJson<unknown>(`https://api.encar.com/v1/readside/vehicle/${id}`));
      const condition = object(detail.condition); const inspectionCondition = object(condition.inspection);
      const formats = Array.isArray(inspectionCondition.formats) ? inspectionCondition.formats : [];
      const [inspection, summary, choices] = await Promise.all([
        getJson<unknown>(`https://api.encar.com/v1/readside/inspection/vehicle/${id}`).catch(() => null),
        getJson<unknown>(`https://api.encar.com/v1/readside/inspection/vehicle/${id}/summary`).catch(() => null),
        getJson<Array<{ optionName?: string; price?: number }>>(`https://api.encar.com/v1/readside/vehicles/car/${id}/options/choice`).catch(() => []),
      ]);
      const standardCodes = object(detail.options).standard;
      const optionCodes = Array.isArray(standardCodes)
        ? standardCodes.filter((value): value is string => typeof value === "string")
        : [];
      const options = [
        ...selectedOptions(catalog.options ?? [], optionCodes),
        ...choices.map((option, index) => ({ source: "encar", category: "Дополнительные опции", source_code: null, name_original: option.optionName ?? null, name_ru: translateOption(option.optionName), value_original: null, value_ru: null, description_original: null, description_ru: null, price_krw: option.price ?? null, is_present: true, sort_order: 1000 + index })),
      ];
      const inspectionData = object(inspection); const master = object(inspectionData.master); const masterDetail = object(master.detail);
      const images = Array.isArray(inspectionData.images) ? inspectionData.images.flatMap((value, index) => {
        const item = object(value); const path = text(item.path); return path ? [{ car_id: car.id, source: "encar", media_type: "image", category: "encar_inspection_document", url: imageUrl(path), thumbnail_url: imageUrl(path), sort_order: 2000 + index, is_primary: false, legal_mode: "external_url" }] : [];
      }) : [];
      const report = inspection ? {
        car_id: car.id, source: "encar", report_type: "encar_inspection",
        summary: { formats, has_structured_report: formats.includes("TABLE"), inspection_date: text(master.registrationDate), supply_number: text(master.supplyNum), accident: master.accdient ?? null, simple_repair: master.simpleRepair ?? null, inspector_name: text(object(summary).inspName) ?? text(masterDetail.inspName), body_findings_count: Array.isArray(inspectionData.outers) ? inspectionData.outers.length : 0, body_findings: Array.isArray(object(summary).outerSummarys) ? object(summary).outerSummarys : [] },
        items: Array.isArray(inspectionData.inners) ? inspectionData.inners.map(normalizeInspection) : [], raw_payload: { inspection: { outers: Array.isArray(inspectionData.outers) ? inspectionData.outers : [] } },
      } : null;
      if (write) {
        const { error: optionDeleteError } = await db.from("car_options").delete().eq("car_id", car.id).eq("source", "encar"); if (optionDeleteError) throw optionDeleteError;
        if (options.length) { const { error } = await db.from("car_options").insert(options.map((option) => ({ car_id: car.id, ...option }))); if (error) throw error; }
        const { error: reportDeleteError } = await db.from("car_condition_reports").delete().eq("car_id", car.id).eq("source", "encar").eq("report_type", "encar_inspection"); if (reportDeleteError) throw reportDeleteError;
        if (report) { const { error } = await db.from("car_condition_reports").insert(report); if (error) throw error; }
        const { error: mediaDeleteError } = await db.from("car_media").delete().eq("car_id", car.id).eq("source", "encar").eq("category", "encar_inspection_document"); if (mediaDeleteError) throw mediaDeleteError;
        if (images.length) { const { error } = await db.from("car_media").insert(images); if (error) throw error; }
        const vehicleNo = text(detail.vehicleNo); if (vehicleNo) { const { error } = await db.from("cars").update({ vehicle_no_masked: vehicleNo }).eq("id", car.id); if (error) throw error; }
      }
      return { sourceId: car.source_id, encarId: id, status: write ? "written" : "dry_run", options: options.length, inspection: Boolean(report), inspectionItems: report?.items.length ?? 0, inspectionImages: images.length };
    } catch (error) { return { sourceId: car.source_id, encarId: id, status: "error", error: error instanceof Error ? error.message : String(error) }; }
  }
  async function worker() { while (cursor < selectedCars.length) { const car = selectedCars[cursor++]; if (car) results.push(await enrich(car)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const summary = { write, found: cars.length, skippedAlreadyEnriched: cars.length - selectedCars.length, requested: selectedCars.length, written: results.filter((result) => result.status === "written").length, dryRun: results.filter((result) => result.status === "dry_run").length, inspectionAvailable: results.filter((result) => result.inspection).length, optionsLoaded: results.reduce((sum, result) => sum + Number(result.options ?? 0), 0), errors: results.filter((result) => result.status === "error").slice(0, 20), results: requestedIds.length ? results : undefined };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
