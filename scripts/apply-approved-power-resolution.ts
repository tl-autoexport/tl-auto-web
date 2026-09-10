import { Client } from "pg";
import { config } from "dotenv";
import {
  resolveApprovedPower,
  type ApprovedPowerCandidate,
  type PowerReferenceInput,
} from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.POWER_RESOLUTION_DRY_RUN !== "false";
const modelFilter = new Set(
  (process.env.POWER_RESOLUTION_MODELS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type CarRow = PowerReferenceInput & {
  id: string;
  calculationPowerSpecId: string | null;
  calculationPowerSpecVersion: number | null;
  calculationPowerKw: number | null;
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

const carQuery = `select id, brand, model, generation, coalesce(trim, badge) as trim, badge, null::text as "modelCode",
                          null::text as "engineCode", fuel_type as "fuelType", drive_type as "driveType",
                          year, engine_cc as "engineCc", calculation_power_spec_id as "calculationPowerSpecId",
                          calculation_power_spec_version as "calculationPowerSpecVersion",
                          calculation_power_kw::float8 as "calculationPowerKw"
                     from public.cars
                    where is_available = true and vehicle_type = 'car'
                    order by id`;

const candidateQuery = `select spec.id as spec_id, spec.version as spec_version, spec.calculation_power_kw,
                               spec.power_basis, spec.source_priority, evidence.id as evidence_id,
                               evidence.source_kind as evidence_kind,
                               evidence.verification_status as evidence_verification_status,
                               evidence.reliability as evidence_reliability,
                               matcher.id as match_id, matcher.priority as match_priority, matcher.brand,
                               matcher.model, matcher.generation, matcher.trim, matcher.badge_normalized,
                               matcher.model_code, matcher.engine_code, matcher.fuel_type, matcher.drive_type,
                               matcher.production_year_from, matcher.production_year_to, matcher.engine_cc_from,
                               matcher.engine_cc_to
                          from public.vehicle_power_specs spec
                          join public.vehicle_power_evidence evidence on evidence.id = spec.evidence_id
                          join public.vehicle_power_spec_matches matcher on matcher.spec_id = spec.id
                         where spec.status = 'approved'
                           and evidence.verification_status = 'approved'`;

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const [carsResult, candidatesResult] = await Promise.all([
      client.query<CarRow>(carQuery),
      client.query<CandidateRow>(candidateQuery),
    ]);
    const candidates = candidatesResult.rows.map(candidateFromRow);
    const matched = carsResult.rows.flatMap((car) => {
      const resolution = resolveApprovedPower(car, candidates);
      return resolution.status === "matched" ? [{ car, resolution }] : [];
    });
    const pending = matched.filter(({ car, resolution }) => {
      const carModelKey = `${String(car.brand ?? "").trim().toLowerCase()}|${String(car.model ?? "").trim().toLowerCase()}`;
      const selectedModel = !modelFilter.size
        || modelFilter.has(carModelKey)
        || modelFilter.has(String(car.model ?? "").trim().toLowerCase());
      const changed = car.calculationPowerSpecId !== resolution.candidate.specId
        || car.calculationPowerSpecVersion !== resolution.candidate.specVersion
        || Math.abs((car.calculationPowerKw ?? 0) - resolution.candidate.calculationPowerKw) > 0.0001;
      return selectedModel && changed;
    });

    const summary = {
      dryRun,
      activeCars: carsResult.rowCount,
      approvedReferenceCandidates: candidates.length,
      matchedCars: matched.length,
      pendingCars: pending.length,
      policy: "This workflow never recalculates or publishes price_rub. A separate reviewed recalculation is required.",
      modelFilter: modelFilter.size ? [...modelFilter] : "all",
      sample: pending.slice(0, 20).map(({ car, resolution }) => ({
        carId: car.id,
        brand: car.brand,
        model: car.model,
        specId: resolution.candidate.specId,
        powerKw: resolution.candidate.calculationPowerKw,
        confidence: resolution.confidence,
        reason: resolution.reason,
      })),
    };
    if (dryRun || !pending.length) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await client.query("begin");
    for (const { car, resolution } of pending) {
      const { candidate } = resolution;
      const status = resolution.confidence === "official" ? "approved" : "matched";
      await client.query(
        `update public.cars
            set calculation_power_spec_id = $2,
                calculation_power_spec_version = $3,
                calculation_power_kw = $4,
                calculation_power_status = $5,
                power_confidence = $6,
                power_basis = $7,
                power_resolution_source = $8,
                power_resolution_note = $9,
                power_resolved_at = now()
          where id = $1`,
        [
          car.id,
          candidate.specId,
          candidate.specVersion,
          candidate.calculationPowerKw,
          status,
          resolution.confidence,
          candidate.powerBasis,
          `evidence:${candidate.evidenceKind}:${candidate.evidenceId}`,
          resolution.reason,
        ],
      );
      await client.query(
        `insert into public.vehicle_power_resolution_events
           (car_id, resolution_version, status, selected_spec_id, selected_evidence_id,
            selected_power_kw, power_basis, reason, candidates)
         values ($1, 'tl-power-resolver-v1', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          car.id,
          resolution.confidence,
          candidate.specId,
          candidate.evidenceId,
          candidate.calculationPowerKw,
          candidate.powerBasis,
          resolution.reason,
          JSON.stringify(resolution.candidates.map((item) => ({
            specId: item.specId,
            evidenceId: item.evidenceId,
            powerKw: item.calculationPowerKw,
            matchId: item.match.id,
          }))),
        ],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({ ...summary, applied: pending.length }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
