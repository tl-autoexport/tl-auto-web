import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic table names and untyped Supabase helpers */

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and service-role key are required");

type Car = { id: string; source_id: string; source_url: string | null; primary_source: string; brand: string | null; model: string | null; year: number | null };
const db = createClient<any>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function all<T>(table: string, select: string, extra: (q: any) => any) { const out: T[] = []; for (let from = 0; ; from += 1000) { const q = extra(db.from(table).select(select).range(from, from + 999)); const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`); out.push(...(data ?? [])); if (!data || data.length < 1000) return out; } }
async function main() {
  const cars = await all<Car>("cars", "id,source_id,source_url,primary_source,brand,model,year", (q) => q.eq("is_available", true).in("primary_source", ["encar", "chestny_prigon"]).order("source_id"));
  const ids = cars.map((c) => c.id); const reports = new Set<string>(); const options = new Set<string>(); const media = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const r = await db.from("car_condition_reports").select("car_id,report_type").in("car_id", part);
    if (r.error) throw new Error(`car_condition_reports: ${r.error.message}`);
    const o = await db.from("car_options").select("car_id").in("car_id", part);
    if (o.error) throw new Error(`car_options: ${o.error.message}`);
    const m = await db.from("car_media").select("car_id").in("car_id", part).eq("media_type", "image");
    if (m.error) throw new Error(`car_media: ${m.error.message}`);
    for (const row of r.data ?? []) if (row.report_type === "encar_carhistory") reports.add(row.car_id);
    for (const row of o.data ?? []) options.add(row.car_id);
    for (const row of m.data ?? []) media.set(row.car_id, (media.get(row.car_id) ?? 0) + 1);
  }
  const candidates = cars.filter((c) => !reports.has(c.id)).map((c) => ({ source: c.primary_source, sourceListingId: c.source_id, sourceUrl: c.source_url ?? `https://www.encar.com/dc/dc_cardetailview.do?carid=${c.source_id}`, task: { insurance: true, options: !options.has(c.id), gallery: (media.get(c.id) ?? 0) < 5 }, carId: c.id, brand: c.brand, model: c.model, year: c.year }));
  await mkdir("output", { recursive: true }); await writeFile("output/tl-auto-enrichment-candidates.json", JSON.stringify({ generatedAt: new Date().toISOString(), mode: "read-only", rules: { activeOnly: true, missingInsuranceReport: true, noEncarRequests: true }, summary: { activeCars: cars.length, candidates: candidates.length, missingOptions: candidates.filter((c) => c.task.options).length, missingGallery: candidates.filter((c) => c.task.gallery).length }, candidates }, null, 2));
  console.log(JSON.stringify({ mode: "read-only", encarRequests: 0, databaseWrites: 0, activeCars: cars.length, candidates: candidates.length, missingOptions: candidates.filter((c) => c.task.options).length, missingGallery: candidates.filter((c) => c.task.gallery).length, output: "output/tl-auto-enrichment-candidates.json" }, null, 2));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
