import { Client } from "pg";
import { config } from "dotenv";
import { normalizeBrand, normalizeDrive, normalizeFuel, normalizeModel } from "../src/server/normalization/vehicles";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", override: true, quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const write = process.env.DRAFT_POWER_CONFIRM_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const modelAliases: Record<string, string> = {
  "x2 (f39)": "X2",
  morning: "Morning",
  avante: "Elantra",
  canival: "Carnival",
};

function canonicalModel(value: unknown) {
  const normalized = normalizeModel(value);
  return modelAliases[String(normalized ?? "").toLowerCase()] ?? normalized;
}

function key(parts: {
  brand: unknown; model: unknown; year: unknown; engineCc: unknown; fuel: unknown; drive: unknown;
}) {
  return [
    normalizeBrand(parts.brand) ?? "",
    canonicalModel(parts.model) ?? "",
    Number(parts.year) || "",
    Number(parts.engineCc) || "",
    normalizeFuel(parts.fuel) ?? "",
    normalizeDrive(parts.drive) ?? "",
  ].join("|");
}

function toCandidate(row: Record<string, unknown>): ApprovedPowerCandidate {
  return {
    specId: String(row.spec_id), specVersion: Number(row.spec_version), calculationPowerKw: Number(row.calculation_power_kw),
    powerBasis: row.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(row.source_priority),
    evidenceId: String(row.evidence_id), evidenceKind: row.evidence_kind as ApprovedPowerCandidate["evidenceKind"],
    evidenceVerificationStatus: row.evidence_verification_status as ApprovedPowerCandidate["evidenceVerificationStatus"],
    evidenceReliability: row.evidence_reliability as ApprovedPowerCandidate["evidenceReliability"],
    match: {
      id: String(row.match_id), priority: Number(row.match_priority), brand: String(row.brand), model: String(row.model),
      generation: row.generation as string | null, trim: row.trim as string | null, badgeNormalized: row.badge_normalized as string | null,
      modelCode: row.model_code as string | null, engineCode: row.engine_code as string | null,
      fuelType: row.fuel_type as string | null, driveType: row.drive_type as string | null,
      productionYearFrom: row.production_year_from as number | null, productionYearTo: row.production_year_to as number | null,
      engineCcFrom: row.engine_cc_from as number | null, engineCcTo: row.engine_cc_to as number | null,
    },
  };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    // node-postgres has a single active query per Client. Keep these reads
    // sequential so this audit remains deterministic and warning-free.
    const queue = await db.query(`select brand, model, year_from, engine_cc, fuel_type, drive_type, cards_count
                  from public.vehicle_power_review_queue
                 where current_sources->>'runId'=$1
                   and current_sources->>'draftPowerStatus'='automatic_reference_pending_confirmation'`, [runId]);
    const staging = await db.query(`select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type
                  from public.chestny_catalog_staging s
                  join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1
                 where q.status='succeeded' and s.source_status='active'`, [runId]);
    const refs = await db.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
                       evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,
                       matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,
                       matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
                  from public.vehicle_power_specs spec
                  join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
                  join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
                 where spec.status='approved' and evidence.verification_status='approved'`);
    const target = new Set(queue.rows.map((row) => key({ brand: row.brand, model: row.model, year: row.year_from, engineCc: row.engine_cc, fuel: row.fuel_type, drive: row.drive_type })));
    const candidates = refs.rows.map(toCandidate);
    const summary = { runId, queuedCards: queue.rows.reduce((total, row) => total + Number(row.cards_count), 0), targetGroups: target.size, matched: 0, reviewRequired: 0, powers: {} as Record<string, number>, unresolvedGroups: {} as Record<string, number>, sampleUnresolved: [] as unknown[] };
    const confirmed: Array<{ id: string; powerHp: number; evidenceId: string; specId: string }> = [];
    for (const row of staging.rows) {
      if (!target.has(key({ brand: row.manufacturer, model: row.model, year: row.model_year, engineCc: row.engine_cc, fuel: row.fuel_type, drive: row.drive_type }))) continue;
      const result = resolveApprovedPower({
        brand: normalizeBrand(row.manufacturer), model: canonicalModel(row.model), generation: row.generation, trim: row.trim,
        badge: row.trim, year: row.model_year, engineCc: row.engine_cc, fuelType: normalizeFuel(row.fuel_type), driveType: normalizeDrive(row.drive_type),
      }, candidates);
      if (result.status === "matched") {
        summary.matched++;
        const hp = Math.round(result.candidate.calculationPowerKw * 1.359621617);
        summary.powers[String(hp)] = (summary.powers[String(hp)] ?? 0) + 1;
        confirmed.push({ id: String(row.source_listing_id), powerHp: hp, evidenceId: result.candidate.evidenceId, specId: result.candidate.specId });
      } else {
        summary.reviewRequired++;
        const unresolvedKey = [row.manufacturer, row.model, row.generation, row.trim, row.model_year, row.engine_cc, row.fuel_type, row.drive_type].map((value) => value ?? "").join(" | ");
        summary.unresolvedGroups[unresolvedKey] = (summary.unresolvedGroups[unresolvedKey] ?? 0) + 1;
        if (summary.sampleUnresolved.length < 12) summary.sampleUnresolved.push({ id: row.source_listing_id, brand: row.manufacturer, model: row.model, generation: row.generation, trim: row.trim, year: row.model_year, engineCc: row.engine_cc, fuel: row.fuel_type, reason: result.reason });
      }
    }
    let written = 0;
    if (write && confirmed.length) {
      await db.query("begin");
      try {
        for (const item of confirmed) {
          const updated = await db.query(
            `update public.chestny_catalog_staging
                set promotion_status='power_confirmed',
                    promotion_note=$2,
                    updated_at=now()
              where source_listing_id=$1
                and source_status='active'
                and promotion_status <> 'published'`,
            [item.id, `Power confirmed locally from approved TL Auto evidence; ${item.powerHp} PS; spec=${item.specId}; evidence=${item.evidenceId}. Awaiting independent photo/price publication checks.`],
          );
          written += updated.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    const unresolvedGroups = Object.entries(summary.unresolvedGroups).sort(([, a], [, b]) => b - a).map(([configuration, cards]) => ({ configuration, cards }));
    console.log(JSON.stringify({ ...summary, unresolvedGroups, confirmedWritten: written, encarRequests: 0, databaseWrites: written }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
