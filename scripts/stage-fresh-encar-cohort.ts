import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const inputPath = process.env.ENCAR_FRESH_OUTPUT ?? "output/encar-fresh-candidates.json";
const target = Number(process.env.ENCAR_FRESH_TARGET ?? 500);
const maxListingAgeDays = Number(process.env.ENCAR_FRESH_MAX_AGE_DAYS ?? 30);
const runId = randomUUID();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("Supabase URL and service-role key are required");
const supabaseUrl: string = url;
const serviceKey: string = key;

type Candidate = {
  source: "encar";
  sourceListingId: string;
  sourceUrl: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  fuelType: "gasoline" | "diesel" | "lpg";
  firstAdvertisedAt: string;
  listedAt: string | null;
};
type Report = { mode: string; target: number; selectedCount: number; maxListingAgeDays: number; candidates: Candidate[] };

async function main() {
  const report = JSON.parse(await readFile(inputPath, "utf8")) as Report;
  if (report.mode !== "read_only_discovery" || report.target !== target || report.selectedCount !== target || report.candidates?.length !== target)
    throw new Error(`Discovery report must contain exactly ${target} selected candidates`);
  if (report.maxListingAgeDays !== maxListingAgeDays) throw new Error("Discovery report age window does not match staging settings");
  const now = Date.now();
  const ids = report.candidates.map((row) => String(row.sourceListingId));
  if (ids.some((id) => !/^\d{5,}$/.test(id)) || new Set(ids).size !== target) throw new Error("Report contains invalid or duplicate Encar IDs");
  if (report.candidates.some((row) => !["gasoline", "diesel", "lpg"].includes(row.fuelType) ||
      !Number.isFinite(Date.parse(row.firstAdvertisedAt)) || now - Date.parse(row.firstAdvertisedAt) > maxListingAgeDays * 86_400_000))
    throw new Error("Report contains unsupported fuel or listing outside the freshness window");
  const fuelCounts = report.candidates.reduce<Record<string, number>>((counts, row) => {
    counts[row.fuelType] = (counts[row.fuelType] ?? 0) + 1;
    return counts;
  }, {});

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existingCars = new Set<string>();
  const existingQueue = new Set<string>();
  for (let start = 0; start < ids.length; start += 200) {
    const part = ids.slice(start, start + 200);
    const [cars, queue] = await Promise.all([
      db.from("cars").select("source_id").eq("primary_source", "encar").in("source_id", part),
      db.from("encar_enrichment_queue").select("source_listing_id").eq("source", "encar").in("source_listing_id", part),
    ]);
    if (cars.error || queue.error) throw new Error(cars.error?.message ?? queue.error?.message);
    for (const row of cars.data ?? []) if (row.source_id) existingCars.add(String(row.source_id));
    for (const row of queue.data ?? []) if (row.source_listing_id) existingQueue.add(String(row.source_listing_id));
  }
  if (existingCars.size || existingQueue.size)
    throw new Error(`Refusing partial staging: ${existingCars.size} IDs now exist in cars and ${existingQueue.size} in prior queues`);

  const run = await db.from("encar_enrichment_runs").insert({
    id: runId, project: "tl-auto", purpose: "full", priority: 40,
    status: "awaiting_approval", requested_limit: target, candidate_count: target,
    rules_version: "fresh-first-advertised-30d-v1",
    summary: {
      source: "encar", discoveryReport: inputPath, freshnessField: "manage.firstAdvertisedDateTime",
      maxListingAgeDays, selectedFuelCounts: fuelCounts, stagedFromSavedDiscovery: true,
      noCarsInserted: true, noPublication: true,
    },
  }).select("id,status,candidate_count").single();
  if (run.error) throw new Error(`Could not create enrichment run: ${run.error.message}`);

  const queueRows = report.candidates.map((candidate) => ({
    run_id: runId, source: "encar", source_listing_id: candidate.sourceListingId,
    source_url: candidate.sourceUrl,
    task: { insurance: true, options: true, gallery: true, diagnosis: true, sellingpoint: true, contents: true, history: true, category: false },
    candidate_snapshot: { ...candidate, cohort: "fresh-first-advertised-30d" },
  }));
  const queued = await db.from("encar_enrichment_queue").insert(queueRows);
  if (queued.error) throw new Error(`Queue insert failed for run ${runId}; run remains awaiting_approval: ${queued.error.message}`);
  const verify = await db.from("encar_enrichment_queue").select("source_listing_id,status").eq("run_id", runId);
  if (verify.error) throw new Error(`Queue verification failed for run ${runId}: ${verify.error.message}`);
  const rows = verify.data ?? [];
  if (rows.length !== target || rows.some((row) => row.status !== "queued"))
    throw new Error(`Queue verification mismatch for run ${runId}: ${rows.length} rows`);
  console.log(JSON.stringify({ run: run.data, staged: rows.length, sourceFreshness: `first advertised within ${maxListingAgeDays} days`, fuelCounts, status: "awaiting_approval", publicCatalogChanged: false }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
