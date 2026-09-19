import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";

config({ path: ".env", quiet: true });
const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID ?? "349fe610-17e0-4df8-8053-bcd7d234983d";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service key are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Queue = { source_listing_id: string; status: string; task: Record<string, boolean>; result: Record<string, unknown> | null };
type Stage = { source_listing_id: string; status: string; raw_payload: Record<string, unknown> | null; normalized: Record<string, unknown> | null };
type Car = { id: string; source_id: string; primary_source: string | null; is_available: boolean | null };
// Table names are dynamic here, so the filter is typed from the client itself
// instead of the generated database types.
type SelectedRows = ReturnType<ReturnType<typeof db.from>["select"]>;
type RowFilter = (query: SelectedRows) => SelectedRows;

async function page<T>(table: string, select: string, filter: RowFilter) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const q = filter(db.from(table).select(select));
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const ready = (q: Queue, block: string) => {
  const probe = block === "insurance" ? "inspection" : block === "gallery" ? "detail" : block;
  return ((q.result?.probes as Record<string, Record<string, unknown>> | undefined)?.[probe]?.classification === "ready");
};
async function main() {
  const queue = await page<Queue>("encar_enrichment_queue", "source_listing_id,status,task,result", (q) => q.eq("run_id", runId));
  const staging = await page<Stage>("encar_enrichment_staging", "source_listing_id,status,raw_payload,normalized", (q) => q.eq("run_id", runId));
  // Published TL Auto rows may have a project-specific primary_source. Match
  // only active cars by the exact source_id, without assuming that value.
  const cars = await page<Car>("cars", "id,source_id,primary_source,is_available", (q) => q.eq("is_available", true));
  const carBySource = new Map(cars.map((car) => [car.source_id, car]));
  const stageBySource = new Map(staging.map((row) => [row.source_listing_id, row]));
  const eligible = queue.filter((q) => q.status === "succeeded" && q.source_listing_id && stageBySource.get(q.source_listing_id)?.raw_payload);
  const matched = eligible.filter((q) => carBySource.has(q.source_listing_id));
  const unmatched = eligible.filter((q) => !carBySource.has(q.source_listing_id)).map((q) => q.source_listing_id);
  const blocks = { insurance: matched.filter((q) => q.task.insurance && ready(q, "insurance")).length, options: matched.filter((q) => q.task.options && ready(q, "options")).length, gallery: matched.filter((q) => q.task.gallery && ready(q, "gallery")).length };
  const report = { generatedAt: new Date().toISOString(), runId, readOnly: true, encarRequests: 0, databaseWrites: 0, sourcePolicy: "existing active cars only; exact source_id match", queueSucceeded: queue.filter((q) => q.status === "succeeded").length, stagingRows: staging.length, activeCarsScanned: cars.length, eligibleSucceededWithPayload: eligible.length, matchedExistingCars: matched.length, unmatchedExistingCars: unmatched.length, blocks, unmatched: unmatched.slice(0, 100) };
  await mkdir("output", { recursive: true });
  await writeFile("output/tl-auto-enrichment-apply-plan.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, output: "output/tl-auto-enrichment-apply-plan.json" }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
