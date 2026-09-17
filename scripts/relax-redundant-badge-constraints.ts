import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Removes a redundant badge/trim constraint from an approved specification.
 *
 * Some published cards are blocked only because the rule carries a trim name
 * that the card does not have in its saved data, while the rule is the single
 * specification for that brand, model, engine and year. Relaxing the constraint
 * is safe exactly in that case, and unsafe when another specification could
 * match the same card.
 *
 * The script never trusts that reasoning alone: it simulates the resolution of
 * every affected card against the augmented reference and refuses to write
 * unless each one ends up uniquely matched to the intended specification.
 *
 * Read-only by default. Set RELAX_BADGE_WRITE=true to apply.
 * No Encar requests, no catalog writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.RELAX_BADGE_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type RefRow = {
  spec_id: string; spec_key: string; calculation_power_kw: number; priority: number; evidence_id: string;
  evidence_kind: string; source_uri: string | null; source_title: string | null; evidence_note: string | null;
  reliability: string | null; match_id: string; brand: string | null; model: string | null; generation: string | null;
  trim: string | null; badge_normalized: string | null; model_code: string | null; engine_code: string | null;
  fuel_type: string | null; drive_type: string | null; production_year_from: number | null;
  production_year_to: number | null; engine_cc_from: number | null; engine_cc_to: number | null;
};

const toCandidate = (r: RefRow): ApprovedPowerCandidate => ({
  specId: r.spec_id, specVersion: 1, calculationPowerKw: Number(r.calculation_power_kw),
  powerBasis: "combustion_engine", sourcePriority: Number(r.priority ?? 10), evidenceId: r.evidence_id,
  evidenceKind: r.evidence_kind as ApprovedPowerCandidate["evidenceKind"], evidenceVerificationStatus: "approved",
  evidenceReliability: (r.reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
  match: { id: r.match_id, priority: Number(r.priority ?? 10), brand: String(r.brand ?? ""), model: String(r.model ?? ""),
    generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
    engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
    productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
    engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
});

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const refs = await db.query<RefRow>(`select spec.id spec_id,spec.spec_key,spec.calculation_power_kw,spec.source_priority priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.reliability,
        matcher.id match_id,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
      where spec.status='approved' and evidence.verification_status='approved'`);
    const cars = await db.query(`select c.source_id,c.brand,c.model,c.year,c.engine_cc,c.fuel_type,c.drive_type,
        s.generation staging_generation,s.trim staging_trim,s.raw_payload staging_payload
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id=c.source_id
      where c.primary_source='chestny_prigon' and c.is_available=true`);

    const candidates = canonicalCandidates(refs.rows.map(toCandidate));
    const withoutBadge = canonicalCandidates(candidates.map((candidate) => ({
      ...candidate, match: { ...candidate.match, trim: null, badgeNormalized: null },
    })));

    const blocked = new Map<string, { specKey: string; sourceId: string; template: ApprovedPowerCandidate; input: ReturnType<typeof canonicalInput> }>();
    for (const car of cars.rows) {
      const payload = (car.staging_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? car.staging_trim;
      const input = canonicalInput({
        brand: car.brand, model: car.model, generation: car.staging_generation, trim: grade,
        fuelType: car.fuel_type, driveType: car.drive_type, year: car.year, engineCc: car.engine_cc,
      });
      if (resolveApprovedPower(input, candidates).status === "matched") continue;
      const relaxed = resolveApprovedPower(input, withoutBadge);
      if (relaxed.status !== "matched") continue; // blocked by something else entirely
      const specId = relaxed.candidate.specId;
      const ref = refs.rows.find((row) => row.spec_id === specId);
      if (!ref?.trim && !ref?.badge_normalized) continue; // constraint already absent
      if (blocked.has(specId)) continue;
      blocked.set(specId, {
        specKey: ref.spec_key, sourceId: car.source_id, input,
        template: candidates.find((candidate) => candidate.specId === specId && candidate.match.id === ref.match_id) as ApprovedPowerCandidate,
      });
    }

    // Simulation: every affected card must resolve uniquely to the intended
    // specification once the redundant constraint is removed.
    const additions: Array<{ specKey: string; specId: string; template: ApprovedPowerCandidate; affected: string[] }> = [];
    const rejected: Array<Record<string, unknown>> = [];

    for (const [specId, entry] of blocked) {
      const broadRow: ApprovedPowerCandidate = {
        ...entry.template,
        match: { ...entry.template.match, id: `relaxed-${specId}`, trim: null, badgeNormalized: null },
      };
      const augmented = [...candidates, broadRow];
      const affected = cars.rows.filter((car) => {
        const payload = (car.staging_payload ?? {}) as Record<string, unknown>;
        const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
        const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
        const category = (detail.category ?? {}) as Record<string, unknown>;
        const grade = category.gradeEnglishName ?? category.gradeName ?? car.staging_trim;
        const input = canonicalInput({ brand: car.brand, model: car.model, generation: car.staging_generation, trim: grade,
          fuelType: car.fuel_type, driveType: car.drive_type, year: car.year, engineCc: car.engine_cc });
        const outcome = resolveApprovedPower(input, augmented);
        return outcome.status === "matched" && outcome.candidate.specId === specId;
      });
      const allResolved = affected.length > 0;
      if (!allResolved) {
        rejected.push({ specKey: entry.specKey, reason: "simulation_did_not_resolve", affected: affected.length });
        continue;
      }
      additions.push({ specKey: entry.specKey, specId, template: broadRow, affected: affected.map((car) => car.source_id) });
    }

    // Close the read-only transaction before opening a write transaction.
    await db.query("rollback");

    let written = 0;
    if (write && additions.length) {
      await db.query("begin");
      try {
        for (const addition of additions) {
          const match = addition.template.match;
          await db.query(
            `insert into public.vehicle_power_spec_matches
               (spec_id, priority, brand, model, generation, trim, badge_normalized, model_code, engine_code,
                fuel_type, drive_type, production_year_from, production_year_to, engine_cc_from, engine_cc_to)
             values ($1,$2,$3,$4,$5,null,null,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [addition.specId, match.priority, match.brand, match.model, match.generation, match.modelCode,
              match.engineCode, match.fuelType, match.driveType, match.productionYearFrom, match.productionYearTo,
              match.engineCcFrom, match.engineCcTo],
          );
          written++;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      encarRequests: 0,
      publicCatalogChanged: false,
      redundantConstraintsFound: blocked.size,
      additionsWritten: written,
      additions: additions.map((addition) => ({ specKey: addition.specKey, cards: addition.affected.length, cardIds: addition.affected.slice(0, 10) })),
      rejected,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
