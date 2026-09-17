import { Client } from "pg";
import { config } from "dotenv";
import {
  canonicalCandidates,
  canonicalInput,
  configurationKey,
  type CanonicalVehicleInput,
} from "../src/server/power-resolution/canonical";
import { isPublishableTier, tierFromStored, type EvidenceTier } from "../src/server/power-resolution/evidence-tiers";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Read-only audit of the current staging queue. This script must never call
 * Encar or mutate Supabase: it opens a read-only transaction, prints a report
 * to stdout and writes nothing.
 *
 * Scope is restricted to the successful Encar run and to `auto_candidate`.
 * `pending` and `published` rows are reported only as counters, never analysed
 * or changed.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
// The same read-only audit can be pointed at the power_confirmed queue to
// verify that existing confirmations still resolve to the same specification.
const promotionStatus = process.env.AUDIT_PROMOTION_STATUS ?? "auto_candidate";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const KW_TO_PS = 1.359621617;

type CardRow = {
  source_listing_id: string; manufacturer: string | null; model: string | null; generation: string | null;
  trim: string | null; model_year: number | null; engine_cc: number | null; fuel_type: string | null;
  drive_type: string | null; transmission: string | null; exterior_color: string | null;
  first_registration_date: string | null; image_urls: unknown; raw_payload: Record<string, unknown> | null;
};

const galleryEntries = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url))
    .filter((url): url is string => typeof url === "string" && url.length > 0);
};

