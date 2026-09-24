/**
 * Promote a provisional Encar power value to final.
 *
 * A promotion is allowed only when the full power resolver (the same one used by
 * `apply-approved-power-resolution.ts`) confirms the whole configuration against
 * approved evidence of tier T1/T2 *and* the value it selects already equals the
 * stored one.
 *
 * Both conditions matter:
 *   * configuration only, no value check, would feed a wrong number into a final
 *     price — brand, model and displacement coincide across trims very often;
 *   * a resolver match with a *different* value is a correction, and a correction
 *     changes the price, so it is reported here and left for a reviewed
 *     recalculation instead of being applied silently.
 *
 * Read-only by default; the write requires ENCAR_POWER_PROMOTION_WRITE=true.
 */
import { Client } from "pg";
import { config } from "dotenv";
import {
  resolveApprovedPower,
  type ApprovedPowerCandidate,
  type PowerReferenceInput,
} from "../src/server/power-resolution/resolver";
import { FINAL_EVIDENCE_TIERS, storedPowerFinality } from "../src/server/cars/calculation-contract";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const write = process.env.ENCAR_POWER_PROMOTION_WRITE === "true";
const scopeFloor = process.env.ENCAR_POWER_SCOPE_FLOOR ?? null;

type CarRow = PowerReferenceInput & {
  id: string;
  source_id: string;
  calculationPowerKw: number | null;
  calculationPowerSpecId: string | null;
  powerConfidence: string | null;
  powerResolutionSource: string | null;
};

type CandidateRow = {
  spec_id: string;
  spec_version: number;
  calculation_power_kw: string;
  power_basis: ApprovedPowerCandidate["powerBasis"];
  source_priority: number;
  evidence_id: string;
  evidence_kind: ApprovedPowerCandidate["evidenceKind"];
  evidence_verification_status: ApprovedPowerCandidate["evidenceVerificationStatus"];
  evidence_reliability: ApprovedPowerCandidate["evidenceReliability"];
  evidence_tier: string | null;
  source_uri: string | null;
  match_id: string;
  match_priority: number;
  brand: string;
  model: string;
  generation: string | null;
  trim: string | null;
  badge_normalized: string | null;
  model_code: string | null;
  engine_code: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  production_year_from: number | null;
  production_year_to: number | null;
  engine_cc_from: number | null;
  engine_cc_to: number | null;
};

