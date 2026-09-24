/**
 * Read-only first pass for newly discovered Encar cars.
 *
 * It deliberately consults only the approved TL Auto power reference.  A
 * missing or tied result is a work item for the next sources in the agreed
 * cascade; it never becomes a guessed power, a car record or a publication.
 */
import { Client } from "pg";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { canonicalCandidates, canonicalEngineCc, canonicalGeneration, canonicalInput, configurationKey } from "../src/server/power-resolution/canonical";
import { normalizeDrive } from "../src/server/normalization/vehicles";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!runId) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID is required");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Obj = Record<string, unknown>;
type CandidateRow = {
  source_listing_id: string;
  candidate_snapshot: Obj | null;
  raw_payload: Obj | null;
  normalized: Obj | null;
  result: Obj | null;
};

const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown): string | null => {
  const valueText = String(value ?? "").trim();
  return valueText || null;
};
const number = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
function modelYear(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})(?:\d{2})?$/);
  if (match) return Number(match[1]);
  const date = raw.match(/^(\d{4})[-/.]\d{1,2}/);
  return date ? Number(date[1]) : number(value);
}

function generationCode(model: unknown, ...values: unknown[]): string | null {
  const modelKey = String(model ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const normalized = canonicalGeneration(raw);
    if (normalized && /^[A-Z]{1,4}\d{1,4}[A-Z]{0,2}$/.test(normalized)) {
      if (normalized.replace(/[^A-Z0-9]/g, "") !== modelKey) return normalized;
      continue;
    }
    const inText = raw.match(/\b([A-Z]{1,4}\d{1,4}[A-Z]{0,2})\b/i);
    if (inText && inText[1].toUpperCase() !== modelKey) return inText[1].toUpperCase();
  }
  return null;
}

function canonicalEncarBrand(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s_()\-]/g, "");
  if (["renaultkoreasamsung", "renaultkorea"].includes(key)) return "Renault Korea";
  return raw;
}
function sourceIdentity(row: CandidateRow) {
  const snapshot = obj(row.candidate_snapshot);
  const payload = obj(row.raw_payload);
  const detail = obj(payload.detail);
  const category = obj(detail.category);
  const contents = obj(payload.vehicleContents);
  const normalized = obj(row.normalized);
  return {
    snapshotBrand: text(snapshot.brand),
    snapshotModel: text(snapshot.model),
    snapshotBadge: text(snapshot.badge ?? snapshot.badgeDetail),
    detailManufacturer: text(category.manufacturerEnglishName ?? category.manufacturerName),
    detailModelGroup: text(category.modelGroupEnglishName ?? category.modelGroupName),
    detailModel: text(category.modelName),
    detailGeneration: text(category.generation ?? detail.generation ?? contents.generation),
    normalizedBrand: text(normalized.brand),
    normalizedModel: text(normalized.model),
  };
}
function ready(result: Obj | null, name: string) {
  const probes = obj(obj(result).probes);
  return obj(probes[name]).classification === "ready";
}

function reference(row: Record<string, unknown>): ApprovedPowerCandidate {
  return {
    specId: String(row.spec_id), specVersion: Number(row.spec_version), calculationPowerKw: Number(row.calculation_power_kw),
    powerBasis: row.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(row.source_priority),
    evidenceId: String(row.evidence_id), evidenceKind: row.evidence_kind as ApprovedPowerCandidate["evidenceKind"],
    evidenceVerificationStatus: row.verification_status as ApprovedPowerCandidate["evidenceVerificationStatus"],
    evidenceReliability: row.reliability as ApprovedPowerCandidate["evidenceReliability"],
    match: {
      id: String(row.match_id), priority: Number(row.match_priority), brand: String(row.brand), model: String(row.model),
      generation: text(row.generation), trim: text(row.trim), badgeNormalized: text(row.badge_normalized),
      modelCode: text(row.model_code), engineCode: text(row.engine_code), fuelType: text(row.fuel_type), driveType: text(row.drive_type),
      productionYearFrom: number(row.production_year_from), productionYearTo: number(row.production_year_to),
      engineCcFrom: number(row.engine_cc_from), engineCcTo: number(row.engine_cc_to),
    },
  };
}

