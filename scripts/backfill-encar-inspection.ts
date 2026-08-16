import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const baseHeaders = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.8,en;q=0.6",
  Referer: "https://www.encar.com/",
  Origin: "https://www.encar.com",
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

async function getJson(url: string) {
  const response = await fetch(url, { headers: baseHeaders, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<unknown>;
}

function imageUrl(path: string) {
  return path.startsWith("http") ? path : `https://ci.encar.com${path}`;
}

async function enrich(sourceId: string) {
  const detail = record(await getJson(`https://api.encar.com/v1/readside/vehicle/${sourceId}`));
  const canonicalId = identifier(detail.vehicleId);
  if (!canonicalId) return null;
  const inspection = record(await getJson(`https://api.encar.com/v1/readside/inspection/vehicle/${canonicalId}`));
  const summary = await getJson(`https://api.encar.com/v1/readside/inspection/vehicle/${canonicalId}/summary`).catch(() => null);
  const master = record(inspection.master);
  const masterDetail = record(master.detail);
  const inners = Array.isArray(inspection.inners) ? inspection.inners : [];
  const outers = Array.isArray(inspection.outers) ? inspection.outers : [];
  const images = Array.isArray(inspection.images) ? inspection.images.flatMap((value, index) => {
    const item = record(value);
    const path = text(item.path);
    if (!path) return [];
    return [{
      url: imageUrl(path),
      title: text(item.title) ?? `Кадр осмотра ${index + 1}`,
      sort_order: 2000 + index,
    }];
  }) : [];

  return {
    canonicalId,
    images,
    report: {
      source: "encar",
      report_type: "encar_inspection",
      summary: {
        formats: Array.isArray(inspection.formats) ? inspection.formats : [],
        has_structured_report: Array.isArray(inspection.formats) && inspection.formats.includes("TABLE"),
        inspection_date: text(master.registrationDate),
        supply_number: text(master.supplyNum),
        accident: master.accdient ?? null,
        simple_repair: master.simpleRepair ?? null,
        inspector_name: text(masterDetail.inspName),
        body_findings_count: outers.length,
      },
      items: inners,
      raw_payload: { inspection, summary },
    },
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase variables are not configured");
  const write = process.env.ENCAR_INSPECTION_DRY_RUN === "false";
  if (write && !process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Write mode requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sourceIds = (process.env.ENCAR_INSPECTION_IDS ?? "42534447")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const { data: cars, error: carsError } = await client
    .from("cars")
    .select("id, source_id")
    .eq("primary_source", "encar")
    .in("source_id", sourceIds);
  if (carsError) throw carsError;

  const results: Array<Record<string, unknown>> = [];
  for (const car of cars ?? []) {
    const enriched = await enrich(car.source_id);
    if (!enriched) {
      results.push({ sourceId: car.source_id, status: "no-canonical-id" });
      continue;
    }
    if (!write) {
      results.push({ sourceId: car.source_id, canonicalId: enriched.canonicalId, images: enriched.images.length, bodyFindings: enriched.report.summary.body_findings_count, status: "dry-run" });
      continue;
    }

    const { data: existing, error: existingError } = await client
      .from("car_condition_reports")
      .select("id")
      .eq("car_id", car.id)
      .eq("report_type", "encar_inspection")
      .maybeSingle();
    if (existingError) throw existingError;
    const reportResult = existing
      ? await client.from("car_condition_reports").update(enriched.report).eq("id", existing.id)
      : await client.from("car_condition_reports").insert({ car_id: car.id, ...enriched.report });
    if (reportResult.error) throw reportResult.error;

    const { error: deleteError } = await client.from("car_media").delete().eq("car_id", car.id).eq("source", "encar").eq("category", "encar_inspection_document");
    if (deleteError) throw deleteError;
    if (enriched.images.length) {
      const { error: mediaError } = await client.from("car_media").insert(enriched.images.map((image) => ({
        car_id: car.id,
        source: "encar",
        media_type: "image",
        category: "encar_inspection_document",
        url: image.url,
        sort_order: image.sort_order,
        is_primary: false,
      })));
      if (mediaError) throw mediaError;
    }
    results.push({ sourceId: car.source_id, canonicalId: enriched.canonicalId, images: enriched.images.length, bodyFindings: enriched.report.summary.body_findings_count, status: "written" });
  }
  console.log(JSON.stringify({ write, requested: sourceIds.length, matched: cars?.length ?? 0, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
