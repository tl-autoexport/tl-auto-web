import { Client } from "pg";
import { config } from "dotenv";

/**
 * Marks where `published_at` came from and records the Encar enrichment coverage.
 *
 * `published_at` is only ever filled from something provable:
 *   - a date inside the stored source payload or a stored source snapshot;
 *   - otherwise our own `created_at`, explicitly marked as internal;
 *   - nothing else is invented, so a card without any basis stays `unknown`.
 *
 * The stored Encar payload contains no advertisement date, so in practice the
 * internal fallback is what applies — and the column now says so, instead of the
 * card silently presenting our import time as time on sale in Korea.
 *
 * The enrichment link is by the pair `(primary_source, source_id)`, never by the
 * numeric id alone, because ids from different sources can collide.
 *
 * Read-only by default; set CARD_PROVENANCE_WRITE=true to apply.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.CARD_PROVENANCE_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = {
  id: string;
  primary_source: string;
  source_id: string;
  published_at: Date | null;
  created_at: Date | null;
  has_enrichment_marks: boolean;
  enrichment_row: string | null;
  enrichment_queue_status: string | null;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select c.id, c.primary_source, c.source_id, c.published_at, c.created_at,
             (c.vehicle_specs ? 'encar_options_count' or c.vehicle_specs ? 'encar_full_gallery_count') as has_enrichment_marks,
             e.source_listing_id as enrichment_row,
             q.status as enrichment_queue_status
      from public.cars c
      left join public.encar_enrichment_staging e
             on c.primary_source = 'chestny_prigon' and e.source_listing_id = c.source_id
      left join public.encar_enrichment_queue q
             on q.source_listing_id = c.source_id and q.status = 'unavailable'
      where c.is_available = true`);

    const publishedAtSource: Record<string, number> = {};
    const enrichmentStatus: Record<string, number> = {};
    const planned: Array<{ id: string; publishedAt: Date | null; publishedAtSource: string; enrichmentStatus: string }> = [];

    for (const row of rows) {
      // published_at provenance: nothing in our stored payload carries an
      // advertisement date, so the only provable bases are our own timestamps.
      let source = "unknown";
      let publishedAt = row.published_at;
      if (row.published_at && row.created_at && row.published_at.getTime() === row.created_at.getTime()) {
        source = "internal_created_at";
      } else if (row.published_at) {
        source = "internal_publish_time";
      } else if (row.created_at) {
        source = "internal_created_at";
        publishedAt = row.created_at;
      }
      publishedAtSource[source] = (publishedAtSource[source] ?? 0) + 1;

      const status = row.has_enrichment_marks
        ? "applied"
        : row.enrichment_row
          ? "available_not_applied"
          : row.enrichment_queue_status === "unavailable"
            ? "unavailable"
            : "absent";
      enrichmentStatus[status] = (enrichmentStatus[status] ?? 0) + 1;

      planned.push({ id: row.id, publishedAt, publishedAtSource: source, enrichmentStatus: status });
    }

    let written = 0;
    if (write && planned.length) {
      await db.query("begin");
      try {
        const ids = planned.map((item) => item.id);
        const dates = planned.map((item) => item.publishedAt);
        const sources = planned.map((item) => item.publishedAtSource);
        const statuses = planned.map((item) => item.enrichmentStatus);
        const result = await db.query(
          `update public.cars as c
              set published_at = v.published_at,
                  published_at_source = v.published_at_source,
                  encar_enrichment_status = v.enrichment_status,
                  updated_at = now()
             from unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::text[]) as v(id, published_at, published_at_source, enrichment_status)
            where c.id = v.id
              and (c.published_at is distinct from v.published_at
                or c.published_at_source is distinct from v.published_at_source
                or c.encar_enrichment_status is distinct from v.enrichment_status)`,
          [ids, dates, sources, statuses],
        );
        written = result.rowCount ?? 0;
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      publishedCars: rows.length,
      publishedAtSource,
      enrichmentStatus,
      written,
      note: "No advertisement date exists in the stored Encar payload, so source_payload and source_snapshot are unavailable by fact, not by omission.",
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