function registration(card: CardRow, detail: Record<string, unknown>) {
  const value = card.first_registration_date ?? detail.registrationDate ?? detail.firstRegistrationDate ?? null;
  if (value == null) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  if (card.model_year != null && year < card.model_year - 1) return null;
  return date.getUTCMonth() + 1;
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    // Hard read-only transaction: any write attempt fails inside it.
    await db.query("begin read only");
    const readOnly = await db.query<{ ro: string }>("select current_setting('transaction_read_only') as ro");

    const cards = await db.query<CardRow>(`select distinct on (s.source_listing_id)
          s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,
          s.drive_type,s.transmission,s.exterior_color,s.first_registration_date,s.image_urls,s.raw_payload
        from public.chestny_catalog_staging s
        join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1
        where q.status='succeeded' and s.source_status='active' and s.promotion_status=$2
        order by s.source_listing_id`, [runId, promotionStatus]);
    const refs = await db.query(`select spec.id spec_id,spec.version spec_version,spec.spec_key,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
          evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,
          evidence.verification_status,evidence.reliability,evidence.evidence_tier,
          matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,
          matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,
          matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec
        join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved'`);
    const statusCounts = await db.query(`select s.promotion_status, count(distinct s.source_listing_id)::int as count
        from public.chestny_catalog_staging s
        join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1
        where s.source_status='active' group by s.promotion_status order by s.promotion_status`, [runId]);

    const toCandidate = (r: (typeof refs.rows)[number]): ApprovedPowerCandidate => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis, sourcePriority: Number(r.source_priority), evidenceId: r.evidence_id,
      evidenceKind: r.evidence_kind, evidenceVerificationStatus: r.verification_status,
      evidenceReliability: r.reliability ?? "unreviewed",
      match: { id: r.match_id, priority: Number(r.match_priority), brand: r.brand, model: r.model,
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    });

    const candidates = canonicalCandidates(refs.rows.map(toCandidate));
    // Relaxed candidate sets exist to name the blocking constraint instead of
    // labelling every unresolved card as "no rule" (the previous audit bug).
    const withoutGeneration = canonicalCandidates(
      refs.rows.map((r) => toCandidate({ ...r, generation: null })),
    );
    const withoutBadge = canonicalCandidates(
      refs.rows.map((r) => toCandidate({ ...r, trim: null, badge_normalized: null })),
    );
    const withoutGenerationAndBadge = canonicalCandidates(
      refs.rows.map((r) => toCandidate({ ...r, generation: null, trim: null, badge_normalized: null })),
    );
    // Relaxing the axle names a drive conflict instead of reporting a generic
    // "no rule", because the resolver treats a missing axle as compatible.
    const withoutDrive = canonicalCandidates(
      refs.rows.map((r) => toCandidate({ ...r, drive_type: null })),
    );

    const tierBySpecId = new Map<string, EvidenceTier>();
    const refBySpecId = new Map<string, (typeof refs.rows)[number]>();
    for (const ref of refs.rows) {
      refBySpecId.set(ref.spec_id, ref);
      tierBySpecId.set(ref.spec_id, tierFromStored(ref.evidence_tier, {
        specKey: ref.spec_key, sourceKind: ref.evidence_kind, sourceTitle: ref.source_title,
        sourceUri: ref.source_uri, note: ref.evidence_note,
      }));
    }

    const report = {
      scope: { runId, sourceStatus: "active", promotionStatus, rows: cards.rowCount ?? 0 },
      readOnlyTransaction: readOnly.rows[0]?.ro === "on",
      encarRequests: 0,
      databaseWrites: 0,
      publicCatalogChanged: false,
      statusCounts: statusCounts.rows,
      fieldCoverage: {
        hasEncarEnrichment: 0, hasRegistrationDate: 0, driveNull: 0, fuelNull: 0, transmissionNull: 0, colorNull: 0,
        imagesEmpty: 0, imagesNonHttp: 0, imagesDuplicateUrls: 0, galleryFull: 0,
      },
      power: {
        matched: 0, reviewRequired: 0,
        byConfidence: { official: 0, high: 0 },
        byBand: { upTo160: 0, over160: 0 },
        byTier: { T1: 0, T2: 0, T3: 0, T4: 0 },
        matchedWithNullDrive: 0,
        t3Corroborated: 0, t3Uncorroborated: 0,
      },
      noSafeMatchReasons: {
        no_rule_anywhere: 0, generation_mismatch: 0, badge_mismatch: 0,
        generation_and_badge_mismatch: 0, drive_conflict: 0, ambiguous_multiple_rules: 0,
      },
      queues: {
        exact_match: 0, high_confidence: 0, source_review: 0, drive_pending: 0,
        month_pending: 0, photos_issue: 0, no_safe_match: 0, powerConfirmedEligible: 0,
      },
      gateOverlaps: {} as Record<string, number>,
      topConfigurationGroups: [] as Array<{ key: string; rows: number; resolved: number }>,
      noSafeMatchSamples: [] as Array<Record<string, unknown>>,
      evidenceProvenanceSummary: {} as Record<string, number>,
      evidenceProvenance: process.env.AUDIT_INCLUDE_PROVENANCE === "true"
        ? refs.rows
          .filter((ref, index, all) => all.findIndex((other) => other.spec_id === ref.spec_id) === index)
          .map((ref) => ({
            spec_key: ref.spec_key,
            tier: tierBySpecId.get(ref.spec_id) ?? "T4",
            source_kind: ref.evidence_kind,
            host: String(ref.source_uri ?? "").replace(/^https?:\/\//, "").split("/")[0] || null,
            declared_reliability: ref.reliability,
            declared_verification: ref.verification_status,
          }))
        : [],
    };

    const groups = new Map<string, { rows: number; resolved: number }>();
    const groupOf = (input: CanonicalVehicleInput) => configurationKey(input);

    for (const card of cards.rows) {
      const payload = (card.raw_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? null;

      if (Object.keys(enrichment).length) report.fieldCoverage.hasEncarEnrichment++;

      const images = galleryEntries(card.image_urls);
      const httpImages = images.filter((url) => /^https?:\/\//i.test(url));
      const uniqueHttp = [...new Set(httpImages)];
      const registrationMonth = registration(card, detail);

      if (registrationMonth != null) report.fieldCoverage.hasRegistrationDate++;
      if (!card.drive_type) report.fieldCoverage.driveNull++;
      if (!card.fuel_type) report.fieldCoverage.fuelNull++;
      if (!card.transmission) report.fieldCoverage.transmissionNull++;
      if (!card.exterior_color) report.fieldCoverage.colorNull++;
      if (!images.length) report.fieldCoverage.imagesEmpty++;
      if (httpImages.length < images.length) report.fieldCoverage.imagesNonHttp++;
      if (uniqueHttp.length < httpImages.length) report.fieldCoverage.imagesDuplicateUrls++;
      if (uniqueHttp.length > 0 && uniqueHttp.length === images.length) report.fieldCoverage.galleryFull++;

      const input = canonicalInput({
        brand: card.manufacturer, model: card.model, generation: card.generation, trim: grade ?? card.trim,
        fuelType: card.fuel_type, driveType: card.drive_type, year: card.model_year, engineCc: card.engine_cc,
      });
      const key = groupOf(input);
      const group = groups.get(key) ?? { rows: 0, resolved: 0 };
      group.rows++;

      const result = resolveApprovedPower(input, candidates);
      const driveMissing = input.driveType == null;
      const monthMissing = registrationMonth == null;
      const photosMissing = uniqueHttp.length === 0;

      if (driveMissing) bump(report.gateOverlaps, "drive_missing");
      if (monthMissing) bump(report.gateOverlaps, "month_missing");
      if (photosMissing) bump(report.gateOverlaps, "photos_missing");

      if (result.status !== "matched") {
        report.power.reviewRequired++;
        report.queues.no_safe_match++;
        let reason: keyof typeof report.noSafeMatchReasons;
        if (result.candidates.length > 1) {
          reason = "ambiguous_multiple_rules";
        } else if (resolveApprovedPower(input, withoutGeneration).status === "matched") {
          reason = "generation_mismatch";
        } else if (resolveApprovedPower(input, withoutBadge).status === "matched") {
          reason = "badge_mismatch";
        } else if (resolveApprovedPower(input, withoutGenerationAndBadge).status === "matched") {
          reason = "generation_and_badge_mismatch";
        } else if (resolveApprovedPower(input, withoutDrive).status === "matched") {
          reason = "drive_conflict";
        } else {
          reason = "no_rule_anywhere";
        }
        report.noSafeMatchReasons[reason]++;

        if (report.noSafeMatchSamples.length < 20) {
          report.noSafeMatchSamples.push({
            id: card.source_listing_id, brand: card.manufacturer, model: card.model, generation: card.generation,
            trim: grade ?? card.trim, year: card.model_year, engineCc: card.engine_cc, fuel: card.fuel_type,
            drive: card.drive_type, photos: uniqueHttp.length, reason,
            resolverReason: result.reason,
          });
        }
        groups.set(key, group);
        continue;
      }

      report.power.matched++;
      group.resolved++;
      report.power.byConfidence[result.confidence === "official" ? "official" : "high"]++;
      const hp = Math.round(Number(result.candidate.calculationPowerKw) * KW_TO_PS);
      report.power.byBand[hp <= 160 ? "upTo160" : "over160"]++;

      const specId = result.candidate.specId;
      const ref = refBySpecId.get(specId);
      const tier = tierBySpecId.get(specId) ?? "T4";
      report.power.byTier[tier]++;
      if (driveMissing) report.power.matchedWithNullDrive++;

      const corroborated = result.candidates.some((candidate) =>
        candidate.specId !== specId &&
        (tierBySpecId.get(candidate.specId) === "T1" || tierBySpecId.get(candidate.specId) === "T2") &&
        Math.abs(candidate.calculationPowerKw - result.candidate.calculationPowerKw) <= 0.5);
      if (tier === "T3") {
        if (corroborated) report.power.t3Corroborated++;
        else report.power.t3Uncorroborated++;
      }

      const ruleHasDecisiveRanges =
        ref?.engine_cc_from != null && ref?.engine_cc_to != null &&
        ref?.production_year_from != null && ref?.production_year_to != null;

      if (!isPublishableTier(tier, corroborated)) { report.queues.source_review++; groups.set(key, group); continue; }
      if (driveMissing) { report.queues.drive_pending++; groups.set(key, group); continue; }
      if (monthMissing) { report.queues.month_pending++; groups.set(key, group); continue; }
      if (photosMissing) { report.queues.photos_issue++; groups.set(key, group); continue; }

      const exact = (tier === "T1" || tier === "T2") && ruleHasDecisiveRanges;
      if (exact) report.queues.exact_match++;
      else report.queues.high_confidence++;
      report.queues.powerConfirmedEligible++;

      groups.set(key, group);
    }

    report.topConfigurationGroups = [...groups.entries()]
      .map(([key, value]) => ({ key, rows: value.rows, resolved: value.resolved }))
      .sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key))
      .slice(0, 15);

    const seenSpecIds = new Set<string>();
    for (const ref of refs.rows) {
      if (seenSpecIds.has(ref.spec_id)) continue;
      seenSpecIds.add(ref.spec_id);
      bump(report.evidenceProvenanceSummary, tierBySpecId.get(ref.spec_id) ?? "T4");
    }

    await db.query("rollback");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
