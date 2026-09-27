/** Read-only TKS calculation and publication gate for the electrified run. */
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, resolveCalculationMonth } from "../src/server/cars/calculation-contract";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const outputPath = "output/tl-auto-electrified-21a687ee-publication-readiness.json";
type Json = Record<string, unknown>;
type Entry = { sourceListingId: string; fuelType: string; powerBasis: "parallel_sum" | "electric_30min";
  calculationPowerKw: number; enginePowerPs: number | null; electric30MinPs: number; sourceUrl: string; sourceKind: string };
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const positive = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const kw = (ps: number) => Number((ps * 0.73549875).toFixed(4));

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");
  const [manifest, plan] = await Promise.all([
    readFile("data/power/electrified-21a687ee-power-reference.json", "utf8").then(JSON.parse) as Promise<{ runId: string; entries: Entry[]; unresolved: Array<{ sourceListingId: string; reason: string }> }>,
    readFile("output/tl-auto-electrified-21a687ee-power-plan.json", "utf8").then(JSON.parse) as Promise<{ runId: string; candidates: Array<{ sourceListingId: string; status: string; configuration: Json }> }>,
  ]);
  if (manifest.runId !== runId || plan.runId !== runId || manifest.entries.length + manifest.unresolved.length !== 244)
    throw new Error("Run input membership changed");
  const byId = new Map(plan.candidates.map((row) => [row.sourceListingId, row]));
  const ids = manifest.entries.map((row) => row.sourceListingId);
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let rows: Array<{ source_listing_id: string; queue_status: string; staging_status: string; source_url: string | null; candidate_snapshot: Json;
    raw_payload: Json; fetched_at: string | null; existing_car_id: string | null; active_plate_match: number }>;
  try {
    await db.query("begin read only");
    rows = (await db.query(`select q.source_listing_id,q.status queue_status,s.status staging_status,q.source_url,
          q.candidate_snapshot,s.raw_payload,s.fetched_at,c.id existing_car_id,
          (select count(*)::int from public.cars other where other.is_available=true and
            other.vehicle_no_hash=q.candidate_snapshot->'preflight'->>'vehicleNoHash') active_plate_match
        from public.encar_enrichment_queue q join public.encar_enrichment_staging s
          on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
        left join public.cars c on c.primary_source='encar' and c.source_id=q.source_listing_id
        where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [runId, ids])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (rows.length !== ids.length) throw new Error(`Staging missing: ${rows.length}/${ids.length}`);
  const staged = new Map(rows.map((row) => [row.source_listing_id, row]));
  const rates = await getCbrCalcRates();
  const results: Array<{ sourceListingId: string; fuelType: string; sourceKind: string; ready: boolean; blockers: string[];
    powerKw: number; priceRub: number | null; powerFinality: string | null; calculationMonth: number | null }> = [];
  for (const power of manifest.entries) {
    const row = staged.get(power.sourceListingId)!;
    const candidate = byId.get(power.sourceListingId);
    const c = obj(candidate?.configuration);
    const payload = obj(row.raw_payload), detail = obj(payload.detail), ad = obj(detail.advertisement), manage = obj(detail.manage), spec = obj(detail.spec);
    const photos = Array.isArray(detail.photos) ? detail.photos.map(obj) : [];
    const blockers: string[] = [];
    const year = positive(c.year), engineCc = positive(c.engineCc ?? spec.displacement), priceUnits = positive(ad.price);
    const month = resolveCalculationMonth({ registrationDate: typeof manage.registDateTime === "string" ? manage.registDateTime : null });
    if (row.queue_status !== "succeeded" || row.staging_status !== "succeeded") blockers.push("staging_not_succeeded");
    if (!row.source_url) blockers.push("source_url_missing");
    if (ad.status !== "ADVERTISE" || obj(manage).dummy === true || ad.salesStatus === "CONTRACT") blockers.push("source_not_publishable_in_snapshot");
    if (!year || !engineCc || !priceUnits) blockers.push("calculation_core_missing");
    if (!photos.some((photo) => photo.path && /outer|thumbnail|exterior|외관/i.test(String(photo.type ?? photo.code ?? ""))))
      blockers.push("exterior_photo_missing");
    if (row.existing_car_id) blockers.push("already_in_catalog");
    if (row.active_plate_match > 0) blockers.push("active_vehicle_number_duplicate");
    if (!row.fetched_at) blockers.push("source_snapshot_missing");
    let priceRub: number | null = null, finality: string | null = null;
    if (year && engineCc && priceUnits) {
      try {
        const calc = calculateRuVladivostok({ priceKrw: Math.round(priceUnits * 10_000), year, month: month.month,
          engineCc, fuelType: power.fuelType, powerKw: power.calculationPowerKw,
          ...(power.fuelType === "hybrid" && power.enginePowerPs != null ?
            { hybridDvsPowerHp: power.enginePowerPs, hybridDvsPowerKw: kw(power.enginePowerPs), hybridElectricPowerKw: kw(power.electric30MinPs) } : {}),
          destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
          ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails });
        priceRub = Math.round(calc.totalRub);
        const gate = evaluatePublication({ priceRub, hasSnapshot: true, calculationPowerStatus: "matched",
          calculationPowerKw: power.calculationPowerKw, powerBasis: power.powerBasis,
          powerResolutionSource: `${power.sourceKind}:${power.sourceUrl}`, calculationMonth: month.month,
          fuelType: power.fuelType, hybridDvsPowerHp: power.enginePowerPs,
          powerConfidence: "automatic", calculationPowerSpecId: null, legacyCalculationStatus: null });
        if (gate.ok) finality = gate.finality;
        else blockers.push(...gate.blockers.map((name) => `publication_gate:${name}`));
      } catch (error) { blockers.push(`tks_calculation_failed:${error instanceof Error ? error.message : String(error)}`); }
    }
    results.push({ sourceListingId: power.sourceListingId, fuelType: power.fuelType, sourceKind: power.sourceKind,
      ready: blockers.length === 0, blockers, powerKw: power.calculationPowerKw, priceRub, powerFinality: finality,
      calculationMonth: month.month });
  }
  const blocked = results.filter((row) => !row.ready);
  const report = { runId, generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0, publications: 0,
    rates: { asOf: rates.asOf, source: rates.source },
    summary: { runCandidates: 250, requestedSkipSourceRetry: 6, powerPlanCandidates: 244, powerEvidence: manifest.entries.length,
      readyForPublicationPreparation: results.length - blocked.length, blockedWithPower: blocked.length,
      withoutCalculationPower: manifest.unresolved.length,
      byFuel: Object.fromEntries(["hybrid", "electric"].map((fuel) => [fuel, {
        powerEvidence: results.filter((row) => row.fuelType === fuel).length,
        ready: results.filter((row) => row.fuelType === fuel && row.ready).length,
        missingPower: manifest.unresolved.filter((row) => byId.get(row.sourceListingId)?.configuration?.fuelType === fuel).length,
      }])),
      blockers: Object.fromEntries([...new Set(blocked.flatMap((row) => row.blockers))].map((name) => [name, blocked.filter((row) => row.blockers.includes(name)).length])),
    }, results, unresolved: manifest.unresolved };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ runId, summary: report.summary, output: outputPath }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
