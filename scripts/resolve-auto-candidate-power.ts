import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { classifyDriveState } from "../src/server/power-resolution/drive-state";
import { isPublishableTier, tierFromStored } from "../src/server/power-resolution/evidence-tiers";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const write = process.env.RESOLVE_AUTO_CANDIDATE_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const KW_TO_PS = 1.359621617;

const hpFromKw = (kw: number) => Math.round(kw * KW_TO_PS);

function monthFromRegistration(
  firstRegistrationDate: string | null,
  modelYear: number | null,
): { month: number | null; suspicious: boolean } {
  if (!firstRegistrationDate) return { month: null, suspicious: false };
  const date = new Date(firstRegistrationDate);
  if (Number.isNaN(date.getTime())) return { month: null, suspicious: true };
  const year = date.getUTCFullYear();
  const suspicious =
    year < 1990 ||
    year > new Date().getUTCFullYear() + 1 ||
    (modelYear != null && year < modelYear - 1);
  return { month: suspicious ? null : date.getUTCMonth() + 1, suspicious };
}

function matchFields(candidate: ApprovedPowerCandidate) {
  const match = candidate.match;
  const fields: Record<string, unknown> = {};
  if (match.generation) fields.generation = match.generation;
  if (match.trim) fields.trim = match.trim;
  if (match.badgeNormalized) fields.badge = match.badgeNormalized;
  if (match.modelCode) fields.model_code = match.modelCode;
  if (match.engineCode) fields.engine_code = match.engineCode;
  if (match.fuelType) fields.fuel_type = match.fuelType;
  if (match.driveType) fields.drive_type = match.driveType;
  if (match.productionYearFrom != null || match.productionYearTo != null) {
    fields.years = [match.productionYearFrom ?? null, match.productionYearTo ?? null];
  }
  if (match.engineCcFrom != null || match.engineCcTo != null) {
    fields.engine_cc = [match.engineCcFrom ?? null, match.engineCcTo ?? null];
  }
  return fields;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const [refs, cards] = await Promise.all([
      db.query(`select spec.id spec_id,spec.version spec_version,spec.spec_key,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
          evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.verification_status,evidence.reliability,evidence.evidence_tier,
          matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec
        join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved' and spec.customs_power_hp is not null`),
      db.query(`select distinct on (s.source_listing_id)
          s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.first_registration_date,s.engine_cc,s.fuel_type,s.drive_type,s.raw_payload
        from public.chestny_catalog_staging s
        join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1
        where q.status='succeeded' and s.source_status='active' and s.promotion_status='auto_candidate'
        order by s.source_listing_id`, [runId]),
    ]);

    const refBySpecId = new Map<string, (typeof refs.rows)[number]>();
    for (const row of refs.rows) if (!refBySpecId.has(row.spec_id)) refBySpecId.set(row.spec_id, row);

    const candidates = canonicalCandidates(refs.rows.map((r): ApprovedPowerCandidate => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis, sourcePriority: Number(r.source_priority), evidenceId: r.evidence_id,
      evidenceKind: r.evidence_kind, evidenceVerificationStatus: r.verification_status, evidenceReliability: r.reliability,
      match: { id: r.match_id, priority: Number(r.match_priority), brand: r.brand, model: r.model, generation: r.generation,
        trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code, engineCode: r.engine_code,
        fuelType: r.fuel_type, driveType: r.drive_type, productionYearFrom: r.production_year_from,
        productionYearTo: r.production_year_to, engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));

    const tierBySpecId = new Map<string, ReturnType<typeof tierFromStored>>();
    const kWBySpecId = new Map<string, number>();
    for (const row of refs.rows) {
      tierBySpecId.set(row.spec_id, tierFromStored(row.evidence_tier, {
        specKey: row.spec_key, sourceKind: row.evidence_kind, sourceTitle: row.source_title,
        sourceUri: row.source_uri, note: row.evidence_note,
      }));
      kWBySpecId.set(row.spec_id, Number(row.calculation_power_kw));
    }

    const pending: Array<{ id: string; status: string; hold: string; confirmation: Record<string, unknown>; payload: Record<string, unknown> }> = [];
    const summary = { scanned: cards.rowCount ?? 0, matched: 0, confirmedReady: 0, heldDrive: 0, heldMonth: 0, skippedTier: 0, skippedNoMatch: 0 };

    for (const row of cards.rows) {
      const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? row.trim;

      const input = canonicalInput({
        brand: row.manufacturer, model: row.model, generation: row.generation, trim: grade,
        fuelType: row.fuel_type, driveType: row.drive_type, year: row.model_year, engineCc: row.engine_cc,
      });
      const result = resolveApprovedPower(input, candidates);
      if (result.status !== "matched") { summary.skippedNoMatch++; continue; }
      summary.matched++;

      const specId = result.candidate.specId;
      const ref = refBySpecId.get(specId);
      const tier = tierBySpecId.get(specId) ?? "T4";
      const corroborated = result.candidates.some((candidate) =>
        candidate.specId !== specId &&
        (tierBySpecId.get(candidate.specId) === "T1" || tierBySpecId.get(candidate.specId) === "T2") &&
        Math.abs(candidate.calculationPowerKw - result.candidate.calculationPowerKw) <= 0.5);
      if (!isPublishableTier(tier, corroborated)) { summary.skippedTier++; continue; }

      const kw = kWBySpecId.get(specId) ?? result.candidate.calculationPowerKw;
      const registration = monthFromRegistration(row.first_registration_date, row.model_year);
      const driveState = classifyDriveState(result.candidate.match.driveType, input.driveType);
      const hold = driveState !== "drive_confirmed"
        ? driveState
        : registration.month == null ? "month_pending" : null;

      const confirmation = {
        spec_id: specId,
        spec_version: result.candidate.specVersion,
        spec_key: ref?.spec_key ?? null,
        evidence_id: result.candidate.evidenceId,
        evidence_kind: result.candidate.evidenceKind,
        evidence_uri: ref?.source_uri ?? null,
        evidence_tier: tier,
        confidence: result.confidence,
        power_hp: hpFromKw(kw),
        calculation_power_kw: kw,
        match_fields: matchFields(result.candidate),
        drive_state: driveState,
        resolved_at: new Date().toISOString(),
      };

      if (hold === "drive_pending" || hold === "drive_conflict") summary.heldDrive++;
      else if (hold === "month_pending") summary.heldMonth++;
      else summary.confirmedReady++;

      pending.push({
        id: String(row.source_listing_id),
        status: hold ? "auto_candidate" : "power_confirmed",
        hold: hold ?? "",
        confirmation,
        payload: hold
          ? { ...payload, power_confirmation: confirmation, power_confirmation_hold: hold }
          : { ...payload, power_confirmation: confirmation },
      });
    }

    let written = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const item of pending) {
          const result = await db.query(
            `update public.chestny_catalog_staging
             set promotion_status=$2,
                 promotion_note=$3,
                 raw_payload=$4::jsonb,
                 updated_at=now()
             where source_listing_id=$1 and source_status='active' and promotion_status='auto_candidate'`,
            [
              item.id,
              item.status,
              item.hold
                ? `Power confirmed locally from approved TL Auto evidence; held for ${item.hold}.`
                : `Power confirmed locally from approved TL Auto evidence; ${item.confirmation.power_hp} PS; spec=${item.confirmation.spec_id}; evidence=${item.confirmation.evidence_id}; tier=${item.confirmation.evidence_tier}.`,
              JSON.stringify(item.payload),
            ],
          );
          written += result.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      runId,
      scope: "auto_candidate + run succeeded",
      dryRun: !write,
      ...summary,
      writeEnabled: write,
      written,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
