import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidate } from "../src/server/power-resolution/canonical";
import { isPublishableTier, tierFromStored, type EvidenceTier } from "../src/server/power-resolution/evidence-tiers";
import type { ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Read-only health check of the approved power reference. Reports what is
 * already fixed and what still needs review:
 *   - evidence tier distribution after the backfill;
 *   - specifications that describe the same configuration under different
 *     spellings (alias duplicates) once canonicalised;
 *   - matcher rows that constrain neither generation, trim nor badge;
 *   - T3 rows and whether a T1/T2 row corroborates the same configuration.
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const readOnly = await db.query<{ ro: string }>("select current_setting('transaction_read_only') as ro");

    const specs = await db.query(`select spec.id spec_id,spec.spec_key,spec.status spec_status,spec.version spec_version,
        spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,
        evidence.reliability,evidence.review_status,evidence.verification_status,evidence.confidence_score,evidence.review_note,evidence.evidence_tier,
        matcher.id match_id,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,
        matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,
        matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
      where spec.status='approved' and evidence.verification_status='approved'
      order by spec.spec_key`);

    const candidates: ApprovedPowerCandidate[] = specs.rows.map((r) => canonicalCandidate({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(r.source_priority),
      evidenceId: r.evidence_id, evidenceKind: r.source_kind as ApprovedPowerCandidate["evidenceKind"],
      evidenceVerificationStatus: r.verification_status,
      evidenceReliability: (r.reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: 10, brand: String(r.brand ?? ""), model: String(r.model ?? ""),
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    }));

    const tierOf = (r: (typeof specs.rows)[number]): EvidenceTier => tierFromStored(r.evidence_tier, {
      specKey: r.spec_key, sourceKind: r.source_kind, sourceTitle: r.source_title,
      sourceUri: r.source_uri, note: r.evidence_note,
    });

    const tierBySpecId = new Map<string, EvidenceTier>();
    const specKeyBySpecId = new Map<string, string>();
    const tierCounts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    const seenSpecs = new Set<string>();
    for (const row of specs.rows) {
      if (seenSpecs.has(row.spec_id)) continue;
      seenSpecs.add(row.spec_id);
      const tier = tierOf(row);
      tierBySpecId.set(row.spec_id, tier);
      specKeyBySpecId.set(row.spec_id, row.spec_key);
      tierCounts[tier]++;
    }

    // Alias duplicates: configurations that only became identical after
    // canonicalisation, or that were already duplicated verbatim.
    const byConfiguration = new Map<string, Set<string>>();
    const byConfigurationKeys = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      const m = candidate.match;
      const key = [m.brand, m.model, m.generation ?? "-", m.trim ?? m.badgeNormalized ?? "-",
        m.fuelType ?? "-", m.productionYearFrom ?? "?", m.productionYearTo ?? "?",
        m.engineCcFrom ?? "?", m.engineCcTo ?? "?", m.driveType ?? "-"].join(" | ");
      const specsForConfig = byConfiguration.get(key) ?? new Set<string>();
      specsForConfig.add(candidate.specId);
      byConfiguration.set(key, specsForConfig);
      const keysForConfig = byConfigurationKeys.get(key) ?? new Set<string>();
      keysForConfig.add(specKeyBySpecId.get(candidate.specId) ?? candidate.specId);
      byConfigurationKeys.set(key, keysForConfig);
    }

    const duplicateConfigurations = [...byConfiguration.entries()]
      .filter(([, specIds]) => specIds.size > 1)
      .map(([key, specIds]) => ({
        configuration: key,
        specs: [...specIds].map((specId) => {
          const rows = specs.rows.filter((r) => r.spec_id === specId);
          const first = rows[0];
          return {
            spec_key: specKeyBySpecId.get(specId),
            tier: tierBySpecId.get(specId),
            power_ps: first ? Math.round(Number(first.calculation_power_kw) * 1.359621617) : null,
            engine_cc: first ? [first.engine_cc_from, first.engine_cc_to] : null,
            years: first ? [first.production_year_from, first.production_year_to] : null,
            generation: first?.generation ?? null,
            trims: [...new Set(rows.map((r) => r.trim).filter(Boolean))],
            drive_type: [...new Set(rows.map((r) => r.drive_type).filter(Boolean))],
            source_host: String(first?.source_uri ?? "").replace(/^https?:\/\//, "").split("/")[0] || null,
            source_title: first?.source_title ?? null,
            matcher_rows: rows.length,
          };
        }),
        // Equivalence requires the same engine range, year range and drive set.
        equivalentRanges: (() => {
          const rows = specs.rows.filter((r) => specIds.has(r.spec_id));
          const shape = (r: (typeof rows)[number]) => [r.engine_cc_from, r.engine_cc_to, r.production_year_from, r.production_year_to, r.drive_type ?? "-"].join("|");
          return new Set(rows.map(shape)).size === 1;
        })(),
      }))
      .sort((a, b) => b.specs.length - a.specs.length);

    // Matcher rows that constrain none of the discriminating attributes.
    const broadRows = candidates.filter((c) =>
      !c.match.generation && !c.match.trim && !c.match.badgeNormalized && !c.match.modelCode && !c.match.engineCode);

    // T3 rows and T1/T2 corroboration for the same configuration and output.
    const corroboration: Array<Record<string, unknown>> = [];
    for (const row of specs.rows) {
      const tier = tierOf(row);
      if (tier !== "T3") continue;
      const self = candidates.find((c) => c.specId === row.spec_id && c.match.id === row.match_id);
      if (!self) continue;
      const corroborated = candidates.some((other) =>
        other.specId !== self.specId &&
        (tierBySpecId.get(other.specId) === "T1" || tierBySpecId.get(other.specId) === "T2") &&
        other.match.brand === self.match.brand && other.match.model === self.match.model &&
        Math.abs(other.calculationPowerKw - self.calculationPowerKw) <= 0.5);
      corroboration.push({
        spec_key: row.spec_key, host: String(row.source_uri ?? "").replace(/^https?:\/\//, "").split("/")[0] || null,
        corroborated, publishable: isPublishableTier(tier, corroborated),
      });
    }

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: readOnly.rows[0]?.ro === "on",
      encarRequests: 0,
      databaseWrites: 0,
      specifications: seenSpecs.size,
      matcherRows: candidates.length,
      tierDistribution: tierCounts,
      tiersStored: {
        reliabilityValues: [...new Set(specs.rows.map((r) => r.reliability))],
        reviewStatuses: [...new Set(specs.rows.map((r) => r.review_status))],
        verificationStatuses: [...new Set(specs.rows.map((r) => r.verification_status))],
        sourceKinds: [...new Set(specs.rows.map((r) => r.source_kind))],
      },
      provisionalSpecs: [...seenSpecs].filter((id) => tierBySpecId.get(id) === "T4").map((id) => specKeyBySpecId.get(id)),
      duplicateConfigurationCount: duplicateConfigurations.length,
      duplicateConfigurations: duplicateConfigurations.slice(0, 20),
      broadMatcherRows: broadRows.length,
      broadMatcherSpecs: [...new Set(broadRows.map((c) => specKeyBySpecId.get(c.specId) ?? c.specId))].length,
      t3Corroboration: corroboration,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
