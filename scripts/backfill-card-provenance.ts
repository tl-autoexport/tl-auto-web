import { Client } from "pg";
import { config } from "dotenv";

/**
 * Marks where `published_at` came from, keeps the internal timeline separate, and
 * records the Encar enrichment coverage.
 *
 * `published_at` means the advertisement date at the source and is shown as
 * "В продаже N дней в Корее". Our stored Encar payload contains no advertisement
 * date at all, so:
 *   - a source date would be kept (source_payload / source_snapshot);
 *   - anything else is NOT written to published_at: the internal timestamp moves
 *     to catalog_added_at, published_at becomes null and its source becomes
 *     "unknown".
 * That keeps an internal fact out of a field the interface presents as a fact
 * about the Korean market.
 *
 * The enrichment link is by the pair `(primary_source, source_id)`, never by the
 * numeric id alone. "applied" is decided from every signal an applied enrichment
 * leaves behind — the payload marks, car_options, car_condition_reports and
 * Encar media — because a card enriched by an older pipeline has no marks and
 * must not be queued for processing again.
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
  published_at_source: string | null;
  has_payload_marks: boolean;
  has_options: boolean;
  has_reports: boolean;
  has_encar_media: boolean;
  enrichment_row: string | null;
  enrichment_queue_status: string | null;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select c.id, c.primary_source, c.source_id, c.published_at, c.created_at, c.published_at_source,
             (c.vehicle_specs ? 'encar_options_count' or c.vehicle_specs ? 'encar_full_gallery_count') as has_payload_marks,
             exists (select 1 from public.car_options o where o.car_id = c.id) as has_options,
             exists (select 1 from public.car_condition_reports r where r.car_id = c.id) as has_reports,
             exists (select 1 from public.car_media m where m.car_id = c.id and m.source = 'encar') as has_encar_media,
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
    const appliedBy: Record<string, number> = {};
    const planned: Array<{
      id: string; publishedAt: Date | null; publishedAtSource: string;
      catalogAddedAt: Date | null; enrichmentStatus: string;
    }> = [];

    for (const row of rows) {
      // A source date is the only thing that may stay in published_at.
      const datedFromSource = row.published_at_source === "source_payload" || row.published_at_source === "source_snapshot";
      const internalTimestamp = row.published_at ?? row.created_at;

      const publishedAt = datedFromSource ? row.published_at : null;
      const publishedAtSourceValue = datedFromSource ? String(row.published_at_source) : "unknown";
      publishedAtSource[publishedAtSourceValue] = (publishedAtSource[publishedAtSourceValue] ?? 0) + 1;

      const appliedSignals = [row.has_payload_marks, row.has_options, row.has_reports, row.has_encar_media].filter(Boolean).length;
      const status = appliedSignals > 0
        ? "applied"
        : row.enrichment_row
          ? "available_not_applied"
          : row.enrichment_queue_status === "unavailable"
            ? "unavailable"
            : "absent";
      enrichmentStatus[status] = (enrichmentStatus[status] ?? 0) + 1;
      if (status === "applied") {
        if (row.has_payload_marks) appliedBy.payload_marks = (appliedBy.payload_marks ?? 0) + 1;
        if (row.has_options) appliedBy.options = (appliedBy.options ?? 0) + 1;
        if (row.has_reports) appliedBy.reports = (appliedBy.reports ?? 0) + 1;
        if (row.has_encar_media) appliedBy.encar_media = (appliedBy.encar_media ?? 0) + 1;
      }

      planned.push({
        id: row.id, publishedAt, publishedAtSource: publishedAtSourceValue,
        catalogAddedAt: internalTimestamp, enrichmentStatus: status,
      });
    }

    let written = 0;
    if (write && planned.length) {
      await db.query("begin");
      try {
        const result = await db.query(
          `update public.cars as c
              set published_at = v.published_at,
                  published_at_source = v.published_at_source,
                  catalog_added_at = coalesce(c.catalog_added_at, v.catalog_added_at),
                  encar_enrichment_status = v.enrichment_status,
                  updated_at = now()
             from unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::timestamptz[], $5::text[])
                  as v(id, published_at, published_at_source, catalog_added_at, enrichment_status)
            where c.id = v.id
              and (c.published_at is distinct from v.published_at
                or c.published_at_source is distinct from v.published_at_source
                or c.catalog_added_at is distinct from coalesce(c.catalog_added_at, v.catalog_added_at)
                or c.encar_enrichment_status is distinct from v.enrichment_status)`,
          [
            planned.map((item) => item.id), planned.map((item) => item.publishedAt),
            planned.map((item) => item.publishedAtSource), planned.map((item) => item.catalogAddedAt),
            planned.map((item) => item.enrichmentStatus),
          ],
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
      appliedEvidence: appliedBy,
      written,
      note: "published_at keeps only a source date; the internal timeline lives in catalog_added_at. 'applied' counts every signal an older enrichment left behind.",
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
