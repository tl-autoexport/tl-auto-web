/** Stage a fixed, reviewed classic Encar discovery report into its own enrichment run. */
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { encarClient } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const inputPath = process.env.TL_AUTO_CLASSIC_ENRICHMENT_INPUT ??
  "output/tl-auto-classic-30plus-by-brand.json";
const reportPath = process.env.TL_AUTO_CLASSIC_ENRICHMENT_REPORT ??
  "output/tl-auto-classic-enrichment-staging.json";
const requestDelayMs = Number(process.env.TL_AUTO_CLASSIC_PREFLIGHT_DELAY_MS ?? 1_500);
const expectedCount = Number(process.env.TL_AUTO_CLASSIC_EXPECTED_COUNT ?? 35);
const task = {
  insurance: true, options: true, gallery: true, diagnosis: true,
  sellingpoint: true, contents: true, history: true, category: false,
};

type Candidate = {
  sourceListingId: string;
  sourceUrl?: string;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  fuelType?: string | null;
  mileageKm?: number | null;
  priceKrw?: number | null;
  [key: string]: unknown;
};
type Preflight = {
  candidate: Candidate;
  status: "ready" | "unknown" | "dummy" | "contract" | "duplicate_vehicle";
  vehicleNoHash: string | null;
  error?: string;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hashPlate = (value: unknown) => {
  const normalized = String(value ?? "").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
};

async function preflight(candidate: Candidate): Promise<Preflight> {
  try {
    const body = obj(await encarClient.publicRequest<unknown>(
      `https://api.encar.com/v1/readside/vehicle/${candidate.sourceListingId}`,
    ));
    const manage = obj(body.manage), advertisement = obj(body.advertisement);
    const vehicleNoHash = hashPlate(body.vehicleNo);
    if (manage.dummy === true) return { candidate, status: "dummy", vehicleNoHash };
    if (advertisement.salesStatus === "CONTRACT") return { candidate, status: "contract", vehicleNoHash };
    return { candidate, status: "ready", vehicleNoHash };
  } catch (error) {
    return {
      candidate, status: "unknown", vehicleNoHash: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 500)
    throw new Error("TL_AUTO_CLASSIC_EXPECTED_COUNT must be an integer from 1 to 500");
  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 900 || requestDelayMs > 60_000)
    throw new Error("TL_AUTO_CLASSIC_PREFLIGHT_DELAY_MS must be an integer from 900 to 60000");
  if (!process.env.ENCAR_PROXY_URL?.trim())
    throw new Error("ENCAR_PROXY_URL is required; classic candidate preflight must use the configured proxy");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !serviceKey) throw new Error("Supabase URL and service-role key are required");
  try {
    await access(reportPath);
    throw new Error(`Refusing to overwrite existing report: ${reportPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to overwrite")) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const input = JSON.parse(await readFile(inputPath, "utf8")) as { candidates?: Candidate[]; discovery?: unknown };
  if (!Array.isArray(input.candidates) || input.candidates.length !== expectedCount)
    throw new Error(`Expected exactly ${expectedCount} fixed candidates in ${inputPath}; got ${input.candidates?.length ?? "none"}`);
  const candidates = input.candidates.map((row) => {
    const id = String(row.sourceListingId ?? "").trim();
    const year = Number(row.year);
    if (!/^\d{5,}$/.test(id)) throw new Error(`Invalid Encar listing ID: ${id || "empty"}`);
    if (!Number.isInteger(year) || year < 1900 || year > 1996)
      throw new Error(`Candidate ${id} is outside the reviewed classic year range`);
    return {
      ...row,
      sourceListingId: id,
      source: "encar" as const,
      sourceUrl: `https://fem.encar.com/cars/detail/${id}`,
    };
  });
  const ids = candidates.map((row) => row.sourceListingId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate listing IDs in fixed discovery report");

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const priorQueueIds = new Set<string>();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await db.from("encar_enrichment_queue")
      .select("source_listing_id").eq("source", "encar").in("source_listing_id", ids.slice(start, start + 200));
    if (error) throw new Error(`Prior queue lookup failed: ${error.message}`);
    for (const row of data ?? []) priorQueueIds.add(String(row.source_listing_id));
  }
  const { data: existingCars, error: carsError } = await db.from("cars")
    .select("source_id").eq("primary_source", "encar").in("source_id", ids);
  if (carsError) throw new Error(`Existing catalog lookup failed: ${carsError.message}`);
  const catalogIds = new Set((existingCars ?? []).map((row) => String(row.source_id)));
  const eligible = candidates.filter((row) => !priorQueueIds.has(row.sourceListingId) && !catalogIds.has(row.sourceListingId));

  const checks: Preflight[] = [];
  for (const [index, candidate] of eligible.entries()) {
    if (index > 0) await sleep(requestDelayMs);
    checks.push(await preflight(candidate));
    if ((index + 1) % 10 === 0 || index + 1 === eligible.length)
      console.log(JSON.stringify({ event: "preflight_progress", checked: index + 1, total: eligible.length }));
  }

  const hashes = [...new Set(checks.flatMap((row) => row.vehicleNoHash ? [row.vehicleNoHash] : []))];
  const activeHashes = new Set<string>();
  for (let start = 0; start < hashes.length; start += 200) {
    const { data, error } = await db.from("cars").select("vehicle_no_hash")
      .eq("is_available", true).in("vehicle_no_hash", hashes.slice(start, start + 200));
    if (error) throw new Error(`Active vehicle duplicate lookup failed: ${error.message}`);
    for (const row of data ?? []) if (row.vehicle_no_hash) activeHashes.add(String(row.vehicle_no_hash));
  }
  const seenHashes = new Set<string>();
  const reviewed = checks.map((row) => {
    if (row.status !== "ready" || !row.vehicleNoHash) return row;
    if (activeHashes.has(row.vehicleNoHash) || seenHashes.has(row.vehicleNoHash))
      return { ...row, status: "duplicate_vehicle" as const };
    seenHashes.add(row.vehicleNoHash);
    return row;
  });
  const selected = reviewed.filter((row) => row.status === "ready" || row.status === "unknown");
  if (!selected.length) throw new Error("No eligible listings remain after safety checks; no run created");

  const counts = Object.fromEntries(["ready", "unknown", "dummy", "contract", "duplicate_vehicle"]
    .map((status) => [status, reviewed.filter((row) => row.status === status).length]));
  const runResult = await db.from("encar_enrichment_runs").insert({
    project: "tl-auto", purpose: "full", priority: 40, status: "awaiting_approval",
    requested_limit: selected.length, candidate_count: selected.length,
    rules_version: "classic-30plus-fixed-cohort-v1",
    summary: {
      source: "encar", cohort: "classic-30plus", inputPath, inputCandidateCount: candidates.length,
      requestedDelayMs: requestDelayMs, excludedPreviouslyQueued: priorQueueIds.size,
      excludedAlreadyInCatalog: catalogIds.size, preflight: counts,
      noCarsInserted: true, noPublication: true,
    },
  }).select("id,status,candidate_count").single();
  if (runResult.error) throw new Error(`Could not create isolated run: ${runResult.error.message}`);

  const queueRows = selected.map(({ candidate, status, vehicleNoHash, error }) => ({
    run_id: runResult.data.id, source: "encar", source_listing_id: candidate.sourceListingId,
    source_url: candidate.sourceUrl,
    task,
    candidate_snapshot: {
      ...candidate,
      preflight: { status, vehicleNoHash, ...(error ? { error } : {}) },
      cohort: "classic-30plus",
    },
  }));
  const { error: queueError } = await db.from("encar_enrichment_queue").insert(queueRows);
  if (queueError) {
    // Best-effort cleanup only of the just-created, still-unapproved empty run.
    await db.from("encar_enrichment_runs").delete().eq("id", runResult.data.id).eq("status", "awaiting_approval");
    throw new Error(`Queue insert failed; attempted cleanup of new run ${runResult.data.id}: ${queueError.message}`);
  }

  const report = {
    generatedAt: new Date().toISOString(), run: runResult.data,
    cohort: "classic-30plus", inputCandidateCount: candidates.length,
    queued: selected.length, excludedPreviouslyQueued: priorQueueIds.size,
    excludedAlreadyInCatalog: catalogIds.size, preflight: counts,
    excludedIds: reviewed.filter((row) => !["ready", "unknown"].includes(row.status))
      .map((row) => ({ sourceListingId: row.candidate.sourceListingId, status: row.status })),
    readOnlyForCarsAndPublication: true,
    proxyConfigured: Boolean(process.env.ENCAR_PROXY_URL?.trim()),
    requestDelayMs,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ ...report, output: reportPath }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
