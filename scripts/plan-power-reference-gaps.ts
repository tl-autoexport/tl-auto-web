import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidates, canonicalInput, configurationKey } from "../src/server/power-resolution/canonical";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Read-only plan for the remaining reference gaps among published cards:
 *   A. ambiguous cards - which approved specifications compete and whether the
 *      conflict can be removed mechanically (one spec's coverage is contained
 *      in another with the same output) or needs a source review;
 *   B. cards with no rule at all, grouped so new rules can be sourced by
 *     priority;
 *   C. cards where a rule already existed before publication and still did not
 *     match (process defects).
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

type CardRow = {
  id: string; source_id: string; brand: string | null; model: string | null; year: number | null;
  engine_cc: number | null; fuel_type: string | null; drive_type: string | null; power_hp: number | null;
  published_at: string | null; staging_generation: string | null; staging_trim: string | null;
  staging_payload: Record<string, unknown> | null;
};

type RefRow = {
  spec_id: string; spec_key: string; calculation_power_kw: number; spec_created_at: string;
  evidence_id: string; evidence_kind: string; source_uri: string | null; source_title: string | null;
  evidence_note: string | null; reliability: string | null;
  match_id: string; priority: number; brand: string | null; model: string | null; generation: string | null;
  trim: string | null; badge_normalized: string | null; model_code: string | null; engine_code: string | null;
  fuel_type: string | null; drive_type: string | null; production_year_from: number | null;
  production_year_to: number | null; engine_cc_from: number | null; engine_cc_to: number | null;
};

