import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildEncarHistoryReport, fetchDetail, fetchEncarHistory } from "../src/server/imports/encar";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const write = process.env.AUTOHOME_ENCAR_ENRICH_WRITE === "true";
const concurrency = Math.min(4, Math.max(1, Number(process.env.AUTOHOME_ENCAR_ENRICH_CONCURRENCY ?? 2)));
if (!supabaseUrl || !supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service-role key are required");
if (!process.env.ENCAR_PROXY_URL?.trim()) throw new Error("ENCAR_PROXY_URL is required; direct Encar requests are disabled");
process.env.ENCAR_PROXY_REQUIRED = "true";

type StagingRow = { source_listing_id: string; raw_payload: unknown };
type CarRow = { id: string; source_id: string; vehicle_no_masked: string | null; vehicle_specs: Record<string, unknown> | null };
const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function result<T>(value: { data: T; error: { message: string } | null }): T { if (value.error) throw new Error(value.error.message); return value.data; }

async function main() {
  const stagingRows = result(await db.from("chestny_catalog_staging").select("source_listing_id,raw_payload").eq("source_status", "active").eq("promotion_status", "published")) as StagingRow[];
  const staging = stagingRows.filter((row) => {
    const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
    const candidate = payload.autohome_power_candidate as Record<string, unknown> | undefined;
    return candidate?.review_status === "approved";
  });
  const ids = staging.map((row) => row.source_listing_id);
  const cars = ids.length ? result(await db.from("cars").select("id,source_id,vehicle_no_masked,vehicle_specs").eq("primary_source", "chestny_prigon").eq("is_available", true).in("source_id", ids)) as CarRow[] : [];
  const carBySource = new Map(cars.map((car) => [car.source_id, car]));
  const rows = staging.map((row) => ({ ...row, car: carBySource.get(row.source_listing_id) })).filter((row): row is typeof row & { car: CarRow } => Boolean(row.car));
  let cursor = 0;
  const stats = { cards: rows.length, detailsOk: 0, photos: 0, optionSets: 0, historiesAvailable: 0, historiesUnavailable: 0, accidents: 0, insuranceEvents: 0, payoutTotalKrw: 0, deactivated: 0, errors: [] as Array<{ id: string; error: string }> };
  const worker = async () => {
    while (true) {
      const row = rows[cursor++]; if (!row) return;
      try {
        const detail = await fetchDetail(row.source_listing_id);
        stats.detailsOk++; stats.photos += detail.photos.length; stats.optionSets += detail.standardOptionCodes.length > 0 ? 1 : 0;
        const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
        const detailRaw = ((payload.encar_enrichment as Record<string, unknown> | undefined)?.detail ?? {}) as Record<string, unknown>;
        const vehicleNo = String(row.car.vehicle_no_masked ?? detail.vehicleNo ?? detailRaw.vehicleNo ?? "").trim();
        const history = vehicleNo ? await fetchEncarHistory(vehicleNo, row.source_listing_id) : null;
        if (history?.status === "available") {
          stats.historiesAvailable++;
          const report = buildEncarHistoryReport(history.payload);
          const summary = report.summary as { accident_count: number; insurance_payout_count: number; insurance_payout_total_krw: number };
          stats.accidents += summary.accident_count; stats.insuranceEvents += summary.insurance_payout_count; stats.payoutTotalKrw += summary.insurance_payout_total_krw;
          if (write) {
            result(await db.from("cars").update({ accident_count: summary.accident_count, insurance_payout_count: summary.insurance_payout_count, insurance_payout_total_krw: summary.insurance_payout_total_krw, vehicle_specs: { ...(row.car.vehicle_specs ?? {}), encar_options_count: detail.standardOptionCodes.length, encar_full_gallery_count: detail.photos.length } }).eq("id", row.car.id));
            result(await db.from("car_condition_reports").upsert({ car_id: row.car.id, source: "encar", report_type: "encar_carhistory", summary: report.summary, items: report.items, raw_payload: report.raw_payload }, { onConflict: "car_id,source,report_type" }));
          }
        } else stats.historiesUnavailable++;
        if (write) {
          result(await db.from("car_media").delete().eq("car_id", row.car.id).eq("source", "encar").eq("media_type", "image"));
          if (detail.photos.length) result(await db.from("car_media").insert(detail.photos.map((photo, index) => ({ car_id: row.car.id, source: "encar", media_type: "image", category: photo.category, url: photo.url, sort_order: index, is_primary: index === 0 }))));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error); const unavailable = /Encar HTTP (404|410)/i.test(message);
        if (write && unavailable) {
          result(await db.from("cars").update({ is_available: false, sale_status: "source_unavailable", encar_check_status: "unavailable", encar_check_error: null, last_seen_at: new Date().toISOString(), next_encar_check_at: null }).eq("id", row.car.id));
          result(await db.from("chestny_catalog_staging").update({ source_status: "inactive", promotion_status: "source_unavailable", promotion_note: "Encar card returned HTTP 404/410 during refresh" }).eq("source_listing_id", row.source_listing_id));
          stats.deactivated++;
        }
        stats.errors.push({ id: row.source_listing_id, error: message });
      }
      await sleep(250);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(JSON.stringify({ dryRun: !write, concurrency, ...stats, encarRequests: stats.detailsOk + stats.historiesAvailable + stats.historiesUnavailable, databaseWrites: write, publicCatalogChanged: write }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
