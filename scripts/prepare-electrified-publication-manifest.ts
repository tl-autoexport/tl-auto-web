/** Freeze the audited electrified allowlist and its saved Encar source payloads. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const powerPath = "data/power/electrified-21a687ee-power-reference.json";
const readinessPath = "output/tl-auto-electrified-21a687ee-publication-readiness.json";
const outputPath = "output/tl-auto-electrified-21a687ee-publication-manifest-v2.json";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [powerText, readinessText] = await Promise.all([readFile(powerPath, "utf8"), readFile(readinessPath, "utf8")]);
  const power = JSON.parse(powerText) as { runId: string; entries: Array<{ sourceListingId: string; calculationPowerKw: number; sourceKind: string }> };
  const readiness = JSON.parse(readinessText) as { runId: string; rates: { asOf: string }; summary: { readyForPublicationPreparation: number; blockedWithPower: number };
    results: Array<{ sourceListingId: string; ready: boolean; priceRub: number | null }> };
  if (power.runId !== runId || readiness.runId !== runId || power.entries.length !== 184 || readiness.summary.readyForPublicationPreparation !== 184 ||
      readiness.summary.blockedWithPower !== 0 || readiness.results.length !== 184 || readiness.results.some((row) => !row.ready || row.priceRub == null))
    throw new Error("Readiness inputs changed or are incomplete");
  const ids = power.entries.map((row) => row.sourceListingId);
  if (new Set(ids).size !== 184 || new Set(readiness.results.map((row) => row.sourceListingId)).size !== 184) throw new Error("Duplicate entries");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let stage: Array<{ source_listing_id: string; fetched_at: string; raw_payload: unknown }>;
  try {
    await db.query("begin read only");
    stage = (await db.query(`select source_listing_id,fetched_at,raw_payload from public.encar_enrichment_staging
      where run_id=$1 and status='succeeded' and source_listing_id=any($2::text[])`, [runId, ids])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (stage.length !== ids.length || stage.some((row) => !row.raw_payload || !row.fetched_at)) throw new Error("Source staging incomplete");
  const source = new Map(stage.map((row) => [row.source_listing_id, row]));
  const manifest = { runId, expected: ids.length, ratesAsOf: readiness.rates.asOf,
    powerReportSha256: digest(powerText), readinessReportSha256: digest(readinessText),
    entries: power.entries.map((entry) => {
      const row = source.get(entry.sourceListingId)!;
      return { sourceListingId: entry.sourceListingId, sourceKind: entry.sourceKind,
        calculationPowerKw: entry.calculationPowerKw, fetchedAt: row.fetched_at,
        rawPayloadSha256: digest(JSON.stringify(row.raw_payload)) };
    }) };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    const prior = await readFile(outputPath, "utf8");
    if (prior !== serialized) throw new Error("An existing publication manifest differs; preserve it and prepare a new version");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(outputPath, serialized, { flag: "wx" });
  }
  console.log(JSON.stringify({ runId, prepared: manifest.expected, manifestPath: outputPath, manifestSha256: digest(serialized), databaseWrites: 0, publications: 0 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