function candidateFromRow(row: CandidateRow): ApprovedPowerCandidate {
  return {
    specId: row.spec_id,
    specVersion: row.spec_version,
    calculationPowerKw: Number(row.calculation_power_kw),
    powerBasis: row.power_basis,
    sourcePriority: row.source_priority,
    evidenceId: row.evidence_id,
    evidenceKind: row.evidence_kind,
    evidenceVerificationStatus: row.evidence_verification_status,
    evidenceReliability: row.evidence_reliability,
    evidenceTier: row.evidence_tier,
    match: {
      id: row.match_id,
      priority: row.match_priority,
      brand: row.brand,
      model: row.model,
      generation: row.generation,
      trim: row.trim,
      badgeNormalized: row.badge_normalized,
      modelCode: row.model_code,
      engineCode: row.engine_code,
      fuelType: row.fuel_type,
      driveType: row.drive_type,
      productionYearFrom: row.production_year_from,
      productionYearTo: row.production_year_to,
      engineCcFrom: row.engine_cc_from,
      engineCcTo: row.engine_cc_to,
    },
  };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let committed = false;
  try {
    const cars = (await db.query<CarRow>(`
      select id, source_id, brand, model, generation, coalesce(trim, badge) as trim, badge,
             null::text as "modelCode", null::text as "engineCode",
             fuel_type as "fuelType", drive_type as "driveType", year, engine_cc as "engineCc",
             calculation_power_kw::float8 as "calculationPowerKw",
             calculation_power_spec_id as "calculationPowerSpecId",
             power_confidence as "powerConfidence", power_resolution_source as "powerResolutionSource"
      from public.cars
      where primary_source = 'encar' and is_available = true and power_finality = 'provisional'
        and ($1::timestamptz is null or catalog_added_at >= $1::timestamptz)
      order by brand, model, source_id`, [scopeFloor])).rows;
    const candidates = (await db.query<CandidateRow>(`
      select spec.id as spec_id, spec.version as spec_version, spec.calculation_power_kw,
             spec.power_basis, spec.source_priority, evidence.id as evidence_id,
             evidence.source_kind as evidence_kind,
             evidence.verification_status as evidence_verification_status,
             evidence.reliability as evidence_reliability,
             evidence.evidence_tier as evidence_tier, evidence.source_uri as source_uri,
             matcher.id as match_id, matcher.priority as match_priority, matcher.brand,
             matcher.model, matcher.generation, matcher.trim, matcher.badge_normalized,
             matcher.model_code, matcher.engine_code, matcher.fuel_type, matcher.drive_type,
             matcher.production_year_from, matcher.production_year_to, matcher.engine_cc_from,
             matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id = spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id = spec.id
      where spec.status = 'approved' and evidence.verification_status = 'approved'`)).rows.map(candidateFromRow);

    const promotable: Array<{ car: CarRow; candidate: ApprovedPowerCandidate }> = [];
    const corrections: Array<{ car: CarRow; candidate: ApprovedPowerCandidate }> = [];
    const weakEvidence: Array<{ car: CarRow; candidate: ApprovedPowerCandidate }> = [];
    const ties: Array<{ car: CarRow; candidates: ApprovedPowerCandidate[] }> = [];
    let noApprovedCandidate = 0;

    for (const car of cars) {
      const resolution = resolveApprovedPower(car, candidates);
      if (resolution.status !== "matched") {
        if (resolution.candidates.length === 0) noApprovedCandidate++;
        else ties.push({ car, candidates: resolution.candidates });
        continue;
      }
      const candidate = resolution.candidate;
      const tierOk = candidate.evidenceTier != null && FINAL_EVIDENCE_TIERS.includes(candidate.evidenceTier);
      const agrees = car.calculationPowerKw != null
        && Math.abs(candidate.calculationPowerKw - car.calculationPowerKw) < 0.0001;
      if (!tierOk) weakEvidence.push({ car, candidate });
      else if (agrees) promotable.push({ car, candidate });
      else corrections.push({ car, candidate });
    }

    const describe = ({ car, candidate }: { car: CarRow; candidate: ApprovedPowerCandidate }) => ({
      sourceId: car.source_id, car: `${car.brand ?? ""} ${car.model ?? ""}`.trim(), year: car.year,
      engineCc: car.engineCc, fuel: car.fuelType, drive: car.driveType,
      storedKw: car.calculationPowerKw, resolverKw: candidate.calculationPowerKw,
      tier: candidate.evidenceTier, reliability: candidate.evidenceReliability,
      specId: candidate.specId, source: car.powerResolutionSource,
    });

    const summary = {
      write,
      scopeFloor: scopeFloor ?? "whole catalogue",
      provisionalEncarCars: cars.length,
      promotable: promotable.length,
      correctionsNeedingAReview: corrections.length,
      resolverMatchedButEvidenceBelowT1T2: weakEvidence.length,
      noApprovedCandidate,
      ambiguousMatchNeedingTrimReview: ties.length,
      promotionPolicy:
        "Promotion requires an approved T1/T2 specification whose value already equals the stored value; it changes the label and the evidence link, never the number.",
      promotableSample: promotable.map(describe),
      correctionSample: corrections.slice(0, 25).map(describe),
      weakEvidenceSample: weakEvidence.slice(0, 15).map(describe),
      tieSample: ties.slice(0, 10).map(({ car, candidates: tied }) => ({
        sourceId: car.source_id, car: `${car.brand ?? ""} ${car.model ?? ""}`.trim(), year: car.year,
        storedKw: car.calculationPowerKw,
        tiedTo: tied.map((candidate) => ({ kw: candidate.calculationPowerKw, tier: candidate.evidenceTier, trim: candidate.match.trim, badge: candidate.match.badgeNormalized })),
      })),
    };

    if (!write || !promotable.length) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await db.query("begin");
    for (const { car, candidate } of promotable) {
      const source = `evidence:${candidate.evidenceKind}:${candidate.evidenceId}`;
      const finality = storedPowerFinality({
        powerConfidence: candidate.evidenceReliability === "verified" ? "official" : "high",
        calculationPowerKw: candidate.calculationPowerKw,
        powerResolutionSource: source,
        calculationPowerSpecId: candidate.specId,
        evidenceTier: candidate.evidenceTier,
      });
      if (finality !== "final") throw new Error(`Resolver promotion did not yield a final value: ${car.source_id}`);
      await db.query(
        `update public.cars
            set calculation_power_spec_id = $2, calculation_power_spec_version = $3,
                calculation_power_kw = $4, calculation_power_status = 'approved',
                power_confidence = $5, power_basis = $6, power_resolution_source = $7,
                power_finality = 'final', power_resolution_note = $8, power_resolved_at = now()
          where id = $1`,
        [car.id, candidate.specId, candidate.specVersion, candidate.calculationPowerKw,
          candidate.evidenceReliability === "verified" ? "official" : "high", candidate.powerBasis,
          source, `Подтверждено полным сопоставлением TL Auto: ${candidate.evidenceTier}, spec ${candidate.specId}.`],
      );
      await db.query(
        `insert into public.vehicle_power_resolution_events
           (car_id, resolution_version, status, selected_spec_id, selected_evidence_id,
            selected_power_kw, power_basis, reason, candidates)
         values ($1, 'tl-power-resolver-v1', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [car.id, candidate.evidenceReliability === "verified" ? "official" : "high", candidate.specId,
          candidate.evidenceId, candidate.calculationPowerKw, candidate.powerBasis,
          `Повышение provisional → final полным сопоставлением; значение совпало (${candidate.calculationPowerKw} kW).`,
          JSON.stringify([{ specId: candidate.specId, evidenceId: candidate.evidenceId, powerKw: candidate.calculationPowerKw, matchId: candidate.match.id }])],
      );
    }
    await db.query("commit");
    committed = true;
    console.log(JSON.stringify({ ...summary, applied: promotable.length }, null, 2));
  } catch (error) {
    if (!committed) await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
