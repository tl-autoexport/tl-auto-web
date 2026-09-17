import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";

config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID ?? "349fe610-17e0-4df8-8053-bcd7d234983d";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service key are required");

type QueueRow = { source_listing_id: string; status: string; task: Record<string, boolean>; result: Record<string, unknown> | null };
type StageRow = { source_listing_id: string; raw_payload: Record<string, unknown> | null; normalized: Record<string, unknown> | null };
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ready = (result: Record<string, unknown> | null, block: string) =>
  (result?.probes as Record<string, Record<string, unknown>> | undefined)?.[
    block === "insurance" ? "inspection" : block === "gallery" ? "detail" : block
  ]?.classification === "ready";

async function main() {
  const queue: QueueRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("encar_enrichment_queue")
      .select("source_listing_id,status,task,result")
      .eq("run_id", runId).range(from, from + 999);
    if (error) throw new Error(error.message);
    queue.push(...((data ?? []) as QueueRow[]));
    if (!data || data.length < 1000) break;
  }

  const staging: StageRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("encar_enrichment_staging")
      .select("source_listing_id,raw_payload,normalized")
      .eq("run_id", runId).range(from, from + 999);
    if (error) throw new Error(error.message);
    staging.push(...((data ?? []) as StageRow[]));
    if (!data || data.length < 1000) break;
  }

  const stageById = new Map(staging.map((row) => [row.source_listing_id, row]));
  const approved: string[] = [];
  const manualReview: Array<{ sourceListingId: string; missingBlocks: string[] }> = [];
  const unavailable: string[] = [];

  for (const row of queue) {
    if (row.status === "unavailable") { unavailable.push(row.source_listing_id); continue; }
    if (row.status !== "succeeded") continue;
    const missingBlocks = Object.entries(row.task ?? {})
      .filter(([, required]) => required)
      .map(([block]) => block)
      .filter((block) => !ready(row.result, block));
    const stage = stageById.get(row.source_listing_id);
    if (!stage?.raw_payload || !stage.normalized) missingBlocks.push("staging_payload");
    if (missingBlocks.length) manualReview.push({ sourceListingId: row.source_listing_id, missingBlocks });
    else approved.push(row.source_listing_id);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runId,
    readOnly: true,
    encarRequests: 0,
    databaseWrites: 0,
    queueRows: queue.length,
    stagingRows: staging.length,
    counts: { approved: approved.length, manualReview: manualReview.length, unavailable: unavailable.length },
    approved,
    manualReview,
    unavailable,
  };
  await mkdir("output", { recursive: true });
  await writeFile("output/tl-auto-enrichment-screening.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, approved: undefined, manualReview: undefined, unavailable: undefined, output: "output/tl-auto-enrichment-screening.json" }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
