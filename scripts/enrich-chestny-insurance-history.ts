import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = process.env.ENCAR_HISTORY_ACCESS_TOKEN?.trim() || "WqtHVjmpGX7lWsf63vwCGVPrF1BzYk";
const write = process.env.CHESTNY_HISTORY_DRY_RUN === "false";
const limit = Math.max(1, Number(process.env.CHESTNY_HISTORY_LIMIT ?? 2161));
const concurrency = Math.min(6, Math.max(1, Number(process.env.CHESTNY_HISTORY_CONCURRENCY ?? 4)));
if (!url || !key) throw new Error("TL Auto Supabase admin credentials are required");
type Car = { id: string; source_id: string; vehicle_no_masked: string | null };
type Payload = { accidentHistoryResponse?: Array<Record<string, unknown>>; nonInsurancePeriodResponse?: Array<Record<string, unknown>>; ownerHistoryResponse?: Array<Record<string, unknown>>; [key: string]: unknown };
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("cars").select("id,source_id,vehicle_no_masked").eq("primary_source", "chestny_prigon").eq("is_available", true).order("source_id").range(0, limit - 1);
  if (error) throw error;
  const cars = (data ?? []) as Car[]; let cursor = 0; const results: Array<Record<string, unknown>> = [];
  async function worker() { while (cursor < cars.length) { const car = cars[cursor++]; if (!car) continue; const vehicleNo = text(car.vehicle_no_masked); if (!vehicleNo) { results.push({ sourceId: car.source_id, status: "missing_vehicle_no" }); continue; }
    try {
      const endpoint = new URL("https://api.encar.com/v1/vehicle/resume"); endpoint.searchParams.set("vehicleNo", vehicleNo);
      const response = await fetch(endpoint, { headers: { ...ENCAR_HEADERS, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      if (response.status === 400 || response.status === 404) { results.push({ sourceId: car.source_id, status: "unavailable", http: response.status }); continue; }
      if (!response.ok) throw new Error(`Encar HTTP ${response.status}`);
      const payload = await response.json() as Payload;
      const accidents = (payload.accidentHistoryResponse ?? []).map((event) => ({ accidentDate: text(event.accidentDate), accidentType: text(event.accidentType), repairCost: num(event.repairCost), partCost: num(event.partCost), laborCost: num(event.laborCost), paintingCost: num(event.paintingCost) }));
      const periods = payload.nonInsurancePeriodResponse ?? []; const owners = payload.ownerHistoryResponse ?? [];
      const payout = accidents.reduce((sum, event) => sum + event.repairCost, 0);
      if (write) {
        const { error: carError } = await db.from("cars").update({ accident_count: accidents.length, insurance_payout_count: accidents.length, insurance_payout_total_krw: payout }).eq("id", car.id); if (carError) throw carError;
        const report = { car_id: car.id, source: "encar", report_type: "encar_carhistory", summary: { available: true, accident_count: accidents.length, insurance_payout_count: accidents.length, insurance_payout_total_krw: payout, non_insurance_period_count: periods.length, owner_history_count: owners.length }, items: accidents, raw_payload: payload };
        const { error: reportError } = await db.from("car_condition_reports").upsert(report, { onConflict: "car_id,source,report_type" }); if (reportError) throw reportError;
      }
      results.push({ sourceId: car.source_id, status: write ? "written" : "dry_run", accidents: accidents.length, payoutKrw: payout, uninsuredPeriods: periods.length });
    } catch (err) { results.push({ sourceId: car.source_id, status: "error", error: err instanceof Error ? err.message : String(err) }); }
  }}
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(JSON.stringify({ write, requested: cars.length, available: results.filter((r) => r.status === "written" || r.status === "dry_run").length, written: results.filter((r) => r.status === "written").length, unavailable: results.filter((r) => r.status === "unavailable").length, missingVehicleNo: results.filter((r) => r.status === "missing_vehicle_no").length, errors: results.filter((r) => r.status === "error").slice(0, 20), totalAccidents: results.reduce((n, r) => n + Number(r.accidents ?? 0), 0), totalPayoutKrw: results.reduce((n, r) => n + Number(r.payoutKrw ?? 0), 0), results: cars.length <= 10 ? results : undefined }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
