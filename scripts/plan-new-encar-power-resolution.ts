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
import { canonicalCandidates, canonicalEngineCc, canonicalInput, configurationKey } from "../src/server/power-resolution/canonical";
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
  const year = number(snapshot.year ?? detail.year ?? detail.modelYear ?? contents.year);
  const engineCc = canonicalEngineCc(spec.displacement ?? detail.displacement ?? snapshot.engineCc);
  return canonicalInput({
    brand: category.manufacturerEnglishName ?? snapshot.brand,
    model: category.modelGroupEnglishName ?? snapshot.model,
    generation: category.modelName ?? detail.modelName ?? contents.modelName,
    trim: category.gradeDetailEnglishName ?? category.gradeEnglishName ?? snapshot.badge,
    badge: category.gradeEnglishName ?? snapshot.badge,
    modelCode: contents.modelCd ?? contents.modelCode,
    engineCode: spec.engineCode ?? detail.engineCode,
    fuelType: spec.fuelName ?? detail.fuelName ?? snapshot.fuelType,
    driveType: spec.driveType ?? detail.driveType ?? contents.driveType,
    year,
    engineCc,
  });
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
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
      if (resolution.status !== "matched") return {
        sourceListingId: row.source_listing_id, status: resolution.candidates.length ? "ambiguous" : "unmatched",
        reason: resolution.reason, configuration: input, configurationKey: configurationKey(input),
        candidateSpecIds: resolution.candidates.map((candidate) => candidate.specId),
      };
      const evidence = evidenceBySpecId.get(resolution.candidate.specId);
      return {
        sourceListingId: row.source_listing_id, status: "approved_match", reason: resolution.reason,
        configuration: input, configurationKey: configurationKey(input),
        power: { specId: resolution.candidate.specId, evidenceId: resolution.candidate.evidenceId, evidenceTier: evidence?.evidenceTier ?? "unknown", sourceUrl: evidence?.sourceUrl ?? null, confidence: resolution.confidence, calculationPowerKw: resolution.candidate.calculationPowerKw, powerBasis: resolution.candidate.powerBasis },
      };
    });
    const counts = Object.fromEntries(["approved_match", "ambiguous", "unmatched", "needs_source_retry"].map((status) => [status, reportRows.filter((row) => row.status === status).length]));
    const report = {
      generatedAt: new Date().toISOString(), runId, readOnly: true, encarRequests: 0, databaseWrites: 0, publicCatalogChanged: false,
      policy: "approved TL Auto power evidence only; automatic reference, AI, price calculation and publication are excluded",
      input: { succeededEnrichmentRows: rows.rowCount ?? 0, approvedReferenceRules: refs.rowCount ?? 0 }, counts, candidates: reportRows,
    };
    await mkdir("output", { recursive: true });
    await writeFile("output/tl-auto-new-encar-power-plan.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, candidates: undefined, output: "output/tl-auto-new-encar-power-plan.json" }, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