const contains = (outer: { years: Array<number | null>; cc: Array<number | null> }, inner: { years: Array<number | null>; cc: Array<number | null> }) => {
  const yearsOk = (outer.years[0] ?? -Infinity) <= (inner.years[0] ?? -Infinity) && (outer.years[1] ?? Infinity) >= (inner.years[1] ?? Infinity);
  const ccOk = (outer.cc[0] ?? -Infinity) <= (inner.cc[0] ?? -Infinity) && (outer.cc[1] ?? Infinity) >= (inner.cc[1] ?? Infinity);
  return yearsOk && ccOk;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");

    const refs = await db.query<RefRow>(`select spec.id spec_id,spec.spec_key,spec.calculation_power_kw,spec.created_at spec_created_at,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.reliability,
        matcher.id match_id,matcher.priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,
        matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,
        matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
      where spec.status='approved' and evidence.verification_status='approved'`);

    const cards = await db.query<CardRow>(`select c.id,c.source_id,c.brand,c.model,c.year,c.engine_cc,c.fuel_type,c.drive_type,c.power_hp,
        c.published_at,s.generation staging_generation,s.trim staging_trim,s.raw_payload staging_payload
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id=c.source_id
      where c.primary_source='chestny_prigon' and c.is_available=true`);

    const candidates: ApprovedPowerCandidate[] = canonicalCandidates(refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: 1, calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: "combustion_engine", sourcePriority: Number(r.priority), evidenceId: r.evidence_id,
      evidenceKind: r.evidence_kind as ApprovedPowerCandidate["evidenceKind"], evidenceVerificationStatus: "approved",
      evidenceReliability: (r.reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: Number(r.priority), brand: String(r.brand ?? ""), model: String(r.model ?? ""),
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));

    // Relaxed sets name the single blocking attribute for cards that have a
    // rule but still did not match, which separates a process defect from a
    // card whose reference rule is genuinely missing.
    const relax = (patch: Partial<ApprovedPowerCandidate["match"]>) =>
      canonicalCandidates(candidates.map((candidate) => ({ ...candidate, match: { ...candidate.match, ...patch } })));
    const probes: Array<[string, ApprovedPowerCandidate[]]> = [
      ["drive_conflict", relax({ driveType: null })],
      ["generation_mismatch", relax({ generation: null })],
      ["badge_mismatch", relax({ trim: null, badgeNormalized: null })],
      ["generation_and_badge_mismatch", relax({ generation: null, trim: null, badgeNormalized: null })],
    ];

    const ambiguityGroups = new Map<string, { rows: number; specKeys: Set<string>; powers: Set<number>; classification: string }>();
    const noRuleGroups: Record<string, number> = {};
    const processDefects: Array<Record<string, unknown>> = [];
    const mechanicalRetireCandidates = new Map<string, { keep: string; retire: string; powerKw: number; rows: number }>();

    for (const car of cards.rows) {
      const payload = (car.staging_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? car.staging_trim;

      const input = canonicalInput({
        brand: car.brand, model: car.model, generation: car.staging_generation, trim: grade,
        fuelType: car.fuel_type, driveType: car.drive_type, year: car.year, engineCc: car.engine_cc,
      });
      const result = resolveApprovedPower(input, candidates);
      if (result.status === "matched") continue;

      if (result.candidates.length > 1) {
        const specIds = [...new Set(result.candidates.map((candidate) => candidate.specId))];
        const powers = new Set(result.candidates.map((candidate) => Math.round(candidate.calculationPowerKw * 10) / 10));
        const specKeys = specIds.map((id) => refs.rows.find((r) => r.spec_id === id)?.spec_key ?? id).sort();
        const key = configurationKey(input);

        // Either the conflict disappears by retiring a specification whose
        // coverage is fully contained in another one with the same output, or a
        // source review is required.
        let classification = powers.size === 1 ? "same_power_overlap" : "different_power_overlap";
        if (specIds.length === 2 && powers.size === 1) {
          const [a, b] = specIds.map((id) => refs.rows.filter((r) => r.spec_id === id));
          const coverageA = { years: [Math.min(...a.map((r) => r.production_year_from ?? 0)), Math.max(...a.map((r) => r.production_year_to ?? 0))], cc: [Math.min(...a.map((r) => r.engine_cc_from ?? 0)), Math.max(...a.map((r) => r.engine_cc_to ?? 0))] };
          const coverageB = { years: [Math.min(...b.map((r) => r.production_year_from ?? 0)), Math.max(...b.map((r) => r.production_year_to ?? 0))], cc: [Math.min(...b.map((r) => r.engine_cc_from ?? 0)), Math.max(...b.map((r) => r.engine_cc_to ?? 0))] };
          const keysA = a[0]?.spec_key ?? "?";
          const keysB = b[0]?.spec_key ?? "?";
          if (contains(coverageA, coverageB) || contains(coverageB, coverageA)) {
            classification = "retire_narrower_candidate";
            const keep = contains(coverageA, coverageB) ? keysA : keysB;
            const retire = keep === keysA ? keysB : keysA;
            const existing = mechanicalRetireCandidates.get(`${keep}|${retire}`) ?? { keep, retire, powerKw: Number(a[0]?.calculation_power_kw ?? 0), rows: 0 };
            existing.rows++;
            mechanicalRetireCandidates.set(`${keep}|${retire}`, existing);
          }
        }

        const group = ambiguityGroups.get(key) ?? { rows: 0, specKeys: new Set<string>(), powers, classification };
        group.rows++;
        specKeys.forEach((value) => group.specKeys.add(value));
        ambiguityGroups.set(key, group);
        continue;
      }

      // No candidate at all: either the reference genuinely lacks the rule, or
      // exactly one attribute blocks a rule that does exist.
      const label = `${car.brand ?? "?"}/${car.model ?? "?"}/${car.year ?? "?"}/${car.engine_cc ?? "?"}/${car.fuel_type ?? "?"}/${car.drive_type ?? "?"}`;
      let blocker: string | null = null;
      let related: ApprovedPowerCandidate | null = null;
      for (const [name, set] of probes) {
        const outcome = resolveApprovedPower(input, set);
        if (outcome.status === "matched") { blocker = name; related = outcome.candidate; break; }
      }
      if (related) {
        processDefects.push({
          sourceId: car.source_id, brand: car.brand, model: car.model, year: car.year, engineCc: car.engine_cc,
          fuel: car.fuel_type, drive: car.drive_type, trim: grade ?? null, publishedAt: car.published_at,
          blocker, relatedSpecKey: refs.rows.find((r) => r.spec_id === related?.specId)?.spec_key ?? null,
        });
      } else {
        bump(noRuleGroups, label);
      }
    }

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      ambiguous: {
        cards: [...ambiguityGroups.values()].reduce((sum, group) => sum + group.rows, 0),
        groups: ambiguityGroups.size,
        mechanicalRetireCandidates: [...mechanicalRetireCandidates.values()].sort((a, b) => b.rows - a.rows),
        topGroups: [...ambiguityGroups.entries()]
          .map(([configuration, group]) => ({
            configuration, cards: group.rows, classification: group.classification,
            specs: [...group.specKeys], powersKw: [...group.powers],
          }))
          .sort((a, b) => b.cards - a.cards)
          .slice(0, 20),
      },
      noRule: {
        cards: Object.values(noRuleGroups).reduce((sum, count) => sum + count, 0),
        groups: Object.keys(noRuleGroups).length,
        topGroups: Object.entries(noRuleGroups).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([key, count]) => ({ key, count })),
      },
      processDefects: processDefects.slice(0, 20),
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
