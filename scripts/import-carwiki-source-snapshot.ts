/**
 * Preserve the reviewed CarWiki source catalog as raw, auditable source rows.
 * This importer intentionally does not write calculation evidence, automatic
 * power references, vehicle specs, cars, prices, or publication state.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.CARWIKI_SOURCE_MANIFEST
  ?? "data/power/carwiki-kdm-source-snapshot-2026-10-21.json";
const write = process.env.CARWIKI_SOURCE_IMPORT_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;

type SnapshotRecord = {
  row_number: number;
  catalog_record: Record<string, unknown>;
  audit_record: Record<string, unknown> & {
    id: string;
    canonical_url: string;
    lineup_id: string | null;
    lineup_matched: string | null;
    verification_status: string;
    page_identity_verified: boolean;
    scraped_specs: Record<string, unknown>;
  };
};

type Snapshot = {
  schema_version: string;
  source: string;
  captured_at: string;
  reviewed_at: string;
  source_catalog_count: number;
  audit_count: number;
  counts: Record<string, number>;
  policy: string;
  records: SnapshotRecord[];
};

async function main() {
  const raw = await readFile(manifestPath);
  const snapshot = JSON.parse(raw.toString("utf8")) as Snapshot;
  const hash = createHash("sha256").update(raw).digest("hex");
  const ids = snapshot.records.map((row) => row.catalog_record.id);
  const statusCounts = snapshot.records.reduce<Record<string, number>>((counts, row) => {
    const status = row.audit_record.verification_status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  if (snapshot.schema_version !== "carwiki-source-snapshot-v1"
      || snapshot.source !== "CarWiki"
      || snapshot.records.length !== 227
      || snapshot.source_catalog_count !== snapshot.records.length
      || snapshot.audit_count !== snapshot.records.length
      || new Set(ids).size !== ids.length
      || snapshot.counts.verified_carwiki_card !== 208
      || snapshot.counts.page_identity_mismatch !== 2
      || snapshot.counts.unverified_candidate !== 17
      || JSON.stringify(statusCounts) !== JSON.stringify(snapshot.counts)) {
    throw new Error(`Snapshot integrity check failed: ${JSON.stringify({ records: snapshot.records.length, statusCounts })}`);
  }

  for (const row of snapshot.records) {
    if (row.catalog_record.id !== row.audit_record.id) throw new Error(`Catalog/audit ID mismatch at row ${row.row_number}`);
    if (row.audit_record.verification_status === "verified_carwiki_card"
        && (!row.audit_record.page_identity_verified || !row.audit_record.lineup_id || !row.audit_record.lineup_matched)) {
      throw new Error(`Verified row lacks page/lineup identity: ${row.audit_record.id}`);
    }
  }

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    await db.query("set local statement_timeout = '30s'");

    const before = await db.query<{ automatic_refs: number; approved_specs: number; cars: number }>(`
      select
        (select count(*)::int from public.vehicle_power_automatic_reference) as automatic_refs,
        (select count(*)::int from public.vehicle_power_specs where status = 'approved') as approved_specs,
        (select count(*)::int from public.cars) as cars
    `);

    const metadata = JSON.stringify({
      source: "CarWiki",
      snapshot: manifestPath,
      sourceRecords: snapshot.records.length,
      auditStatuses: statusCounts,
      calculationUse: "raw source only; no calculation evidence or automatic references created",
      powertrainCaveat: "Hybrid and electric motor/system output is not 30-minute power",
    });
    let batchId: string | null = null;
    let existingRows = 0;
    if (write) {
      const batch = await db.query<{ id: string }>(`
        insert into public.vehicle_power_source_batches
          (source_kind, source_name, source_uri, source_sha256, source_version, imported_by, metadata)
        values
          ('manual', 'CarWiki reviewed Korean vehicle specification snapshot', 'https://www.carwiki.co.kr/', $1,
           'carwiki-source-snapshot-2026-10-21-v1', 'codex-user-authorized', $2::jsonb)
        on conflict (source_kind, source_sha256) do update
          set metadata = excluded.metadata
        returning id
      `, [hash, metadata]);
      batchId = batch.rows[0]?.id ?? null;
      if (!batchId) throw new Error("Could not create or resolve source batch");
    } else {
      const existing = await db.query<{ id: string; n: number }>(`
        select b.id, count(r.id)::int as n
        from public.vehicle_power_source_batches b
        left join public.vehicle_power_source_rows r on r.batch_id = b.id
        where b.source_kind = 'manual' and b.source_sha256 = $1
        group by b.id
      `, [hash]);
      batchId = existing.rows[0]?.id ?? null;
      existingRows = existing.rows[0]?.n ?? 0;
    }

    let insertedRows = 0;
    for (const row of write ? snapshot.records : []) {
      const audit = row.audit_record;
      const catalog = row.catalog_record;
      const verified = audit.verification_status === "verified_carwiki_card";
      const scrapedPower = audit.scraped_specs.power_ps;
      const catalogPower = catalog.engine_power_ps;
      const powerText = scrapedPower == null
        ? (catalogPower == null ? null : `${catalogPower} PS (catalog candidate; not scraped/verified)`)
        : `${scrapedPower} PS (CarWiki lineup)`;
      const saved = await db.query(`
        insert into public.vehicle_power_source_rows
          (batch_id, source_sheet, source_row_number, raw_record, raw_vehicle_name,
           raw_power_text, parse_status, parse_warnings)
        values ($1, 'carwiki-kdm-227', $2, $3::jsonb, $4, $5, $6, $7::text[])
        on conflict (batch_id, source_sheet, source_row_number) do nothing
        returning id
      `, [
        batchId,
        row.row_number,
        JSON.stringify({ catalog_record: catalog, audit_record: audit }),
        `${String(catalog.brand_en ?? "")} ${String(catalog.model_en ?? "")}`.trim(),
        powerText,
        verified ? "parsed" : "needs_review",
        verified
          ? ["CarWiki source facts only; preliminary use requires exact vehicle configuration match; not approved TKS evidence"]
          : [`CarWiki audit status: ${audit.verification_status}; must be reviewed before use`],
      ]);
      insertedRows += saved.rowCount ?? 0;
    }

    let rowsInBatch = existingRows;
    if (write && batchId) {
      const savedRows = await db.query<{ n: number }>(
        "select count(*)::int as n from public.vehicle_power_source_rows where batch_id = $1",
        [batchId],
      );
      rowsInBatch = savedRows.rows[0]?.n ?? 0;
      if (rowsInBatch !== snapshot.records.length) {
        throw new Error(`Source row count mismatch: expected ${snapshot.records.length}, got ${rowsInBatch}`);
      }
    }

    const after = await db.query<{ automatic_refs: number; approved_specs: number; cars: number }>(`
      select
        (select count(*)::int from public.vehicle_power_automatic_reference) as automatic_refs,
        (select count(*)::int from public.vehicle_power_specs where status = 'approved') as approved_specs,
        (select count(*)::int from public.cars) as cars
    `);
    if (JSON.stringify(before.rows[0]) !== JSON.stringify(after.rows[0])) {
      throw new Error("Protected calculation/catalog table counts changed during source-only import");
    }

    const result = {
      write,
      source: "CarWiki",
      batchId,
      sha256: hash,
      manifestPath,
      rowsExpected: snapshot.records.length,
      rowsInsertedThisRun: insertedRows,
      rowsInBatch,
      auditStatuses: statusCounts,
      parseStatuses: { parsed: snapshot.counts.verified_carwiki_card, needs_review: snapshot.records.length - snapshot.counts.verified_carwiki_card },
      protectedCountsBefore: before.rows[0],
      protectedCountsAfter: after.rows[0],
      calculationReferencesCreated: 0,
      approvedEvidenceCreated: 0,
      publicCarsChanged: 0,
      note: "Source snapshot preserved for audit; it does not grant any CarWiki value TKS approval or set hybrid/EV 30-minute power.",
    };

    if (write) await db.query("commit");
    else await db.query("rollback");
    await writeFile(`output/carwiki-source-import-${write ? "applied" : "preview"}-2026-10-21.json`, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
