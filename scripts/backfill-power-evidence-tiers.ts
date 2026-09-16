import { Client } from "pg";
import { config } from "dotenv";
import { evidenceTier } from "../src/server/power-resolution/evidence-tiers";

/**
 * Backfill evidence trust levels for rows that were imported before the
 * importer derived them from provenance. The mapping matches
 * `import-manufacturer-power-specs.ts` exactly, so a later re-import and this
 * backfill cannot disagree.
 *
 * T1/T2 -> reliability high,    verification approved
 * T3    -> reliability medium,  verification approved (corroboration required)
 * T4    -> reliability low,     verification draft, spec status draft (never published)
 *
 * Read-only by default. Set POWER_EVIDENCE_TIER_WRITE=true to apply.
 * No Encar requests, no public catalog writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.POWER_EVIDENCE_TIER_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = {
  evidence_id: string; spec_id: string; spec_key: string; spec_status: string;
  source_kind: string | null; source_title: string | null; source_uri: string | null; evidence_note: string | null;
  reliability: string; review_status: string; verification_status: string; confidence_score: number | null;
  review_note: string | null;
};

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
             evidence.confidence_score, evidence.review_note
      from public.vehicle_power_evidence evidence
      join public.vehicle_power_specs spec on spec.evidence_id = evidence.id`);

    const byTier: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    const evidenceUpdates: Array<{ id: string; values: ReturnType<typeof mappingFor> }> = [];
    const specUpdates: Array<{ id: string; status: string }> = [];

    for (const row of rows) {
      const tier = evidenceTier({
        specKey: row.spec_key, sourceKind: row.source_kind, sourceTitle: row.source_title,
        sourceUri: row.source_uri, note: row.evidence_note,
      });
      byTier[tier]++;

      const values = mappingFor(tier);
      const evidenceChanged =
        row.reliability !== values.reliability ||
        row.review_status !== values.reviewStatus ||
        row.verification_status !== values.verificationStatus ||
        Number(row.confidence_score ?? -1) !== values.confidenceScore ||
        row.review_note !== values.note;
      if (evidenceChanged) evidenceUpdates.push({ id: row.evidence_id, values });

      if (row.spec_status !== values.specStatus) specUpdates.push({ id: row.spec_id, status: values.specStatus });
    }

    let evidenceWritten = 0;
    let specsWritten = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const update of evidenceUpdates) {
          const result = await db.query(
            `update public.vehicle_power_evidence
                set reliability=$2, review_status=$3, verification_status=$4,
                    confidence_score=$5, review_note=$6, reviewed_by=coalesce(reviewed_by,'power-evidence-tier-backfill-v1'),
                    reviewed_at=coalesce(reviewed_at, now()), updated_at=now()
              where id=$1`,
            [update.id, update.values.reliability, update.values.reviewStatus, update.values.verificationStatus,
              update.values.confidenceScore, update.values.note],
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

    console.log(JSON.stringify({
      dryRun: !write,
      evidenceRows: rows.length,
      tierDistribution: byTier,
      evidenceUpdatesPlanned: evidenceUpdates.length,
      specStatusUpdatesPlanned: specUpdates.length,
      evidenceWritten,
      specsWritten,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
