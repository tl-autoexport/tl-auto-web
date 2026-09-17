import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Legacy reserve confirmer. Superseded by `resolve-auto-candidate-power.ts`,
 * which additionally applies the evidence tier and drive gates and records a
 * structured confirmation. Kept for reference; it now uses the same
 * canonicalisation and the same `auto_candidate` scope so its numbers can be
 * compared with the newer script instead of disagreeing with it.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const write = process.env.RESERVE_POWER_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const rows = await db.query(`select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type
        from public.chestny_catalog_staging s
        join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1
        left join public.cars c on c.primary_source='chestny_prigon' and c.source_id=s.source_listing_id
        where q.status='succeeded' and s.source_status='active' and s.promotion_status='auto_candidate' and c.id is null`, [runId]);
    const refs = await db.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,
        matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,
        matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved'`);

    const candidates: ApprovedPowerCandidate[] = canonicalCandidates(refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw), powerBasis: r.power_basis,
      sourcePriority: Number(r.source_priority), evidenceId: r.evidence_id, evidenceKind: r.evidence_kind,
      evidenceVerificationStatus: r.evidence_verification_status,
      evidenceReliability: (r.evidence_reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: Number(r.match_priority), brand: r.brand, model: r.model, generation: r.generation, trim: r.trim,
        badgeNormalized: r.badge_normalized, modelCode: r.model_code, engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to, engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));

    const matched: Array<{ id: string; hp: number; specId: string; evidenceId: string }> = [];
    const unresolved: Array<{ id: string; manufacturer: string; model: string; year: number; engine: number; fuel: string; drive: string | null; reason: string }> = [];
    for (const r of rows.rows) {
      const result = resolveApprovedPower(canonicalInput({
        brand: r.manufacturer, model: r.model, generation: r.generation, trim: r.trim,
        year: r.model_year, engineCc: r.engine_cc, fuelType: r.fuel_type, driveType: r.drive_type,
      }), candidates);
      if (result.status === "matched") matched.push({ id: r.source_listing_id, hp: Math.round(result.candidate.calculationPowerKw * 1.359621617), specId: result.candidate.specId, evidenceId: result.candidate.evidenceId });
      else unresolved.push({ id: r.source_listing_id, manufacturer: r.manufacturer, model: r.model, year: r.model_year, engine: r.engine_cc, fuel: r.fuel_type, drive: r.drive_type, reason: result.reason });
    }

    let written = 0;
    if (write && matched.length) {
      await db.query("begin");
      try {
        for (const item of matched) {
          const result = await db.query(`update public.chestny_catalog_staging set promotion_status='power_confirmed', promotion_note=$2, updated_at=now()
            where source_listing_id=$1 and source_status='active' and promotion_status='auto_candidate'`,
            [item.id, `Power confirmed locally from approved TL Auto evidence; ${item.hp} PS; spec=${item.specId}; evidence=${item.evidenceId}.`]);
          written += result.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (e) { await db.query("rollback"); throw e; }
    }

    console.log(JSON.stringify({ runId, reserveCards: rows.rowCount, approvedReferenceMatches: matched.length, reviewRequired: unresolved.length,
      under160: matched.filter((x) => x.hp <= 160).length, over160: matched.filter((x) => x.hp > 160).length, confirmedWritten: written,
      sampleUnresolved: unresolved.slice(0, 20), encarRequests: 0, publicCatalogChanged: false,
      note: "Legacy confirmer: tier and drive gates live in resolve-auto-candidate-power.ts." }, null, 2));
  } finally { await db.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
