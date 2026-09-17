import { Client } from "pg";
import { config } from "dotenv";
import { evidenceTier } from "../src/server/power-resolution/evidence-tiers";

/**
 * Persists the evidence trust level into `vehicle_power_evidence.evidence_tier`
 * and keeps the derived `reliability`/`review_status`/`verification_status`
 * consistent with it, so the publication gate reads a stored level instead of
 * recomputing one per script.
 *
 * T1/T2 -> reliability high,   verification approved, spec approved
 * T3    -> reliability medium, verification approved (corroboration required)
 * T4    -> reliability low,    verification draft,    spec draft (never published)
 *
 * Read-only by default. Set POWER_EVIDENCE_TIER_WRITE=true to apply.
 * Prints the full tier report, so the state after the migration is auditable.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.POWER_EVIDENCE_TIER_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = {
  evidence_id: string; spec_id: string; spec_key: string; spec_status: string;
  source_kind: string | null; source_title: string | null; source_uri: string | null; evidence_note: string | null;
  reliability: string; review_status: string; verification_status: string; confidence_score: number | null;
  review_note: string | null; evidence_tier: string | null;
};

const LEGACY = { reliability: "high", reviewStatus: "verified", verificationStatus: "approved", confidenceScore: 95 };

const mappingFor = (tier: ReturnType<typeof evidenceTier>) => ({
  reliability: tier === "T1" || tier === "T2" ? "high" : tier === "T3" ? "medium" : "low",
  reviewStatus: tier === "T4" ? "draft" : "verified",
  verificationStatus: tier === "T4" ? "draft" : "approved",
  confidenceScore: tier === "T1" || tier === "T2" ? 95 : tier === "T3" ? 70 : 40,
  specStatus: tier === "T4" ? "draft" : "approved",
  note: `Evidence tier ${tier} derived from source provenance at import.`,
});

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select evidence.id evidence_id, spec.id spec_id, spec.spec_key, spec.status spec_status,
             evidence.source_kind, evidence.source_title, evidence.source_uri, evidence.evidence_note,
             evidence.reliability, evidence.review_status, evidence.verification_status,
             evidence.confidence_score, evidence.review_note, evidence.evidence_tier
      from public.vehicle_power_evidence evidence
      join public.vehicle_power_specs spec on spec.evidence_id = evidence.id
      order by spec.spec_key`);

    const tierBySpec = new Map<string, { tier: string; specStatus: string; reliability: string; reviewStatus: string; verificationStatus: string }>();
    const evidenceUpdates: Array<{ id: string; tier: string; values: ReturnType<typeof mappingFor> }> = [];
    const specUpdates: Array<{ id: string; status: string }> = [];
    const stillLegacy: string[] = [];

    for (const row of rows) {
      const tier = evidenceTier({
        specKey: row.spec_key, sourceKind: row.source_kind, sourceTitle: row.source_title,
        sourceUri: row.source_uri, note: row.evidence_note,
      });
      const values = mappingFor(tier);
      const changed =
        row.evidence_tier !== tier ||
        row.reliability !== values.reliability ||
        row.review_status !== values.reviewStatus ||
        row.verification_status !== values.verificationStatus ||
        Number(row.confidence_score ?? -1) !== values.confidenceScore ||
        row.review_note !== values.note;
      if (changed) evidenceUpdates.push({ id: row.evidence_id, tier, values });
      if (row.spec_status !== values.specStatus) specUpdates.push({ id: row.spec_id, status: values.specStatus });

      if (row.reliability === LEGACY.reliability && row.review_status === LEGACY.reviewStatus &&
        row.verification_status === LEGACY.verificationStatus && row.evidence_tier == null) {
        stillLegacy.push(row.spec_key);
      }
      tierBySpec.set(row.spec_key, {
        tier, specStatus: values.specStatus, reliability: values.reliability,
        reviewStatus: values.reviewStatus, verificationStatus: values.verificationStatus,
      });
    }

    let evidenceWritten = 0;
    let specsWritten = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const update of evidenceUpdates) {
          const result = await db.query(
            `update public.vehicle_power_evidence
                set evidence_tier=$2, evidence_tier_source='derived_from_provenance_v1',
                    evidence_tier_reviewed_at=coalesce(evidence_tier_reviewed_at, now()),
                    reliability=$3, review_status=$4, verification_status=$5,
                    confidence_score=$6, review_note=$7,
                    reviewed_by=coalesce(reviewed_by,'power-evidence-tier-backfill-v1'),
                    reviewed_at=coalesce(reviewed_at, now()), updated_at=now()
              where id=$1`,
            [update.id, update.tier, update.values.reliability, update.values.reviewStatus,
              update.values.verificationStatus, update.values.confidenceScore, update.values.note],
          );
          evidenceWritten += result.rowCount ?? 0;
        }
        for (const update of specUpdates) {
          const result = await db.query(
            `update public.vehicle_power_specs set status=$2, updated_at=now() where id=$1`,
            [update.id, update.status],
          );
          specsWritten += result.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    const tierCounts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    const specStatusByTier: Record<string, Record<string, number>> = {};
    const tierByStatus: Record<string, number> = {};
    for (const row of rows) {
      const entry = tierBySpec.get(row.spec_key);
      if (!entry) continue;
      tierCounts[entry.tier] = (tierCounts[entry.tier] ?? 0) + 1;
      const bucket = specStatusByTier[entry.tier] ?? {};
      bucket[entry.specStatus] = (bucket[entry.specStatus] ?? 0) + 1;
      specStatusByTier[entry.tier] = bucket;
      tierByStatus[`${entry.tier}/${entry.verificationStatus}/${entry.specStatus}`] =
        (tierByStatus[`${entry.tier}/${entry.verificationStatus}/${entry.specStatus}`] ?? 0) + 1;
    }

    console.log(JSON.stringify({
      dryRun: !write,
      evidenceRows: rows.length,
      tierDistribution: tierCounts,
      specStatusByTier,
      tierVerificationSpecStatus: tierByStatus,
      evidenceUpdatesPlanned: evidenceUpdates.length,
      specStatusUpdatesPlanned: specUpdates.length,
      evidenceWritten,
      specsWritten,
      rowsStillOnLegacyDefaults: stillLegacy.length,
      nonApprovedRows: rows
        .filter((row) => tierBySpec.get(row.spec_key)?.verificationStatus !== "approved")
        .map((row) => ({ spec_key: row.spec_key, tier: tierBySpec.get(row.spec_key)?.tier })),
      tierTable: process.env.POWER_EVIDENCE_TIER_REPORT === "full"
        ? rows.map((row) => ({
          spec_key: row.spec_key,
          tier: tierBySpec.get(row.spec_key)?.tier,
          spec_status: tierBySpec.get(row.spec_key)?.specStatus,
          reliability: tierBySpec.get(row.spec_key)?.reliability,
          review_status: tierBySpec.get(row.spec_key)?.reviewStatus,
          verification_status: tierBySpec.get(row.spec_key)?.verificationStatus,
        }))
        : undefined,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
