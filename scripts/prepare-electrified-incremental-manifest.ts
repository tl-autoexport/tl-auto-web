/** Freeze only the 52 newly-ready listings; the existing 184-car cohort is immutable. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const powerPath = "data/power/electrified-21a687ee-power-reference.json";
const baselinePath = "output/tl-auto-electrified-21a687ee-publication-manifest-v3.json";
const readinessPath = "output/tl-auto-electrified-21a687ee-incremental-readiness-v4.json";
const outputPath = "output/tl-auto-electrified-21a687ee-incremental-manifest-v4.json";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [powerText, baselineText, readinessText] = await Promise.all([
    readFile(powerPath, "utf8"), readFile(baselinePath, "utf8"), readFile(readinessPath, "utf8"),
  ]);
  const power = JSON.parse(powerText) as { runId: string; entries: Array<{ sourceListingId: string; sourceKind: string; calculationPowerKw: number }> };
  const baseline = JSON.parse(baselineText) as { runId: string; expected: number; entries: Array<{ sourceListingId: string }> };
  const readiness = JSON.parse(readinessText) as {
    runId: string; rates: { asOf: string };
    summary: { alreadyPublished: number; incrementalCandidates: number; readyForPublicationPreparation: number; blockedWithPower: number };
    results: Array<{ sourceListingId: string; ready: boolean; priceRub: number | null; blockers: string[] }>;
  };
  if (power.runId !== runId || baseline.runId !== runId || readiness.runId !== runId || baseline.expected !== 184 ||
      baseline.entries.length !== 184 || power.entries.length !== 236 || readiness.summary.alreadyPublished !== 184 ||
      readiness.summary.incrementalCandidates !== 52 || readiness.summary.readyForPublicationPreparation !== 52 ||
      readiness.summary.blockedWithPower !== 0 || readiness.results.length !== 52 ||
      readiness.results.some((row) => !row.ready || row.priceRub == null || row.blockers.length))
    throw new Error("Baseline or incremental readiness is not the reviewed 184 + 52 cohort");
  const baselineIds = new Set(baseline.entries.map((row) => row.sourceListingId));
  const baselinePowerIds = new Set(power.entries.filter((row) => baselineIds.has(row.sourceListingId)).map((row) => row.sourceListingId));
  if (baselineIds.size !== 184 || baselinePowerIds.size !== 184) throw new Error("The prior 184-entry baseline changed");
  const powerById = new Map(power.entries.map((row) => [row.sourceListingId, row]));
  const readyIds = readiness.results.map((row) => row.sourceListingId);
  if (new Set(readyIds).size !== 52 || readyIds.some((id) => baselineIds.has(id) || !powerById.has(id)))
    throw new Error("Incremental allowlist overlaps or is absent from the reviewed power reference");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let stages: Array<{ source_listing_id: string; fetched_at: string; raw_payload: unknown }>;
  try {
    await db.query("begin read only");
    stages = (await db.query(`select source_listing_id,fetched_at,raw_payload from public.encar_enrichment_staging
      where run_id=$1 and status='succeeded' and source_listing_id=any($2::text[])`, [runId, readyIds])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (stages.length !== readyIds.length || stages.some((row) => !row.raw_payload || !row.fetched_at))
    throw new Error("Incremental source snapshots are incomplete");
  const stageById = new Map(stages.map((row) => [row.source_listing_id, row]));
  const manifest = {
    runId, baselineExpected: 184, expectedIncremental: readyIds.length,
    totalAfterPublication: baselineIds.size + readyIds.length,
    baselineManifestSha256: sha(baselineText), powerReportSha256: sha(powerText),
    readinessReportSha256: sha(readinessText), ratesAsOf: readiness.rates.asOf,
    entries: readiness.results.map((result) => {
      const source = stageById.get(result.sourceListingId)!;
      const evidence = powerById.get(result.sourceListingId)!;
      return { sourceListingId: result.sourceListingId, sourceKind: evidence.sourceKind,
        calculationPowerKw: evidence.calculationPowerKw, fetchedAt: source.fetched_at,
        rawPayloadSha256: sha(JSON.stringify(source.raw_payload)) };
    }),
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    const prior = await readFile(outputPath, "utf8");
    if (prior !== serialized) throw new Error("Existing v4 manifest differs; preserve it and investigate before replacing");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(outputPath, serialized, { flag: "wx" });
  }
  console.log(JSON.stringify({ runId, baselineFrozen: baselineIds.size, incrementalPrepared: readyIds.length,
    totalAfterPublication: manifest.totalAfterPublication, unresolvedPower: 8, manifest: outputPath,
    manifestSha256: sha(serialized), databaseWrites: 0, publications: 0 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
