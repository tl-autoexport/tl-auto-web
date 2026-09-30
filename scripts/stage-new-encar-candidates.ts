import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { importEncar } from "../src/server/imports/encar";
import { encarClient } from "../src/server/imports/encar-client";
import { deduplicateNewEncarPreflightRows, selectNewEncarStagingRows, type NewEncarPreflightRow } from "../src/server/catalog/new-encar-preflight-deduplication";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const target = Number(process.env.ENCAR_NEW_STAGING_TARGET ?? 50);
const minimum = Number(process.env.ENCAR_NEW_STAGING_MINIMUM ?? target);
const maxPages = Number(process.env.ENCAR_NEW_STAGING_MAX_PAGES ?? 6);
const discoveryPool = Math.max(target, Number(process.env.ENCAR_NEW_DISCOVERY_POOL ?? target * 2));
const preflightConcurrency = Math.max(1, Math.min(6, Number(process.env.ENCAR_NEW_PREFLIGHT_CONCURRENCY ?? 3)));
const requestedFuelTypes = (process.env.ENCAR_NEW_STAGING_FUEL_TYPES ?? "gasoline,diesel")
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const allowedFuelTypes = new Set(requestedFuelTypes);
const allowedBrands = (process.env.ENCAR_NEW_STAGING_BRANDS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const fuelPages = Number(process.env.ENCAR_NEW_STAGING_FUEL_PAGES ?? 30);
const checkpointPath = process.env.ENCAR_NEW_STAGING_CHECKPOINT?.trim();
if (!Number.isInteger(target) || target < 1) throw new Error("ENCAR_NEW_STAGING_TARGET must be a positive integer");
if (!Number.isInteger(minimum) || minimum < 1 || minimum > target) throw new Error("ENCAR_NEW_STAGING_MINIMUM must be an integer from 1 to ENCAR_NEW_STAGING_TARGET");
if (minimum < target && !checkpointPath) throw new Error("ENCAR_NEW_STAGING_CHECKPOINT is required when accepting a partial cohort");
if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("ENCAR_NEW_STAGING_MAX_PAGES must be a positive integer");
if (!Number.isInteger(fuelPages) || fuelPages < 0) throw new Error("ENCAR_NEW_STAGING_FUEL_PAGES must be a non-negative integer");
if (!requestedFuelTypes.length || requestedFuelTypes.some((fuel) => !["gasoline", "diesel", "lpg", "electric", "hybrid"].includes(fuel))) {
  throw new Error("ENCAR_NEW_STAGING_FUEL_TYPES must contain gasoline, diesel, lpg, electric, or hybrid");
}

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
  fuelType?: string | null;
};

