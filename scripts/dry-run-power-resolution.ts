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
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type CarRow = PowerReferenceInput & {
  id: string;
  power_hp: number | null;
  power_source: string | null;
  price_rub: number | null;
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

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const [carsResult, candidatesResult] = await Promise.all([
      client.query<CarRow>(
        `select id, brand, model, generation, trim, badge, null::text as "modelCode",
                null::text as "engineCode", fuel_type as "fuelType", drive_type as "driveType",
                year, engine_cc as "engineCc", power_hp, power_source, price_rub
           from public.cars
          where is_available = true and vehicle_type = 'car'
          order by brand, model, id`,
      ),
      client.query<CandidateRow>(
        `select spec.id as spec_id, spec.version as spec_version, spec.calculation_power_kw,
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
            and evidence.verification_status = 'approved'`,
      ),
    ]);
    const candidates = candidatesResult.rows.map(candidateFromRow);
    const counts = {
      matched: 0,
      official: 0,
      high: 0,
      automatic: 0,
      reviewRequired: 0,
      priceChanges: 0,
    };
    const reviewQueue: Array<Record<string, unknown>> = [];
    const priceChangeGroups = new Map<string, { cards: number; examples: Array<Record<string, unknown>> }>();

    for (const car of carsResult.rows) {
      const resolution = resolveApprovedPower(car, candidates);
      if (resolution.status === "matched") {
        counts.matched += 1;
        counts[resolution.confidence] += 1;
        // This is deliberately only an impact flag. A price is recalculated
        // only by the later approved write workflow.
        if (Math.abs((car.power_hp ?? 0) / 1.35962 - resolution.candidate.calculationPowerKw) > 0.01) {
          counts.priceChanges += 1;
          const key = `${car.brand} | ${car.model} | ${car.fuelType ?? "unknown"}`;
          const group = priceChangeGroups.get(key) ?? { cards: 0, examples: [] };
          group.cards += 1;
          if (group.examples.length < 3) {
            group.examples.push({
              id: car.id,
              year: car.year,
              engineCc: car.engineCc,
              currentPowerHp: car.power_hp,
              resolvedPowerKw: resolution.candidate.calculationPowerKw,
            });
          }
          priceChangeGroups.set(key, group);
        }
      } else {
        counts.reviewRequired += 1;
        if (reviewQueue.length < 100) {
          reviewQueue.push({
            id: car.id,
            brand: car.brand,
            model: car.model,
            trim: car.trim,
            badge: car.badge,
            fuelType: car.fuelType,
            engineCc: car.engineCc,
            year: car.year,
            currentPowerHp: car.power_hp,
            currentSource: car.power_source,
            reason: resolution.reason,
          });
        }
      }
    }

    console.log(JSON.stringify({
      dryRun: true,
      policy: "No car, price, calculation power, or event record was changed.",
      activeCars: carsResult.rowCount,
      approvedReferenceCandidates: candidates.length,
      counts,
      priceChangeGroups: [...priceChangeGroups.entries()]
        .map(([identity, value]) => ({ identity, ...value }))
        .sort((a, b) => b.cards - a.cards)
        .slice(0, 30),
      reviewQueue,
      nextAction: candidates.length === 0
        ? "Add approved TL Auto evidence and versioned specs before enabling the write workflow."
        : "Review ambiguous configurations, then run the write workflow only after approval.",
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