function inputFor(row: CandidateRow) {
  const snapshot = obj(row.candidate_snapshot);
  const payload = obj(row.raw_payload);
  const detail = obj(payload.detail);
  const spec = obj(detail.spec);
  const category = obj(detail.category);
  const contents = obj(payload.vehicleContents);
  // Encar listing Year is YYYYMM (e.g. 202411); the power rules use YYYY.
  // Refresh runs may be created from IDs only, so candidate_snapshot has no
  // discovery-time year. The current Encar detail carries it in category.
  const year = modelYear(
    snapshot.year ?? detail.year ?? detail.modelYear ?? contents.year ??
    category.formYear ?? category.yearMonth,
  );
  const engineCc = canonicalEngineCc(spec.displacement ?? detail.displacement ?? snapshot.engineCc);
  const badge = category.gradeEnglishName ?? snapshot.badge ?? snapshot.badgeDetail;
  const driveText = [
    category.gradeEnglishName,
    category.gradeDetailEnglishName,
    snapshot.badge,
    snapshot.badgeDetail,
    detail.driveType,
    spec.driveType,
    contents.driveType,
  ].filter(Boolean).join(" ");
  return canonicalInput({
    brand: canonicalEncarBrand(category.manufacturerEnglishName ?? snapshot.brand),
    model: category.modelGroupEnglishName ?? snapshot.model,
    // Korean display names such as “스타리아” are not generation identifiers.
    // Only pass an explicit generation code; otherwise leave the field unknown.
    generation: generationCode(
      category.modelGroupEnglishName ?? snapshot.model,
      category.generation, category.modelName, detail.generation, detail.modelName,
      contents.generation, contents.modelName, snapshot.generation,
    ),
    // A full Encar grade often contains engine/drivetrain descriptors rather
    // than a trim. Keep that text as the badge and only use a detailed grade
    // as trim, avoiding false exact-trim exclusions.
    trim: category.gradeDetailEnglishName ?? snapshot.trim,
    badge,
    modelCode: contents.modelCode ?? detail.modelCode,
    engineCode: spec.engineCode ?? detail.engineCode,
    fuelType: spec.fuelName ?? detail.fuelName ?? snapshot.fuelType,
    driveType: normalizeDrive(driveText),
    year,
    engineCc,
  });
}