type Preflight = NewEncarPreflightRow<CandidateDraft>;
type DiscoverySummary = { candidates: number; existingCandidates: number; freshCandidates: number; seen: number };
type StageCheckpoint = {
  version: 1;
  policy: string;
  discovery: DiscoverySummary;
  discovered: CandidateDraft[];
  preflight: Preflight[];
  runId?: string;
  selectedSourceIds?: string[];
};
const checkpointPolicy = JSON.stringify({
  discoveryPool, maxPages, fuelPages, fuels: [...allowedFuelTypes], brands: allowedBrands,
  maxListingAgeDays: process.env.CATALOG_MAX_LISTING_AGE_DAYS ?? null,
  minYear: process.env.ENCAR_MIN_YEAR ?? null, maxYear: process.env.ENCAR_MAX_YEAR ?? null,
  minMileage: process.env.ENCAR_MIN_MILEAGE ?? null, maxMileage: process.env.ENCAR_MAX_MILEAGE ?? null,
  minPrice: process.env.ENCAR_MIN_PRICE ?? null, maxPrice: process.env.ENCAR_MAX_PRICE ?? null,
});
async function saveCheckpoint(value: StageCheckpoint) {
  if (!checkpointPath) return;
  await mkdir(dirname(checkpointPath), { recursive: true });
  const temp = `${checkpointPath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, checkpointPath);
}
async function loadCheckpoint(): Promise<StageCheckpoint | null> {
  if (!checkpointPath) return null;
  let contents: string;
  try {
    contents = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const saved = JSON.parse(contents) as StageCheckpoint;
  if (saved.version !== 1 || saved.policy !== checkpointPolicy || !Array.isArray(saved.discovered) || !Array.isArray(saved.preflight)) {
    throw new Error(`Checkpoint policy or format does not match: ${checkpointPath}`);
  }
  return saved;
}
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
  // Save source results locally before any DB writes so a shortage or interruption can resume.
  const savedCheckpoint = await loadCheckpoint();
  let checkpoint: StageCheckpoint;
  if (savedCheckpoint) {
    checkpoint = savedCheckpoint;
  } else {
    const combustionRequested = allowedFuelTypes.has("gasoline") || allowedFuelTypes.has("diesel");
    const discovery = await importEncar({
      target: discoveryPool,
      maxPages: combustionRequested ? maxPages : 0,
      onlyNew: true,
      dryRun: true,
      electricTarget: 0,
      electricPages: allowedFuelTypes.has("electric") ? fuelPages : 0,
      hybridTarget: 0,
      hybridPages: allowedFuelTypes.has("hybrid") ? fuelPages : 0,
      allowedBrands,
      collectNewCandidateDrafts: "raw",
    });
    checkpoint = {
      version: 1, policy: checkpointPolicy,
      discovery: { candidates: discovery.candidates, existingCandidates: discovery.existingCandidates,
        freshCandidates: discovery.freshCandidates, seen: discovery.seen ?? 0 },
      discovered: ((discovery.candidateDrafts ?? []) as CandidateDraft[])
        .filter((candidate) => allowedFuelTypes.has(String(candidate.fuelType ?? "").toLowerCase())),
      preflight: [],
    };
    await saveCheckpoint(checkpoint);
  }
  const discovered = checkpoint.discovered;
  if (discovered.length < minimum) {
    throw new Error(`Only ${discovered.length} new candidates passed discovery; minimum is ${minimum}. Checkpoint saved at ${checkpointPath ?? "disabled"}.`);
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
        .select("run_id,source_listing_id")
        .in("source_listing_id", chunk)
        .range(offset, offset + 999);
      if (error) throw new Error(`Failed to exclude previously queued Encar IDs: ${error.message}`);
      for (const row of data ?? []) {
        if (row.run_id !== checkpoint.runId) previouslyQueuedIds.add(String(row.source_listing_id));
      }
      if (!data || data.length < 1000) break;
    }
  }
  const discoveredUnique = new Map<string, CandidateDraft>();
  for (const candidate of discovered) {
    if (!previouslyQueuedIds.has(candidate.sourceListingId)) discoveredUnique.set(candidate.sourceListingId, candidate);
  }
  const neverQueued = [...discoveredUnique.values()];
  if (neverQueued.length < minimum) {
    throw new Error(`Only ${neverQueued.length} never-queued candidates remain after excluding ${previouslyQueuedIds.size} prior queue IDs; minimum is ${minimum}. Checkpoint saved.`);
  }

  const cachedRows = new Map(checkpoint.preflight.map((row) => [row.candidate.sourceListingId, row]));
  if (cachedRows.size !== checkpoint.preflight.length || checkpoint.preflight.some((row) => !discoveredIds.includes(row.candidate.sourceListingId))) {
    throw new Error("Checkpoint contains duplicate or foreign preflight IDs");
  }
  const knownHashes = new Set<string>();
  const checkedHashes = new Set<string>();
  async function refreshKnownHashes() {
    const hashes = [...new Set([...cachedRows.values()].flatMap((row) => row.vehicleNoHash ? [row.vehicleNoHash] : []))]
      .filter((hash) => !checkedHashes.has(hash));
    for (let index = 0; index < hashes.length; index += 200) {
      const chunk = hashes.slice(index, index + 200);
      const { data, error } = await db.from("cars").select("vehicle_no_hash")
        .eq("is_available", true).in("vehicle_no_hash", chunk);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) if (row.vehicle_no_hash) knownHashes.add(String(row.vehicle_no_hash));
      for (const hash of chunk) checkedHashes.add(hash);
    }
  }
  function deduplicatedCheckedRows() {
    return deduplicateNewEncarPreflightRows(
      neverQueued.flatMap((candidate) => {
        const row = cachedRows.get(candidate.sourceListingId);
        return row ? [row] : [];
      }), knownHashes,
    );
  }
  const unchecked = neverQueued.filter((candidate) => !cachedRows.has(candidate.sourceListingId));
  for (let index = 0; index < unchecked.length; index += 20) {
    if (checkpoint.selectedSourceIds) break;
    if ([...cachedRows.values()].filter((row) => row.status === "ready" || row.status === "unknown").length >= target) {
      await refreshKnownHashes();
      if (deduplicatedCheckedRows().filter((row) => row.status === "ready" || row.status === "unknown").length >= target) break;
    }
    const batch = await inParallel(unchecked.slice(index, index + 20), preflightConcurrency, preflight);
    for (const row of batch) cachedRows.set(row.candidate.sourceListingId, row);
    checkpoint.preflight = [...cachedRows.values()];
    await saveCheckpoint(checkpoint);
    console.log(JSON.stringify({ event: "preflight_progress", checked: Math.min(index + 20, unchecked.length),
      remaining: Math.max(0, unchecked.length - index - 20), cached: cachedRows.size }));
  }
  await refreshKnownHashes();
  // Also deduplicate against earlier ready rows from this same discovery pool;
  // previously only duplicates already present in cars were excluded.
  const preflightRows = deduplicatedCheckedRows();
  const { candidates: eligible } = selectNewEncarStagingRows(preflightRows, target, minimum);
  const selectedIds = checkpoint.selectedSourceIds ?? eligible.slice(0, target).map((row) => row.candidate.sourceListingId);
  const selectedIdSet = new Set(selectedIds);
  const candidates = eligible.filter((row) => selectedIdSet.has(row.candidate.sourceListingId));
  if (selectedIdSet.size !== selectedIds.length || candidates.length !== selectedIds.length || candidates.length > target) {
    throw new Error("Selected checkpoint IDs no longer match eligible candidates");
  }
  if (!selectNewEncarStagingRows(candidates, target, minimum).meetsMinimum) {
    const counts = Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length]));
    throw new Error(`Only ${candidates.length} candidates passed preflight; minimum is ${minimum}. Checkpoint saved at ${checkpointPath ?? "disabled"}. ${JSON.stringify(counts)}`);
  }
  if (!checkpoint.selectedSourceIds) {
    checkpoint.selectedSourceIds = selectedIds;
    checkpoint.runId = randomUUID();
    await saveCheckpoint(checkpoint);
  }
  if (!checkpoint.runId) throw new Error("Checkpoint selected IDs have no run ID");
  const selectedFuelCounts = Object.fromEntries([...allowedFuelTypes].map((fuel) => [
    fuel, candidates.filter((row) => String(row.candidate.fuelType ?? "").toLowerCase() === fuel).length,
  ]));
  const selectedBrandCounts = candidates.reduce<Record<string, number>>((counts, row) => {
    const brand = row.candidate.brand ?? "unknown";
    counts[brand] = (counts[brand] ?? 0) + 1;
    return counts;
  }, {});
  const { data: existingRun, error: existingRunError } = await db.from("encar_enrichment_runs")
    .select("id,status,candidate_count").eq("id", checkpoint.runId!).maybeSingle();
  if (existingRunError) throw new Error(existingRunError.message);
  const insertedRun = existingRun ? null : await db.from("encar_enrichment_runs").insert({
      id: checkpoint.runId,
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
        requestedTarget: target,
        minimumAccepted: minimum,
        allowedFuelTypes: [...allowedFuelTypes],
        allowedBrands: allowedBrands.length ? allowedBrands : null,
        selectedFuelCounts,
        selectedBrandCounts,
        electricTarget: 0,
        hybridTarget: 0,
        fuelPages,
        maxPages,
        discovery: checkpoint.discovery,
        excludedPreviouslyQueued: previouslyQueuedIds.size,
        preflight: Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length])),
      },
    }).select("id,status,candidate_count").single();
  if (insertedRun?.error) throw new Error(insertedRun.error.message);
  const run = existingRun ?? insertedRun?.data;
  if (!run || run.candidate_count !== candidates.length || run.status !== "awaiting_approval") {
    throw new Error(`Checkpoint run cannot be staged: ${JSON.stringify(run)}`);
  }

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
  const { error: queueError } = await db.from("encar_enrichment_queue")
    .upsert(queueRows, { onConflict: "run_id,source,source_listing_id", ignoreDuplicates: true });
  if (queueError) throw new Error(queueError.message);
  const stagedRows: Array<{ source_listing_id: string; status: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("encar_enrichment_queue")
      .select("source_listing_id,status").eq("run_id", run.id).range(offset, offset + 999);
    if (error) throw new Error(error.message);
    stagedRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (stagedRows.length !== candidates.length ||
      stagedRows.some((row) => row.status !== "queued" || !selectedIdSet.has(String(row.source_listing_id)))) {
    throw new Error(`Queue verification failed for run ${run.id}; checkpoint retained`);
  }

  console.log(JSON.stringify({
    run,
    staged: candidates.length,
    requestedTarget: target,
    minimumAccepted: minimum,
    sourcePolicy: `only Encar IDs absent from cars and all prior Encar enrichment queues; fuel=${[...allowedFuelTypes].join(",")}; brands=${allowedBrands.join(",") || "all"}; preflight excludes dummy, CONTRACT and active/in-batch vehicle-number duplicates; transient preflight errors are retained; no cars inserted; no publication`,
    discovery: checkpoint.discovery,
    checkpoint: checkpointPath ?? null,
    preflightChecked: preflightRows.length,
    preflightUnqueried: neverQueued.length - preflightRows.length,
    excludedPreviouslyQueued: previouslyQueuedIds.size,
    preflight: Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"].map((status) => [status, preflightRows.filter((row) => row.status === status).length])),
    selectedFuelCounts,
    selectedBrandCounts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
