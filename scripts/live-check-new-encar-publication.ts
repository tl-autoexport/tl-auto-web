/**
 * One sequential, read-only Encar live check for the prepared new-listing run.
 * It checks current availability, price, mileage and core configuration only;
 * it never writes to cars or any staging/queue table.
 */
import { Client } from "pg";
import { config } from "dotenv";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encarClient } from "../src/server/imports/encar-client";
import { normalizeBrand, normalizeFuel, normalizeModel } from "../src/server/normalization/vehicles";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID;
const dbUrl = process.env.SUPABASE_DB_URL;
const proxyUrl = process.env.ENCAR_PROXY_URL?.trim();
const planPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.TL_AUTO_LIVE_CHECK_OUTPUT ?? "output/tl-auto-new-encar-live-check.json";
const batchSize = Math.max(1, Math.min(100, Number(process.env.TL_AUTO_LIVE_CHECK_BATCH_SIZE ?? 100)));
const delayMs = Math.max(1_000, Number(process.env.TL_AUTO_LIVE_CHECK_DELAY_MS ?? 2_000));
const timeoutMs = Math.max(5_000, Number(process.env.TL_AUTO_LIVE_CHECK_TIMEOUT_MS ?? 20_000));
const expectedCount = Math.max(1, Number(process.env.TL_AUTO_LIVE_CHECK_EXPECTED_COUNT ?? 491));
const lockPath = `/tmp/tl-auto-encar-live-check-${(runId ?? "unknown").replace(/[^a-zA-Z0-9-]/g, "_")}.lock`;

if (!runId || !dbUrl || !proxyUrl) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID, SUPABASE_DB_URL and ENCAR_PROXY_URL are required; direct Encar requests are disabled");

type Json = Record<string, unknown>;
type PlanCandidate = { sourceListingId: string; status: string; configuration: Json };
type Plan = { runId?: string; candidates?: PlanCandidate[] };
type StagingRow = { source_listing_id: string; source_url: string | null; candidate_snapshot: Json | null; raw_payload: Json | null };
type Ref = AutomaticPowerReferenceRow;
type CheckResult = {
  sourceListingId: string;
  powerClass: "approved" | "preliminary";
  liveStatus: "active" | "unavailable" | "not_advertised" | "error";
  httpStatus: number | null;
  currentPriceKrw: number | null;
  previousPriceKrw: number | null;
  priceChanged: boolean | null;
  currentMileageKm: number | null;
  previousMileageKm: number | null;
  mileageChanged: boolean | null;
  engineCcChanged: boolean | null;
  fuelChanged: boolean | null;
  modelChanged: boolean | null;
  checkedAt: string;
  error?: string;
};

