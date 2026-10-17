/** Freeze the c012 electrified preliminary power proposals and audit TKS readiness. Read-only. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, resolveCalculationMonth } from "../src/server/cars/calculation-contract";
import { isEncarSaleAdvertisement } from "../src/server/catalog/price-anomaly";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "c012d314-d718-48b0-97d9-857f7a96af1e";
const BASE = `output/tl-auto-run-${RUN_ID}`;
const PLAN_PATH = `output/tl-auto-new-encar-power-plan-${RUN_ID}.json`;
const RESEARCH_PATH = `data/power/${RUN_ID}-electrified-power-research.json`;
const POWER_PATH = `${BASE}-power-reference.json`;
const READINESS_PATH = `${BASE}-publication-readiness.json`;
const BASELINE_PATH = `${BASE}-publication-baseline.json`;
const MANIFEST_PATH = `${BASE}-publication-manifest.json`;
const KW_PER_PS = 0.73549875;
type Json = Record<string, unknown>;
type Proposal = { sourceListingId: string; fuelType: "hybrid" | "electric"; classification: string;
  powerBasis: string; customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerKw: number | null; electricMotorPowerPs: number | null; electric30MinPowerPs: number;
  electric30MinPowerKw?: number; sourceKind: string; sourceUrl: string; sourceTitle: string; sourceRationale: string;
  configuration: Json; };
type Entry = { sourceListingId: string; brand: string; model: string; year: number; engineCc: number | null; fuelType: "hybrid" | "electric";
  sourceKind: string; sourceUrl: string; sourceNote: string; powerBasis: "parallel_sum" | "electric_30min";
  customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null; electric30MinPs: number | null;
  electric30MinKw: number | null; peakOrSystemPowerPs: number | null; grade: string | null; gradeDetail: string | null;
  peakMotorPowerPs: number | null; peakMotorPowerKw: number | null; };
const obj = (x: unknown): Json => x && typeof x === "object" && !Array.isArray(x) ? x as Json : {};
const num = (x: unknown): number | null => { const n = typeof x === "number" ? x : Number(String(x ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const pos = (x: unknown): number | null => { const n = num(x); return n != null && n > 0 ? n : null; };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const kw = (ps: number) => Number((ps * KW_PER_PS).toFixed(4));

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [planText, researchText] = await Promise.all([readFile(PLAN_PATH, "utf8"), readFile(RESEARCH_PATH, "utf8")]);
  const plan = JSON.parse(planText) as { runId: string; candidates: Array<{ sourceListingId: string; status: string; configuration: Json }> };
  const research = JSON.parse(researchText) as { runId: string; readOnly: boolean; databaseWrites: number; publications: number;
    accounting: { proposalRows: number; uniqueProposalIds: number; unresolvedRows: number }; proposals: Proposal[]; unresolved: unknown[] };
  if (plan.runId !== RUN_ID || research.runId !== RUN_ID || !research.readOnly || research.databaseWrites !== 0 || research.publications !== 0)
    throw new Error("Unexpected run identity or research report status");
  const proposals = research.proposals;
  const candidates = plan.candidates;
  const ids = proposals.map((p) => p.sourceListingId);
  if (proposals.length !== 100 || research.accounting.proposalRows !== 100 || research.accounting.uniqueProposalIds !== 100 ||
      research.accounting.unresolvedRows !== 0 || research.unresolved.length !== 0 || candidates.length !== 100 ||
      new Set(ids).size !== 100 || candidates.some((c) => !ids.includes(c.sourceListingId)))
    throw new Error("Power proposal membership does not cover exactly the 100-item Encar run");
  const candidateById = new Map(candidates.map((c) => [c.sourceListingId, c]));
  const powerEntries: Entry[] = proposals.map((p) => {
    const c = obj(p.configuration);
    if (p.classification !== "preliminary_candidate" || c.fuelType !== p.fuelType || !p.sourceUrl.startsWith("https://") ||
        !pos(p.customsPowerPs) || !pos(p.calculationPowerKw)) throw new Error(`Invalid proposal ${p.sourceListingId}`);
    const brand = String(c.brand ?? "").trim(), model = String(c.model ?? "").trim(), year = pos(c.year);
    if (!brand || !model || !year) throw new Error(`Missing vehicle identity ${p.sourceListingId}`);
    if (p.fuelType === "electric") {
      if (p.enginePowerPs != null || p.electricMotorPowerKw != null || Math.abs(p.calculationPowerKw - kw(p.electric30MinPowerPs)) > 0.0003)
        throw new Error(`EV must use only its 30-minute power ${p.sourceListingId}`);
      return { sourceListingId: p.sourceListingId, brand, model, year, engineCc: null, fuelType: "electric", sourceKind: p.sourceKind,
        sourceUrl: p.sourceUrl, sourceNote: `${p.sourceTitle}. ${p.sourceRationale}`, powerBasis: "electric_30min",
        customsPowerPs: p.customsPowerPs, calculationPowerKw: p.calculationPowerKw, enginePowerPs: null,
        electricMotorPowerPs: null, electricMotorPowerKw: null, electric30MinPs: p.electric30MinPowerPs,
        electric30MinKw: p.calculationPowerKw, peakOrSystemPowerPs: null,
        grade: String(c.trim ?? "") || null, gradeDetail: String(c.badge ?? "") || null,
        peakMotorPowerPs: null, peakMotorPowerKw: null };
    }
    const c30Kw = p.electric30MinPowerKw ?? (p.electricMotorPowerKw != null && p.electricMotorPowerPs != null && p.electricMotorPowerPs > 0
      ? Number((p.electricMotorPowerKw * p.electric30MinPowerPs / p.electricMotorPowerPs).toFixed(4)) : kw(p.electric30MinPowerPs));
    if (!pos(p.enginePowerPs) || !pos(c30Kw) || Math.abs(p.calculationPowerKw - (kw(p.enginePowerPs!) + c30Kw)) > 0.0002)
      throw new Error(`Hybrid calculation must add ICE to 30-minute electric power: ${p.sourceListingId}`);
    return { sourceListingId: p.sourceListingId, brand, model, year, engineCc: pos(c.engineCc), fuelType: "hybrid", sourceKind: p.sourceKind,
      sourceUrl: p.sourceUrl, sourceNote: `${p.sourceTitle}. ${p.sourceRationale}`, powerBasis: "parallel_sum",
      customsPowerPs: p.customsPowerPs, calculationPowerKw: p.calculationPowerKw, enginePowerPs: p.enginePowerPs,
      // Existing car calculation contract names its hybrid electric input as motor power;
      // this is the agreed 30-minute component, not the peak motor rating.
      electricMotorPowerPs: p.electric30MinPowerPs, electricMotorPowerKw: c30Kw,
      electric30MinPs: null, electric30MinKw: null, peakOrSystemPowerPs: null,
      grade: String(c.trim ?? "") || null, gradeDetail: String(c.badge ?? "") || null,
      peakMotorPowerPs: p.electricMotorPowerPs, peakMotorPowerKw: p.electricMotorPowerKw };
  });

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let rows: Array<{ source_listing_id: string; queue_status: string; staging_status: string; source_url: string | null;
    candidate_snapshot: Json | null; raw_payload: Json | null; fetched_at: string | null; existing_car_id: string | null; active_plate_match: number }>;
  try {
    await db.query("begin read only");
    rows = (await db.query(`select q.source_listing_id,q.status queue_status,s.status staging_status,q.source_url,
        q.candidate_snapshot,s.raw_payload,s.fetched_at,c.id existing_car_id,
        (select count(*)::int from public.cars other where other.is_available=true and
          other.vehicle_no_hash=q.candidate_snapshot->'preflight'->>'vehicleNoHash') active_plate_match
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s
        on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      left join public.cars c on c.primary_source='encar' and c.source_id=q.source_listing_id
      where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [RUN_ID, ids])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (rows.length !== 100 || rows.some((r) => r.queue_status !== "succeeded" || r.staging_status !== "succeeded" || !r.raw_payload || !r.fetched_at))
    throw new Error(`Enrichment snapshot not complete: ${rows.length}/100`);
  const rowById = new Map(rows.map((r) => [r.source_listing_id, r]));
  const rates = await getCbrCalcRates();
  const results: Array<{ sourceListingId: string; fuelType: string; ready: boolean; blockers: string[]; priceRub: number | null; calculationMonth: number }> = [];
  const frozenEntries: Array<{ sourceListingId: string; sourceKind: string; calculationPowerKw: number; fetchedAt: string; rawPayloadSha256: string }> = [];
  for (const power of powerEntries) {
    const row = rowById.get(power.sourceListingId)!;
    const candidate = candidateById.get(power.sourceListingId)!;
    const c = obj(candidate.configuration), payload = obj(row.raw_payload), detail = obj(payload.detail), ad = obj(detail.advertisement);
    const manage = obj(detail.manage), spec = obj(detail.spec);
    const photos = Array.isArray(detail.photos) ? detail.photos.map(obj) : [];
    const engineCc = power.fuelType === "electric" ? null : pos(c.engineCc ?? spec.displacement);
    const priceUnits = pos(ad.price), year = pos(c.year), priceKrw = priceUnits == null ? null : Math.round(priceUnits * 10_000);
    const month = resolveCalculationMonth({ registrationDate: typeof manage.registDateTime === "string" ? manage.registDateTime : null,
      listingYear: year ?? undefined, listingMonth: pos(c.year) ? Number(String(c.year).slice(-2)) || null : null });
    const blockers: string[] = [];
    if (row.existing_car_id) blockers.push("already_in_catalog");
    if ((row.active_plate_match ?? 0) > 0) blockers.push("active_vehicle_number_duplicate");
    if (!row.source_url || !row.fetched_at) blockers.push("source_snapshot_missing");
    if (ad.status !== "ADVERTISE" || obj(manage).dummy === true || ad.salesStatus === "CONTRACT" || !isEncarSaleAdvertisement(ad.advertisementType)) blockers.push("source_not_publishable_in_snapshot");
    if (!year || (power.fuelType !== "electric" && !engineCc) || !priceKrw) blockers.push("calculation_core_missing");
    if (!photos.some((photo) => photo.path && /outer|thumbnail|exterior|외관/i.test(String(photo.type ?? photo.code ?? "")))) blockers.push("exterior_photo_missing");
    if (!row.candidate_snapshot) blockers.push("candidate_snapshot_missing");
    let priceRub: number | null = null;
    if (year && priceKrw) {
      try {
        const hybridElectricPowerKw = power.fuelType === "hybrid" ? power.electricMotorPowerKw : null;
        const calculation = calculateRuVladivostok({ priceKrw, year, month: month.month, engineCc: engineCc ?? 0,
          fuelType: power.fuelType, powerKw: power.calculationPowerKw,
          ...(power.fuelType === "hybrid" ? { hybridDvsPowerHp: power.enginePowerPs!,
            hybridDvsPowerKw: kw(power.enginePowerPs!), hybridElectricPowerKw: hybridElectricPowerKw!,
            hybridDvsAboveElectric30Min: power.enginePowerPs! > (power.customsPowerPs - power.enginePowerPs!), hybridSequential: false } : {}),
          destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
          ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails });
        priceRub = Math.round(calculation.totalRub);
        const gate = evaluatePublication({ priceRub, hasSnapshot: true, calculationPowerStatus: "matched",
          calculationPowerKw: power.calculationPowerKw, powerBasis: power.powerBasis,
          powerResolutionSource: `${power.sourceKind}:${power.sourceUrl}`, calculationMonth: month.month,
          fuelType: power.fuelType, hybridDvsPowerHp: power.enginePowerPs, powerConfidence: "automatic",
          calculationPowerSpecId: null, legacyCalculationStatus: null });
        if (!gate.ok || gate.finality !== "preliminary") blockers.push("publication_gate_failed");
      } catch (error) { blockers.push(`tks_calculation_failed:${error instanceof Error ? error.message : String(error)}`); }
    }
    results.push({ sourceListingId: power.sourceListingId, fuelType: power.fuelType, ready: blockers.length === 0, blockers, priceRub, calculationMonth: month.month });
    frozenEntries.push({ sourceListingId: power.sourceListingId, sourceKind: power.sourceKind,
      calculationPowerKw: power.calculationPowerKw, fetchedAt: new Date(row.fetched_at!).toISOString(),
      rawPayloadSha256: sha(JSON.stringify(row.raw_payload)) });
  }
  const blocked = results.filter((r) => !r.ready);
  const powerReport = { runId: RUN_ID, generatedAt: new Date().toISOString(), status: "preliminary", readOnly: true,
    databaseWrites: 0, publications: 0, entries: powerEntries, unresolved: [] };
  const readiness = { runId: RUN_ID, generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0, publications: 0,
    rates: { asOf: rates.asOf, source: rates.source }, summary: { alreadyPublished: rows.filter((r) => r.existing_car_id).length,
      incrementalCandidates: 100, readyForPublicationPreparation: 100 - blocked.length, blockedWithPower: blocked.length,
      byFuel: { hybrid: results.filter((r) => r.fuelType === "hybrid").length, electric: results.filter((r) => r.fuelType === "electric").length } }, results };
  const baseline = { runId: RUN_ID, expected: 0, entries: [] as Array<{ sourceListingId: string }> };
  const publication = { runId: RUN_ID, baselineExpected: 0, expectedIncremental: 100, totalAfterPublication: 100,
    baselineManifestSha256: sha(JSON.stringify(baseline, null, 2) + "\n"), ratesAsOf: rates.asOf,
    powerReportSha256: "", readinessReportSha256: "", entries: frozenEntries };
  const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
  const powerText = `${JSON.stringify(powerReport, null, 2)}\n`;
  const readinessText = `${JSON.stringify(readiness, null, 2)}\n`;
  publication.baselineManifestSha256 = sha(baselineText);
  publication.powerReportSha256 = sha(powerText);
  publication.readinessReportSha256 = sha(readinessText);
  await Promise.all([writeFile(POWER_PATH, powerText), writeFile(READINESS_PATH, readinessText),
    writeFile(BASELINE_PATH, baselineText), writeFile(MANIFEST_PATH, `${JSON.stringify(publication, null, 2)}\n`)]);
  console.log(JSON.stringify({ runId: RUN_ID, selected: powerEntries.length,
    hybrid: powerEntries.filter((p) => p.fuelType === "hybrid").length,
    electric: powerEntries.filter((p) => p.fuelType === "electric").length,
    ready: results.length - blocked.length, blocked: blocked.length,
    blockers: Object.fromEntries([...new Set(blocked.flatMap((r) => r.blockers))].map((b) => [b, blocked.filter((r) => r.blockers.includes(b)).length])),
    ratesAsOf: rates.asOf, output: [POWER_PATH, READINESS_PATH, BASELINE_PATH, MANIFEST_PATH] }, null, 2));
  if (blocked.length) { console.log(JSON.stringify(blocked.slice(0, 30), null, 2)); process.exitCode = 2; }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
