import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { importEncar } from "../src/server/imports/encar";
import { encarClient } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const target = Number(process.env.ENCAR_NEW_STAGING_TARGET ?? 50);
const maxPages = Number(process.env.ENCAR_NEW_STAGING_MAX_PAGES ?? 6);
const discoveryPool = Math.max(target, Number(process.env.ENCAR_NEW_DISCOVERY_POOL ?? target * 2));
const preflightConcurrency = Math.max(1, Math.min(6, Number(process.env.ENCAR_NEW_PREFLIGHT_CONCURRENCY ?? 3)));
if (!Number.isInteger(target) || target < 1) throw new Error("ENCAR_NEW_STAGING_TARGET must be a positive integer");
if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("ENCAR_NEW_STAGING_MAX_PAGES must be a positive integer");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service key are required");
const supabaseUrl = url;
const supabaseKey = key;

type CandidateDraft = {
  source: "encar";
  sourceListingId: string;
  sourceUrl: string;
  brand: string | null;
  model: string | null;
  year: number | null;
};

type Preflight = { candidate: CandidateDraft; status: "ready" | "unknown" | "dummy" | "contract" | "duplicate_vehicle"; vehicleNoHash: string | null; error?: string };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const vehicleNoHash = (value: unknown) => {
  const key = String(value ?? "").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
  return key ? createHash("sha256").update(key).digest("hex") : null;
};

async function preflight(candidate: CandidateDraft): Promise<Preflight> {
  try {
    const detail = await encarClient.publicRequest<unknown>(`https://api.encar.com/v1/readside/vehicle/${candidate.sourceListingId}`);
    const body = obj(detail), manage = obj(body.manage), advertisement = obj(body.advertisement);
    const hash = vehicleNoHash(body.vehicleNo);
    if (manage.dummy === true) return { candidate, status: "dummy", vehicleNoHash: hash };
    if (advertisement.salesStatus === "CONTRACT") return { candidate, status: "contract", vehicleNoHash: hash };
    return { candidate, status: "ready", vehicleNoHash: hash };
  } catch (error) {
    // A temporary proxy/source error must not discard a potentially good car.
    return { candidate, status: "unknown", vehicleNoHash: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function inParallel<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

async function main() {
  // This calls Encar but stays dry-run: no rows are inserted into cars.
  const discovery = await importEncar({
    target: discoveryPool,
    maxPages,
    onlyNew: true,
    dryRun: true,
    electricTarget: 0,
    electricPages: 0,
    hybridTarget: 0,
    hybridPages: 0,
    collectNewCandidateDrafts: "raw",
  });
  const discovered = (discovery.candidateDrafts ?? []) as CandidateDraft[];
  if (discovered.length < target) {
    throw new Error(`Only ${discovered.length} new candidates passed discovery; target is ${target}. No staging run was created.`);
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Keep this run isolated: don't enrich Encar IDs already present in any
  // historical enrichment queue, even if they were not inserted into cars.
  const discoveredIds = [...new Set(discovered.map((candidate) => candidate.sourceListingId))];
  const previouslyQueuedIds = new Set<string>();
  for (let index = 0; index < discoveredIds.length; index += 200) {
    const chunk = discoveredIds.slice(index, index + 200);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from("encar_enrichment_queue")
        .select("source_listing_id")
        .in("source_listing_id", chunk)
        .range(offset, offset + 999);
      if (error) throw new Error(`Failed to exclude previously queued Encar IDs: ${error.message}`);
      for (const row of data ?? []) previouslyQueuedIds.add(String(row.source_listing_id));
      if (!data || data.length < 1000) break;
    }
  }
  const discoveredUnique = new Map<string, CandidateDraft>();
  for (const candidate of discovered) {
    if (!previouslyQueuedIds.has(candidate.sourceListingId)) discoveredUnique.set(candidate.sourceListingId, candidate);
  }
  const neverQueued = [...discoveredUnique.values()];
  if (neverQueued.length < target) {
    throw new Error(`Only ${neverQueued.length} never-queued candidates remain after excluding ${previouslyQueuedIds.size} prior queue IDs; target is ${target}. No staging run was created.`);
  }

  const preflightRows = await inParallel(neverQueued, preflightConcurrency, preflight);
  const hashes = preflightRows.flatMap((row) => row.vehicleNoHash ? [row.vehicleNoHash] : []);
  const knownHashes = new Set<string>();
  for (let index = 0; index < hashes.length; index += 200) {
    const { data, error } = await db.from("cars").select("vehicle_no_hash")
      .eq("is_available", true).in("vehicle_no_hash", hashes.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.vehicle_no_hash) knownHashes.add(String(row.vehicle_no_hash));
  }
  const seenVehicleHashes = new Set<string>();
  for (const row of preflightRows) {
    if (row.status !== "ready" || !row.vehicleNoHash) continue;
    if (knownHashes.has(row.vehicleNoHash) || seenVehicleHashes.has(row.vehicleNoHash)) {
      row.status = "duplicate_vehicle";
      continue;
    }
    seenVehicleHashes.add(row.vehicleNoHash);
  }
  const candidates = preflightRows.filter((row) => row.status === "ready" || row.status === "unknown").slice(0, target);
  if (candidates.length !== target) {
    const counts = Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length]));
    throw new Error(`Only ${candidates.length} candidates passed preflight; target is ${target}. Increase ENCAR_NEW_DISCOVERY_POOL. ${JSON.stringify(counts)}`);
  }
  const { data: run, error: runError } = await db
    .from("encar_enrichment_runs")
    .insert({
      project: "tl-auto",
      purpose: "full",
      priority: 40,
      status: "awaiting_approval",
      requested_limit: candidates.length,
      candidate_count: candidates.length,
      rules_version: "new-candidate-staging-v3-run-isolation",
      summary: {
        source: "encar",
        onlyNew: true,
        electricTarget: 0,
        hybridTarget: 0,
        maxPages,
        discovery: {
          candidates: discovery.candidates,
          existingCandidates: discovery.existingCandidates,
          freshCandidates: discovery.freshCandidates,
          seen: discovery.seen,
        },
        excludedPreviouslyQueued: previouslyQueuedIds.size,
        preflight: Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length])),
      },
    })
    .select("id,status,candidate_count")
    .single();
  if (runError) throw new Error(runError.message);

  const queueRows = candidates.map(({ candidate, status, vehicleNoHash, error }) => ({
    run_id: run.id,
    source: candidate.source,
    source_listing_id: candidate.sourceListingId,
    source_url: candidate.sourceUrl,
    task: {
      insurance: true,
      options: true,
      gallery: true,
      diagnosis: true,
      sellingpoint: true,
      contents: true,
      history: true,
      category: false,
    },
    candidate_snapshot: { ...candidate, preflight: { status, vehicleNoHash, ...(error ? { error } : {}) } },
  }));
  const { error: queueError } = await db.from("encar_enrichment_queue").insert(queueRows);
  if (queueError) throw new Error(queueError.message);

  console.log(JSON.stringify({
    run,
    staged: candidates.length,
    sourcePolicy: "only Encar IDs absent from cars and all prior Encar enrichment queues; combustion only; preflight excludes dummy, CONTRACT and active/in-batch vehicle-number duplicates; transient preflight errors are retained; no cars inserted; no publication",
    discovery: { candidates: discovery.candidates, existingCandidates: discovery.existingCandidates, freshCandidates: discovery.freshCandidates, seen: discovery.seen },
    excludedPreviouslyQueued: previouslyQueuedIds.size,
    preflight: Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