const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const pos = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
};
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function writeReport(report: Json) {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "EEXIST") throw error;
    let ownerPid: number | null = null;
    try { ownerPid = Number((JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown }).pid); } catch { /* Validate stale lock by PID below. */ }
    if (!ownerPid || !Number.isInteger(ownerPid) || ownerPid <= 0) {
      throw new Error(`Live-check lock exists but its PID cannot be verified (${lockPath}); inspect it manually rather than starting another worker`);
    }
    try {
      process.kill(ownerPid, 0);
      throw new Error(`Another live-check worker is running (pid=${ownerPid}); do not start a second worker`);
    } catch (pidError) {
      if (pidError instanceof Error && pidError.message.includes("Another live-check worker")) throw pidError;
      if ((pidError as NodeJS.ErrnoException).code !== "ESRCH") throw pidError;
    }
    const { unlink } = await import("node:fs/promises");
    await unlink(lockPath);
    lock = await open(lockPath, "wx");
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), runId }));
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  let connected = false;
  try {
    const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
    if (plan.runId !== runId) throw new Error(`Power plan runId mismatch (${plan.runId ?? "missing"})`);
    const candidates = plan.candidates ?? [];
    const approved = candidates.filter((candidate) => candidate.status === "approved_match");
    const unmatched = candidates.filter((candidate) => candidate.status === "unmatched");
    await db.connect();
    connected = true;
    await db.query("begin read only");
    const [refsResult, carsResult] = await Promise.all([
      db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
          year_from,year_to,power_hp,power_kw,source,status
        from public.vehicle_power_automatic_reference where status='automatic'`),
      db.query<StagingRow>(`select q.source_listing_id,q.source_url,q.candidate_snapshot,s.raw_payload
        from public.encar_enrichment_queue q
        join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
        where q.run_id=$1 and q.status='succeeded' and s.status='succeeded'`, [runId]),
    ]);
    const refs = refsResult.rows;
    const powerClass = new Map<string, "approved" | "preliminary">();
    for (const candidate of approved) powerClass.set(candidate.sourceListingId, "approved");
    for (const candidate of unmatched) {
      const c = candidate.configuration;
      const match = resolveAutomaticPowerReference({
        brand: String(c.brand ?? ""), model: String(c.model ?? ""), fuel_type: String(c.fuelType ?? ""),
        engine_cc: pos(c.engineCc), drive_type: c.driveType == null ? null : String(c.driveType),
        badge: c.badge == null ? null : String(c.badge), badge_detail: c.trim == null ? null : String(c.trim),
        year: pos(c.year),
      }, refs);
      if (match?.power_hp != null) powerClass.set(candidate.sourceListingId, "preliminary");
    }
    const allRows = new Map(carsResult.rows.map((row) => [row.source_listing_id, row]));
    const targets = [...powerClass.keys()].filter((id) => allRows.has(id)).sort((a, b) => Number(a) - Number(b));
    if (!targets.length) throw new Error("No eligible run candidates found; expected the saved power plan and successful staging rows");
    if (targets.length !== expectedCount) throw new Error(`Eligible cohort changed: expected ${expectedCount}, found ${targets.length}. No Encar requests were made.`);

    let report: Json = { runId, generatedAt: new Date().toISOString(), readOnly: true, proxyRequired: true, databaseWrites: 0, publicCatalogChanged: false, plannedCount: targets.length, batchSize, checkedIds: [] };
    try {
      const previous = JSON.parse(await readFile(outputPath, "utf8")) as Json;
      if (previous.runId === runId && Array.isArray(previous.checkedIds)) report = previous;
    } catch { /* A fresh run starts with an empty checkpoint. */ }
    const results = Array.isArray(report.results) ? report.results as CheckResult[] : [];
    const completed = new Set(results.filter((row) => row.liveStatus !== "error").map((row) => row.sourceListingId));
    const pending = targets.filter((id) => !completed.has(id));

    console.log(JSON.stringify({ event: "worker_started", runId, eligible: targets.length, alreadyChecked: completed.size, remaining: pending.length, batchSize, delayMs, proxy: "configured", databaseWrites: 0 }));
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      const row = allRows.get(id)!;
      const saved = obj(row.raw_payload);
      const savedDetail = obj(saved.detail);
      const savedSpec = obj(savedDetail.spec);
      const savedAd = obj(savedDetail.advertisement);
      const planned = candidates.find((candidate) => candidate.sourceListingId === id);
      const configuration = obj(planned?.configuration);
      const checkedAt = new Date().toISOString();
      let result: CheckResult;
      try {
        const response = await encarClient.publicResponse(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(timeoutMs) }, 2);
        if (response.status === 404 || response.status === 410) {
          result = { sourceListingId: id, powerClass: powerClass.get(id)!, liveStatus: "unavailable", httpStatus: response.status, currentPriceKrw: null, previousPriceKrw: pos(savedAd.price) == null ? null : Number(savedAd.price) * 10_000, priceChanged: null, currentMileageKm: null, previousMileageKm: pos(savedSpec.mileage), mileageChanged: null, engineCcChanged: null, fuelChanged: null, modelChanged: null, checkedAt };
        } else if (!response.ok) {
          throw new Error(`Encar HTTP ${response.status}`);
        } else {
          const current = obj(await response.json());
          const ad = obj(current.advertisement);
          const spec = obj(current.spec);
          const category = obj(current.category);
          const currentPrice = pos(ad.price);
          const previousPrice = pos(savedAd.price);
          const currentMileage = spec.mileage == null ? null : Number(spec.mileage);
          const previousMileage = savedSpec.mileage == null ? null : Number(savedSpec.mileage);
          const currentCc = pos(spec.displacement);
          const savedCc = pos(configuration.engineCc ?? savedSpec.displacement);
          const currentFuel = normalizeFuel(spec.fuelName);
          const savedFuel = normalizeFuel(configuration.fuelType ?? savedSpec.fuelName);
          const currentModel = normalizeModel(category.modelGroupEnglishName ?? category.modelName);
          const savedModel = normalizeModel(configuration.model);
          const currentBrand = normalizeBrand(category.manufacturerEnglishName ?? category.manufacturerName);
          const savedBrand = normalizeBrand(configuration.brand);
          const status = String(ad.status ?? ad.salesStatus ?? "");
          result = {
            sourceListingId: id, powerClass: powerClass.get(id)!,
            liveStatus: status === "ADVERTISE" ? "active" : "not_advertised", httpStatus: response.status,
            currentPriceKrw: currentPrice == null ? null : currentPrice * 10_000,
            previousPriceKrw: previousPrice == null ? null : previousPrice * 10_000,
            priceChanged: currentPrice == null || previousPrice == null ? null : currentPrice !== previousPrice,
            currentMileageKm: currentMileage, previousMileageKm: previousMileage,
            mileageChanged: currentMileage == null || previousMileage == null ? null : currentMileage !== previousMileage,
            engineCcChanged: currentCc == null || savedCc == null ? null : currentCc !== savedCc,
            fuelChanged: !currentFuel || !savedFuel ? null : currentFuel !== savedFuel,
            modelChanged: !currentModel || !savedModel || !currentBrand || !savedBrand ? null : currentModel !== savedModel || currentBrand !== savedBrand,
            checkedAt,
          };
          if (currentPrice == null) {
            result.liveStatus = "error";
            result.error = "live_price_missing";
          }
        }
      } catch (error) {
        result = { sourceListingId: id, powerClass: powerClass.get(id)!, liveStatus: "error", httpStatus: null, currentPriceKrw: null, previousPriceKrw: null, priceChanged: null, currentMileageKm: null, previousMileageKm: null, mileageChanged: null, engineCcChanged: null, fuelChanged: null, modelChanged: null, checkedAt, error: error instanceof Error ? error.message : String(error) };
      }
      const previousResultIndex = results.findIndex((item) => item.sourceListingId === id);
      if (previousResultIndex >= 0) results.splice(previousResultIndex, 1);
      results.push(result);
      if (result.liveStatus !== "error") completed.add(id);
      const finished = index + 1;
      if (finished % batchSize === 0 || finished === pending.length) {
        const counts = Object.fromEntries(["active", "unavailable", "not_advertised", "error"].map((status) => [status, results.filter((item) => item.liveStatus === status).length]));
        report = { ...report, updatedAt: new Date().toISOString(), results, checkedIds: [...completed], progress: { completedSuccessfully: completed.size, totalEligible: targets.length, currentWorkerBatch: Math.ceil((completed.size) / batchSize), counts } };
        await writeReport(report);
        console.log(JSON.stringify({ event: "batch_completed", runId, checked: results.length, total: targets.length, counts, output: outputPath }));
      } else if (finished % 10 === 0) {
        report = { ...report, updatedAt: new Date().toISOString(), results, checkedIds: [...completed] };
        await writeReport(report);
        console.log(JSON.stringify({ event: "progress", runId, checked: results.length, total: targets.length }));
      }
      if (finished < pending.length) await sleep(delayMs);
    }
    const finalCounts = Object.fromEntries(["active", "unavailable", "not_advertised", "error"].map((status) => [status, results.filter((item) => item.liveStatus === status).length]));
    report = { ...report, completedAt: new Date().toISOString(), results, checkedIds: [...completed], finalCounts, allCompleted: completed.size >= targets.length };
    await writeReport(report);
    console.log(JSON.stringify({ event: "worker_completed", runId, total: targets.length, finalCounts, output: outputPath, databaseWrites: 0, publicCatalogChanged: false }));
    await db.query("rollback");
  } finally {
    if (connected) await db.end().catch(() => undefined);
    await lock.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(lockPath).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
