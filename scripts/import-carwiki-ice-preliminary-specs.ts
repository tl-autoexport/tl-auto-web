/**
 * Cross-match reviewed CarWiki ICE/LPG facts into TL Auto's power-spec dictionary
 * as draft preliminary specifications. Drafts never participate in calculation
 * resolution until separately reviewed and approved.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const snapshotPath = process.env.CARWIKI_SOURCE_MANIFEST
  ?? "data/power/carwiki-kdm-source-snapshot-2026-10-21.json";
const write = process.env.CARWIKI_ICE_PRELIMINARY_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const PS_TO_KW = 0.73549875;
const excludedSharedLineups = new Set([
  "carwiki-bmw-520i-g60",
  "carwiki-bmw-530i-g60",
  "carwiki-bmw-320i-g20",
  "carwiki-bmw-m340i-g20",
  "carwiki-benz-s450-w223",
  "carwiki-benz-s500-w223",
  "carwiki-landrover-defender-110-d250",
  "carwiki-landrover-defender-110-d300",
]);

type Obj = Record<string, unknown>;
type SnapshotRecord = {
  row_number: number;
  catalog_record: Obj & {
    id: string; brand_en: string; model_en: string; generation: string;
    model_years: string; carwiki_title: string; powertrain_type: string;
    engine_type: string; displacement_cc: number; engine_power_ps: number;
    engine_power_rpm: number | null; source_url: string;
  };
  audit_record: Obj & {
    id: string; canonical_url: string; lineup_id: string; lineup_matched: string;
    verification_status: string; page_identity_verified: boolean;
    scraped_specs: { displacement_cc?: number; power_ps?: number; power_rpm?: number };
  };
};
type Snapshot = { schema_version: string; source: string; records: SnapshotRecord[] };
type Evidence = { id: string; source_row_id: string; source_kind: string; source_uri: string | null; review_status: string };
type ExistingSpec = { spec_key: string; version: number; status: string; evidence_id: string; dvs_power_kw: number | null; calculation_power_kw: number };

const yearRange = (value: string): [number, number] | null => {
  const match = value.match(/(\d{4})\s*[-–~]\s*(\d{4})/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const round4 = (value: number) => Number(value.toFixed(4));
const text = (value: unknown) => String(value ?? "").trim();

function buildCandidates(snapshot: Snapshot) {
  const verified = snapshot.records.filter((row) =>
    row.audit_record.verification_status === "verified_carwiki_card"
      && row.audit_record.page_identity_verified
      && ["gasoline", "diesel", "lpg"].includes(row.catalog_record.powertrain_type),
  );
  const lineupCounts = new Map<string, number>();
  for (const row of verified) {
    const key = `${row.audit_record.canonical_url}|${row.audit_record.lineup_id}`;
    lineupCounts.set(key, (lineupCounts.get(key) ?? 0) + 1);
  }
  const invalid = verified.filter((row) =>
    row.catalog_record.id !== row.audit_record.id
      || !row.audit_record.canonical_url
      || !row.audit_record.lineup_id
      || !row.audit_record.lineup_matched
      || !row.catalog_record.source_url
      || !yearRange(row.catalog_record.model_years)
      || Number(row.audit_record.scraped_specs.displacement_cc) !== Number(row.catalog_record.displacement_cc)
      || Number(row.audit_record.scraped_specs.power_ps) !== Number(row.catalog_record.engine_power_ps),
  );
  if (invalid.length) throw new Error(`CarWiki source/catalog integrity failures: ${invalid.map((row) => row.catalog_record.id).join(", ")}`);

  const sharedLineups = verified.filter((row) =>
    (lineupCounts.get(`${row.audit_record.canonical_url}|${row.audit_record.lineup_id}`) ?? 0) > 1,
  );
  const candidates = verified.filter((row) =>
    !sharedLineups.includes(row) && !excludedSharedLineups.has(row.catalog_record.id),
  );
  if (candidates.length !== 141 || sharedLineups.length !== 8) {
    throw new Error(`Unexpected reviewed ICE cohort: verified=${verified.length}, sharedLineup=${sharedLineups.length}, candidates=${candidates.length}`);
  }
  return { verified, sharedLineups, candidates, invalid };
}

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const bytes = await readFile(snapshotPath);
  const snapshot = JSON.parse(bytes.toString("utf8")) as Snapshot;
  if (snapshot.schema_version !== "carwiki-source-snapshot-v1" || snapshot.source !== "CarWiki" || snapshot.records.length !== 227) {
    throw new Error("Unexpected CarWiki source snapshot; refusing import");
  }
  const { verified, sharedLineups, candidates, invalid } = buildCandidates(snapshot);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    await db.query("set local statement_timeout = '30s'");
    const batchResult = await db.query<{ id: string }>(
      `select id from public.vehicle_power_source_batches where source_kind='manual' and source_sha256=$1`,
      [sha256],
    );
    if (batchResult.rows.length !== 1) throw new Error(`Expected one imported CarWiki source batch, found ${batchResult.rows.length}`);
    const batchId = batchResult.rows[0].id;
    const sourceRowsResult = await db.query<{ id: string; source_row_number: number }>(
      `select id,source_row_number from public.vehicle_power_source_rows where batch_id=$1 and source_sheet='carwiki-kdm-227'`,
      [batchId],
    );
    const sourceRows = new Map(sourceRowsResult.rows.map((row) => [row.source_row_number, row.id]));
    if (sourceRows.size !== 227) throw new Error(`Expected 227 source journal rows, found ${sourceRows.size}`);

    const keys = candidates.map((row) => `carwiki-source:${row.catalog_record.id}`);
    const existingSpecsResult = await db.query<ExistingSpec>(
      `select spec_key,version,status,evidence_id,dvs_power_kw::float8 as dvs_power_kw,calculation_power_kw::float8 as calculation_power_kw
         from public.vehicle_power_specs where spec_key=any($1::text[])${write ? " for update" : ""}`,
      [keys],
    );
    const existingByKey = new Map(existingSpecsResult.rows.map((row) => [row.spec_key, row]));
    const unexpected = existingSpecsResult.rows.filter((row) => row.status !== "draft");
    if (unexpected.length) throw new Error(`Existing non-draft CarWiki spec keys found: ${unexpected.map((row) => `${row.spec_key}:${row.status}`).join(", ")}`);

    const before = await db.query<{ evidence: number; specs: number; matches: number; refs: number; cars: number }>(`
      select
        (select count(*)::int from public.vehicle_power_evidence) evidence,
        (select count(*)::int from public.vehicle_power_specs) specs,
        (select count(*)::int from public.vehicle_power_spec_matches) matches,
        (select count(*)::int from public.vehicle_power_automatic_reference) refs,
        (select count(*)::int from public.cars) cars
    `);
    const plans = candidates.map((row) => {
      const catalog = row.catalog_record;
      const audit = row.audit_record;
      const years = yearRange(catalog.model_years)!;
      const ps = Number(audit.scraped_specs.power_ps);
      const kw = round4(ps * PS_TO_KW);
      return { row, years, ps, kw, specKey: `carwiki-source:${catalog.id}`, sourceRowId: sourceRows.get(row.row_number)! };
    });
    const evidenceExisting = await db.query<Evidence>(
      `select id,source_row_id,source_kind,source_uri,review_status from public.vehicle_power_evidence where source_row_id=any($1::uuid[])`,
      [plans.map((plan) => plan.sourceRowId)],
    );
    const evidenceBySource = new Map(evidenceExisting.rows.map((row) => [row.source_row_id, row]));
    const badEvidence = evidenceExisting.rows.filter((row) => row.source_kind !== "manual" || row.review_status !== "draft");
    if (badEvidence.length) throw new Error(`Source rows already have non-draft/other evidence: ${badEvidence.length}`);

    const evidenceRows: Evidence[] = [];
    for (const plan of plans) {
      const existing = evidenceBySource.get(plan.sourceRowId);
      if (existing) {
        if (existing.source_uri !== plan.row.audit_record.canonical_url) throw new Error(`Evidence URL mismatch for ${plan.specKey}`);
        evidenceRows.push(existing);
        continue;
      }
      if (!write) continue;
      const { row, years, ps, kw } = plan;
      const catalog = row.catalog_record;
      const audit = row.audit_record;
      const inserted = await db.query<Evidence>(`
        insert into public.vehicle_power_evidence
          (batch_id,source_row_id,source_kind,source_uri,source_title,captured_at,brand,model,generation,trim,engine_code,fuel_type,
           production_year_from,production_year_to,propulsion_type,dvs_power_kw,peak_power_kw,source_units,reliability,review_status,
           review_note,confidence_score,evidence_note,verification_status,evidence_tier,evidence_tier_source,evidence_tier_reviewed_at)
        values ($1,$2,'manual',$3,$4,current_date,$5,$6,$7,$8,$9,$10,$11,$12,'ice',$13,$13,$14,'medium','draft',$15,0.65,$16,'review_required','T3','CarWiki is a third-party source',now())
        returning id,source_row_id,source_kind,source_uri,review_status
      `, [
        batchId, plan.sourceRowId, audit.canonical_url, `CarWiki ${catalog.carwiki_title}`,
        catalog.brand_en, catalog.model_en, catalog.generation, audit.lineup_matched, catalog.engine_type,
        catalog.powertrain_type, years[0], years[1], plan.kw,
        `CarWiki reports ${ps} PS at ${audit.scraped_specs.power_rpm ?? catalog.engine_power_rpm ?? "unspecified"} rpm; converted using 1 PS = ${PS_TO_KW} kW`,
        `CarWiki third-party source row ${row.row_number}; exact page ${audit.canonical_url}; exact lineup ${audit.lineup_id}: ${audit.lineup_matched}.`,
        `CarWiki is a secondary specification source. This draft records ICE maximum output only; it is not SBKTS/OTTS/TKS evidence and is not calculation-approved. Exact CarWiki lineup ${audit.lineup_id}: ${audit.lineup_matched}.`,
      ]);
      evidenceRows.push(inserted.rows[0]);
    }

    if (!write && evidenceExisting.rows.length) {
      for (const plan of plans) {
        const e = evidenceBySource.get(plan.sourceRowId);
        if (!e || e.source_uri !== plan.row.audit_record.canonical_url) throw new Error(`Preview found incomplete evidence linkage for ${plan.specKey}`);
        evidenceRows.push(e);
      }
    }
    if (write && evidenceRows.length !== plans.length) throw new Error(`Evidence write mismatch: ${evidenceRows.length}/${plans.length}`);
    const evidenceBySourceId = new Map(evidenceRows.map((row) => [row.source_row_id, row]));

    let insertedSpecs = 0;
    for (const plan of plans) {
      const { row, years, ps, kw, specKey, sourceRowId } = plan;
      const previous = existingByKey.get(specKey);
      const evidence = evidenceBySourceId.get(sourceRowId);
      if (!evidence && write) throw new Error(`Missing source evidence for ${specKey}`);
      if (previous) {
        if (Number(previous.dvs_power_kw) !== kw || Number(previous.calculation_power_kw) !== kw || previous.evidence_id !== evidence?.id) {
          throw new Error(`Existing CarWiki draft differs from reviewed source: ${specKey}`);
        }
        continue;
      }
      if (!write) continue;
      const catalog = row.catalog_record;
      const audit = row.audit_record;
      const spec = await db.query<{ id: string }>(`
        insert into public.vehicle_power_specs
          (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,calculation_power_kw,
           evidence_id,approval_note,engine_power_hp,power_basis,source_priority,hybrid_type,power_ice_hp,customs_power_hp)
        values ($1,1,'draft','other','ice',$2,$2,$3,$3,$4,$5,$6,'combustion_engine',100,'none',$6,$6)
        returning id
      `, [
        specKey, Number(audit.scraped_specs.displacement_cc), kw, evidence!.id,
        `PRELIMINARY ONLY — CarWiki ${audit.canonical_url}; lineup ${audit.lineup_id}. Not approved TKS evidence; vehicle category and homologated/customs power require review.`, ps,
      ]);
      insertedSpecs += 1;
    }

    const after = write
      ? await db.query<{ evidence: number; specs: number; matches: number; refs: number; cars: number }>(`
          select
            (select count(*)::int from public.vehicle_power_evidence) evidence,
            (select count(*)::int from public.vehicle_power_specs) specs,
            (select count(*)::int from public.vehicle_power_spec_matches) matches,
            (select count(*)::int from public.vehicle_power_automatic_reference) refs,
            (select count(*)::int from public.cars) cars
        `)
      : before;
    const result = {
      write,
      source: "CarWiki",
      sourceSnapshot: snapshotPath,
      sourceBatchId: batchId,
      cohort: {
        verifiedIceLpgRows: verified.length,
        sourceCatalogAuditMismatches: invalid.length,
        excludedSharedLineupRows: sharedLineups.length,
        excludedSharedLineupIds: sharedLineups.map((row) => row.catalog_record.id),
        eligibleNewDraftSpecifications: plans.length,
      },
      database: {
        newDraftEvidence: write ? evidenceRows.filter((row) => !evidenceExisting.rows.some((old) => old.id === row.id)).length : plans.length - evidenceExisting.rows.length,
        newDraftSpecs: insertedSpecs,
        // CarWiki model/lineup labels do not map 1:1 to TL Auto listing badges.
        // Keep source specs unlinked until a dedicated vehicle crosswalk is reviewed.
        newSpecMatches: 0,
        automaticPowerReferencesChanged: 0,
        carsChanged: 0,
        pricesChanged: 0,
        publicationChanged: 0,
        before: before.rows[0],
        after: after.rows[0],
      },
      policy: "ICE/LPG CarWiki maximum output only; draft/unapproved, not TKS evidence. No hybrid or EV values imported because CarWiki does not establish 30-minute motor power.",
    };
    if (write) await db.query("commit");
    else await db.query("rollback");
    const reportPath = `output/carwiki-ice-preliminary-crosswalk-${write ? "applied" : "preview"}-2026-10-21.json`;
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ ...result, reportPath }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
