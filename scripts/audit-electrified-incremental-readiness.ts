/** Read-only TKS/readiness audit for only the not-yet-published part of run 21a687ee. */
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, resolveCalculationMonth } from "../src/server/cars/calculation-contract";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const POWER_PATH = "data/power/electrified-21a687ee-power-reference.json";
const PLAN_PATH = "output/tl-auto-electrified-21a687ee-power-plan.json";
const PREVIOUS_MANIFEST = "output/tl-auto-electrified-21a687ee-publication-manifest-v3.json";
const PREVIOUS_READINESS = "output/tl-auto-electrified-21a687ee-publication-readiness.json";
const OUTPUT = "output/tl-auto-electrified-21a687ee-incremental-readiness-v4.json";
type Json = Record<string, unknown>;
type PowerEntry = { sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: string; sourceUrl: string; sourceNote: string; powerBasis: "parallel_sum" | "electric_30min";
  customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null;
  electric30MinPs: number | null; electric30MinKw: number | null; peakOrSystemPowerPs: number | null };
type Candidate = { sourceListingId: string; configuration: Json };
type Stage = { source_listing_id: string; queue_status: string; staging_status: string; source_url: string | null;
  candidate_snapshot: Json; raw_payload: Json; fetched_at: string | null; existing_car_id: string | null; active_plate_match: number };
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const positive = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const kw = (ps: number) => Number((ps * 0.73549875).toFixed(4));

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [power, plan, previousManifest, previousReadiness] = await Promise.all([
    readFile(POWER_PATH, "utf8").then(JSON.parse) as Promise<{ runId: string; entries: PowerEntry[]; unresolved: Array<{ sourceListingId: string; reason: string }> }>,
    readFile(PLAN_PATH, "utf8").then(JSON.parse) as Promise<{ runId: string; candidates: Candidate[] }>,
    readFile(PREVIOUS_MANIFEST, "utf8").then(JSON.parse) as Promise<{ runId: string; expected: number; entries: Array<{ sourceListingId: string }> }>,
    readFile(PREVIOUS_READINESS, "utf8").then(JSON.parse) as Promise<{ runId: string; rates: { asOf: string }; results: Array<{ sourceListingId: string; ready: boolean; priceRub: number | null }> }>,
  ]);
  if (power.runId !== RUN_ID || plan.runId !== RUN_ID || previousManifest.runId !== RUN_ID || previousReadiness.runId !== RUN_ID ||
      previousManifest.expected !== 184 || previousManifest.entries.length !== 184 || previousReadiness.results.length !== 184 ||
      previousReadiness.results.some((row) => !row.ready || row.priceRub == null) || power.entries.length !== 236 || power.unresolved.length !== 8)
    throw new Error("Run baseline or power-reference membership changed");
  const previousIds = new Set(previousManifest.entries.map((entry) => entry.sourceListingId));
  const previousReadyIds = new Set(previousReadiness.results.map((row) => row.sourceListingId));
  if (previousIds.size !== 184 || previousIds.size !== previousReadyIds.size || [...previousIds].some((id) => !previousReadyIds.has(id)))
    throw new Error("Prior published cohort is not identical to its saved readiness baseline");
  const pending = power.entries.filter((entry) => !previousIds.has(entry.sourceListingId));
  if (pending.length !== 52 || power.entries.some((entry) => !plan.candidates.some((candidate) => candidate.sourceListingId === entry.sourceListingId)))
    throw new Error(`Expected 52 incremental entries; got ${pending.length}`);
  const candidateById = new Map(plan.candidates.map((row) => [row.sourceListingId, row]));
  const ids = pending.map((entry) => entry.sourceListingId);

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let stages: Stage[];
  try {
    await db.query("begin read only");
    stages = (await db.query<Stage>(`select q.source_listing_id,q.status queue_status,s.status staging_status,q.source_url,
        q.candidate_snapshot,s.raw_payload,s.fetched_at,c.id existing_car_id,
        (select count(*)::int from public.cars other where other.is_available=true and
          other.vehicle_no_hash=q.candidate_snapshot->'preflight'->>'vehicleNoHash') active_plate_match
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s
        on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      left join public.cars c on c.primary_source='encar' and c.source_id=q.source_listing_id
      where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [RUN_ID, ids])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (stages.length !== 52) throw new Error(`Incremental staging rows missing: ${stages.length}/52`);
  const stageById = new Map(stages.map((row) => [row.source_listing_id, row]));
  const rates = await getCbrCalcRates();
  const results: Array<{ sourceListingId: string; brand: string; model: string; fuelType: string; sourceKind: string;
    ready: boolean; blockers: string[]; calculationPowerKw: number; priceRub: number | null; powerFinality: string | null;
    calculationMonth: number | null; fetchedAt: string | null }> = [];
  for (const entry of pending) {
    const stage = stageById.get(entry.sourceListingId)!;
    const config = obj(candidateById.get(entry.sourceListingId)?.configuration);
    const payload = obj(stage.raw_payload), detail = obj(payload.detail), ad = obj(obj(detail).advertisement);
    const manage = obj(detail.manage), spec = obj(detail.spec);
    const photos = Array.isArray(detail.photos) ? detail.photos.map(obj) : [];
    const year = positive(config.year), engineCc = positive(config.engineCc ?? spec.displacement), priceUnits = positive(ad.price);
    const month = resolveCalculationMonth({ registrationDate: typeof manage.registDateTime === "string" ? manage.registDateTime : null });
    const blockers: string[] = [];
    if (stage.queue_status !== "succeeded" || stage.staging_status !== "succeeded") blockers.push("staging_not_succeeded");
    if (!stage.source_url || !stage.fetched_at) blockers.push("source_snapshot_missing");
    if (ad.status !== "ADVERTISE" || manage.dummy === true || ad.salesStatus === "CONTRACT") blockers.push("source_not_publishable_in_snapshot");
    if (!year || !engineCc || !priceUnits) blockers.push("calculation_core_missing");
    if (!photos.some((photo) => photo.path && /outer|thumbnail|exterior|외관/i.test(String(photo.type ?? photo.code ?? ""))))
      blockers.push("exterior_photo_missing");
    if (stage.existing_car_id) blockers.push("already_in_catalog");
    if (stage.active_plate_match > 0) blockers.push("active_vehicle_number_duplicate");
    const motorKw = entry.electricMotorPowerKw;
    const ev30Kw = entry.electric30MinKw ?? (entry.electric30MinPs == null ? null : kw(entry.electric30MinPs));
    if (entry.fuelType === "hybrid" && (entry.powerBasis !== "parallel_sum" || entry.enginePowerPs == null || motorKw == null || entry.electric30MinPs != null))
      blockers.push("hybrid_components_invalid");
    if (entry.fuelType === "electric" && (entry.powerBasis !== "electric_30min" || ev30Kw == null || entry.enginePowerPs != null || motorKw != null))
      blockers.push("electric_30_minute_power_invalid");
    let priceRub: number | null = null, finality: string | null = null;
    if (year && engineCc && priceUnits) {
      try {
        const calc = calculateRuVladivostok({ priceKrw: Math.round(priceUnits * 10_000), year, month: month.month,
          engineCc, fuelType: entry.fuelType, powerKw: entry.calculationPowerKw,
          ...(entry.fuelType === "hybrid" && entry.enginePowerPs != null && motorKw != null
            ? { hybridDvsPowerHp: entry.enginePowerPs, hybridDvsPowerKw: kw(entry.enginePowerPs), hybridElectricPowerKw: motorKw } : {}),
          destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
          ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails });
        priceRub = Math.round(calc.totalRub);
        const gate = evaluatePublication({ priceRub, hasSnapshot: true, calculationPowerStatus: "matched",
          calculationPowerKw: entry.calculationPowerKw, powerBasis: entry.powerBasis,
          powerResolutionSource: `${entry.sourceKind}:${entry.sourceUrl}`, calculationMonth: month.month,
          fuelType: entry.fuelType, hybridDvsPowerHp: entry.enginePowerPs, powerConfidence: "automatic",
          calculationPowerSpecId: null, legacyCalculationStatus: null });
        if (gate.ok) finality = gate.finality;
        else blockers.push(...gate.blockers.map((name) => `publication_gate:${name}`));
      } catch (error) { blockers.push(`tks_calculation_failed:${error instanceof Error ? error.message : String(error)}`); }
    }
    results.push({ sourceListingId: entry.sourceListingId, brand: entry.brand, model: entry.model, fuelType: entry.fuelType,
      sourceKind: entry.sourceKind, ready: blockers.length === 0, blockers, calculationPowerKw: entry.calculationPowerKw,
      priceRub, powerFinality: finality, calculationMonth: month.month, fetchedAt: stage.fetched_at });
  }
  const blocked = results.filter((row) => !row.ready);
  const report = { runId: RUN_ID, generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0, publications: 0,
    rates: { asOf: rates.asOf, source: rates.source },
    summary: { runCandidates: 250, sourceRetrySkipped: 6, powerPlanCandidates: 244,
      alreadyPublished: previousIds.size, incrementalCandidates: pending.length,
      powerEvidence: power.entries.length, unresolvedPower: power.unresolved.length,
      readyForPublicationPreparation: results.length - blocked.length, blockedWithPower: blocked.length,
      byFuel: Object.fromEntries(["hybrid", "electric"].map((fuelType) => [fuelType, {
        incremental: results.filter((row) => row.fuelType === fuelType).length,
        ready: results.filter((row) => row.fuelType === fuelType && row.ready).length,
        unresolved: power.unresolved.filter((row) => candidateById.get(row.sourceListingId)?.configuration?.fuelType === fuelType).length,
      }])),
      blockers: Object.fromEntries([...new Set(blocked.flatMap((row) => row.blockers))].map((key) =>
        [key, blocked.filter((row) => row.blockers.includes(key)).length])) },
    results, unresolved: power.unresolved };
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ runId: RUN_ID, summary: report.summary, output: OUTPUT,
    databaseWrites: 0, publications: 0 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
