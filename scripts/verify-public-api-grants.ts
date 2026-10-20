/**
 * Verify the public API before and after the column-grant migration.
 *
 * Runs the real storefront queries with the publishable (anon) key, plus the queries that
 * must be denied. Before the migration the denied ones succeed, which is the leak this
 * proves; after it they must fail while every legitimate query keeps working.
 *
 * Read-only: it only issues SELECTs and RPC calls.
 */
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and the publishable/anon key are required");

const CATALOG_CAR_SELECT =
  "id, primary_source, source_kind, source_id, source_url, published_at, published_at_source, catalog_added_at, created_at, source_updated_at, brand, model, trim, badge, badge_detail, body_type, year, registration_month, mileage_km, price_krw, price_rub, engine_cc, power_hp, power_confidence, power_finality, power_resolution_note, fuel_type, transmission, drive_type, color, owners_count, accident_count, insurance_payout_count, insurance_payout_total_krw, has_360_exterior, has_360_interior, has_heydealer_eye, has_obd_scan, has_underbody_photo, has_thermal_images, data_confidence, vehicle_specs";
const CATALOG_CARD_SELECT = CATALOG_CAR_SELECT.replace(", vehicle_specs", "") + ", primary_image_url, primary_thumbnail_url, media_count, seats";

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } });
  return { status: response.status, body: (await response.text()).slice(0, 160) };
}
async function rpc(name: string, payload: unknown): Promise<{ status: number; body: string }> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key!, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.text()).slice(0, 120) };
}

const mustWork: Array<[string, () => Promise<{ status: number; body: string }>]> = [
  ["catalog list", () => get(`cars?select=${encodeURIComponent(CATALOG_CARD_SELECT)}&is_available=eq.true&primary_source=in.(encar,chestny_prigon)&limit=1`)],
  ["card detail + nested", () => get(`cars?select=${encodeURIComponent(`${CATALOG_CAR_SELECT}, car_options(category,name_ru), car_condition_reports(source,report_type,summary,items)`)}&limit=1`)],
  ["facets select", () => get("cars?select=brand,model,trim,body_type,fuel_type,transmission,drive_type,color,owners_count&is_available=eq.true&limit=1")],
  ["sitemap select", () => get("cars?select=primary_source,source_id,source_updated_at&is_available=eq.true&limit=1")],
  ["count (id only)", () => get("cars?select=id&is_available=eq.true&limit=1")],
  ["rpc catalog_facets", () => rpc("catalog_facets", { f: {} })],
  ["rpc catalog_listing_count", () => rpc("catalog_listing_count", { f: {} })],
  ["rpc catalog_public_metrics", () => rpc("catalog_public_metrics", {})],
];

const mustBeDenied: Array<[string, string]> = [
  ["raw plate column", "cars?select=vehicle_no_masked&vehicle_no_masked=not.is.null&limit=1"],
  ["plate hash column", "cars?select=vehicle_no_hash&limit=1"],
  ["vin column", "cars?select=vin_masked&limit=1"],
];

async function main() {
  const out: Record<string, unknown> = { url, rows: [], denied: [], verdict: "" };
  let broken = 0;
  let leaked = 0;
  for (const [label, run] of mustWork) {
    const result = await run();
    const ok = result.status >= 200 && result.status < 300;
    if (!ok) broken++;
    (out.rows as unknown[]).push({ check: label, status: result.status, ok, body: ok ? undefined : result.body });
  }
  for (const [label, path] of mustBeDenied) {
    const result = await get(path);
    const denied = result.status === 401 || result.status === 403;
    const leakEvidence = !denied && result.body.includes("vehicle_no") === false && result.body.length > 4 ? result.body.slice(0, 60) : result.body.slice(0, 60);
    if (!denied) leaked++;
    (out.denied as unknown[]).push({ check: label, status: result.status, denied, sample: denied ? undefined : leakEvidence });
  }
  out.verdict = broken === 0 && leaked === 0
    ? "PASS: public queries work and the plate columns are not readable"
    : broken > 0
      ? `FAIL: ${broken} public query/queries broken`
      : `LEAK OPEN: ${leaked} sensitive column(s) still readable`;
  console.log(JSON.stringify(out, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