function potentialMatches(input: ReturnType<typeof inputFor>, candidates: ApprovedPowerCandidate[]) {
  const missing: Array<keyof ApprovedPowerCandidate["match"]> = [];
  if (!input.generation) missing.push("generation");
  if (!input.trim) missing.push("trim");
  if (!input.badge) missing.push("badgeNormalized");
  if (!input.modelCode) missing.push("modelCode");
  if (!input.engineCode) missing.push("engineCode");
  if (!input.driveType) missing.push("driveType");
  const relaxed = candidates.map((candidate) => ({
    ...candidate,
    match: Object.fromEntries(Object.entries(candidate.match).map(([key, value]) => [
      key,
      missing.includes(key as keyof ApprovedPowerCandidate["match"]) ? null : value,
    ])) as ApprovedPowerCandidate["match"],
  }));
  const result = resolveApprovedPower(input, relaxed);
  return {
    missingConfigurationFields: missing,
    specIds: result.status === "matched" ? [result.candidate.specId] : result.candidates.map((candidate) => candidate.specId),
    ambiguous: result.status !== "matched" && result.candidates.length > 0,
  };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const [refs, rows] = await Promise.all([
      db.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
          evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status,evidence.reliability,evidence.evidence_tier,evidence.source_uri,
          matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec
        join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved'`),
      db.query<CandidateRow>(`select q.source_listing_id,q.candidate_snapshot,q.result,s.raw_payload,s.normalized
        from public.encar_enrichment_queue q
        join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
        where q.run_id=$1 and q.status='succeeded'
        order by q.source_listing_id`, [runId]),
    ]);
    const evidenceBySpecId = new Map(refs.rows.map((row) => [String(row.spec_id), {
      evidenceTier: text(row.evidence_tier) ?? "unknown", sourceUrl: text(row.source_uri),
    }]));
    const approved = canonicalCandidates(refs.rows.map(reference));
    const reportRows = rows.rows.map((row) => {
      const input = inputFor(row);
      const coreMissing = [!ready(row.result, "detail") && "detail", !input.brand && "brand", !input.model && "model", !input.year && "year", !input.engineCc && "engine_cc", !input.fuelType && "fuel_type"].filter(Boolean) as string[];
      if (coreMissing.length) return { sourceListingId: row.source_listing_id, status: "needs_source_retry", coreMissing, configuration: input, configurationKey: configurationKey(input) };
      const resolution = resolveApprovedPower(input, approved);
      if (resolution.status !== "matched") {
        const potential = potentialMatches(input, approved);
        const status = resolution.candidates.length
          ? "ambiguous"
          : potential.specIds.length
            ? potential.ambiguous ? "potential_ambiguous_needs_configuration" : "potential_match_needs_configuration"
            : "unmatched";
        return {
          sourceListingId: row.source_listing_id, status,
          reason: resolution.reason, configuration: input, configurationKey: configurationKey(input),
          candidateSpecIds: resolution.candidates.map((candidate) => candidate.specId),
          ...(potential.specIds.length ? { potentialMatch: potential } : {}),
        };
      }
      const evidence = evidenceBySpecId.get(resolution.candidate.specId);
      return {
        sourceListingId: row.source_listing_id, status: "approved_match", reason: resolution.reason,
        configuration: input, configurationKey: configurationKey(input),
        power: { specId: resolution.candidate.specId, evidenceId: resolution.candidate.evidenceId, evidenceTier: evidence?.evidenceTier ?? "unknown", sourceUrl: evidence?.sourceUrl ?? null, confidence: resolution.confidence, calculationPowerKw: resolution.candidate.calculationPowerKw, powerBasis: resolution.candidate.powerBasis },
      };
    });
    const counts = Object.fromEntries([
      "approved_match", "ambiguous", "potential_match_needs_configuration", "potential_ambiguous_needs_configuration", "unmatched", "needs_source_retry",
    ].map((status) => [status, reportRows.filter((row) => row.status === status).length]));
    const searchGroups = new Map<string, {
      brand: string | null; model: string | null; generation: string | null; year: number | null;
      engineCc: number | null; fuelType: string | null; driveType: string | null;
      listingIds: string[]; badgeExamples: string[]; sourceExamples: ReturnType<typeof sourceIdentity>[];
    }>();
    for (const row of reportRows) {
      if (row.status !== "unmatched") continue;
      const vehicle = row.configuration;
      const key = [vehicle.brand, vehicle.model, vehicle.generation, vehicle.year, vehicle.engineCc, vehicle.fuelType, vehicle.driveType]
        .map((value) => value ?? "?").join("|");
      const group = searchGroups.get(key) ?? {
        brand: vehicle.brand, model: vehicle.model, generation: vehicle.generation, year: vehicle.year,
        engineCc: vehicle.engineCc, fuelType: vehicle.fuelType, driveType: vehicle.driveType,
        listingIds: [], badgeExamples: [], sourceExamples: [],
      };
      group.listingIds.push(row.sourceListingId);
      const badge = vehicle.badge ?? vehicle.trim;
      if (badge && !group.badgeExamples.includes(badge)) group.badgeExamples.push(badge);
      if (group.sourceExamples.length < 3) {
        const source = sourceIdentity(rows.rows.find((candidate) => candidate.source_listing_id === row.sourceListingId)!);
        if (!group.sourceExamples.some((example) => JSON.stringify(example) === JSON.stringify(source))) group.sourceExamples.push(source);
      }
      searchGroups.set(key, group);
    }
    const externalSearchWorklist = [...searchGroups.values()]
      .sort((a, b) => b.listingIds.length - a.listingIds.length || String(a.brand).localeCompare(String(b.brand)) || String(a.model).localeCompare(String(b.model)));
    const t3Review = reportRows
      .filter((row) => row.status === "approved_match" && row.power?.evidenceTier === "T3")
      .map((row) => ({ sourceListingId: row.sourceListingId, configuration: row.configuration, power: row.power ?? null }));
    const report = {
      generatedAt: new Date().toISOString(), runId, readOnly: true, encarRequests: 0, databaseWrites: 0, publicCatalogChanged: false,
      policy: "approved TL Auto power evidence only; automatic reference, AI, price calculation and publication are excluded",
      input: { succeededEnrichmentRows: rows.rowCount ?? 0, approvedReferenceRules: refs.rowCount ?? 0 },
      counts,
      externalSearch: { unmatchedListings: counts.unmatched, distinctConfigurations: externalSearchWorklist.length, worklist: externalSearchWorklist },
      t3Review,
      candidates: reportRows,
    };
    await mkdir("output", { recursive: true });
    await writeFile("output/tl-auto-new-encar-power-plan.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      ...report,
      candidates: undefined,
      externalSearch: { ...report.externalSearch, worklist: undefined },
      t3Review: undefined,
      output: "output/tl-auto-new-encar-power-plan.json",
    }, null, 2));
    await db.query("rollback");
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
