import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only inventory of everything stored in Supabase for TL Auto.
 *
 * Part A: every table in `public` with its exact row count.
 * Part B: the catalogue split by source, availability, price and power.
 * Part C: the staging reserve and the enrichment queues by status.
 * Part D: the power reference, the AI journal and the media/snapshot volumes.
 *
 * No writes, no Encar requests.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const count = async (sql: string, params: unknown[] = []) => {
      const { rows } = await db.query<{ rows: string }>(sql, params);
      return Number(rows[0]?.rows ?? 0);
    };
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    // --- A. every table with an exact count -------------------------------------
    const tables = await q<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      tableCounts[table.table_name] = await count(`select count(*)::text as rows from public."${table.table_name}"`);
    }

    // --- B. the catalogue ------------------------------------------------------
    const carsBySourceAvailability = await q(`
      select primary_source, is_available, count(*)::int as cars
      from public.cars group by 1, 2 order by 1, 2 desc`);
    const carsByStatus = await q(`
      select case when is_available then 'published' else 'unpublished' end as state,
             coalesce(sale_status, '<null>') as sale_status, count(*)::int as cars
      from public.cars group by 1, 2 order by 1, 3 desc`);
    const carsByPowerConfidence = await q(`
      select coalesce(power_confidence, '<null>') as power_confidence,
             count(*)::int as cars,
             count(*) filter (where price_rub is not null)::int as with_price,
             count(*) filter (where power_hp is not null)::int as with_power
      from public.cars group by 1 order by 2 desc`);
    const carsByCalculationStatus = await q(`
      select coalesce(calculation_power_status, '<null>') as calculation_power_status,
             count(*)::int as cars,
             count(*) filter (where calculation_power_kw is not null)::int as with_kw
      from public.cars group by 1 order by 2 desc`);
    const carsEnrichment = await q(`
      select
        count(*) filter (where vehicle_specs ? 'encar_options_count' or vehicle_specs ? 'encar_full_gallery_count')::int as enriched_from_encar,
        count(*) filter (where vehicle_specs ? 'encar_enrichment')::int as with_enrichment_payload,
        count(*) filter (where generation is not null)::int as with_generation,
        count(*) filter (where generation_code is not null)::int as with_generation_code,
        count(*) filter (where drive_type is not null)::int as with_drive,
        count(*) filter (where vehicle_specs->>'drive_source' = 'assumed')::int as drive_assumed,
        count(*) filter (where price_rub is not null)::int as with_price,
        count(*) filter (where power_hp is not null)::int as with_power,
        count(*) filter (where calculation_month is not null)::int as with_month,
        count(*) filter (where power_ai_evidence_id is not null)::int as with_ai_evidence,
        count(*) filter (where published_at >= now() - interval '24 hours')::int as published_last_24h,
        count(*) filter (where published_at >= now() - interval '7 days')::int as published_last_7d
      from public.cars where is_available`);
    const carsBySourceDetail = await q(`
      select primary_source, count(*)::int as cars,
             count(*) filter (where price_rub is not null)::int as with_price,
             count(*) filter (where power_confidence = 'high')::int as high_confidence,
             count(*) filter (where power_confidence in ('approximate','automatic'))::int as preliminary
      from public.cars where is_available group by 1 order by 2 desc`);

    // --- C. staging reserve and queues -----------------------------------------
    const staging = await q(`
      select source_status, promotion_status, count(*)::int as rows,
             count(*) filter (where raw_payload ? 'encar_enrichment')::int as with_enrichment,
             count(*) filter (where drive_type is not null)::int as with_drive,
             count(*) filter (where generation is not null)::int as with_generation
      from public.chestny_catalog_staging group by 1, 2 order by 3 desc`);
    const queue = await q(`
      select status, count(*)::int as rows from public.catalog_enrichment_queue group by 1 order by 2 desc`);
    const runs = await q(`
      select run_id, status, count(*)::int as rows
      from public.catalog_enrichment_queue group by 1, 2 order by 3 desc limit 10`);
    const reviewQueue = await q(`
      select coalesce(status, '<null>') as status, count(*)::int as rows
      from public.vehicle_power_review_queue group by 1 order by 2 desc`);
    const stagingVsCars = await q(`
      select s.source_status, s.promotion_status,
             count(*)::int as staging_rows,
             count(c.id)::int as already_in_catalog
      from public.chestny_catalog_staging s
      left join public.cars c on c.primary_source = 'chestny_prigon' and c.source_id = s.source_listing_id
      group by 1, 2 order by 3 desc`);

    // --- D. reference, AI journal, media, snapshots ----------------------------
    const powerReference = await q(`
      select 'vehicle_power_specs' as table_name, count(*)::int as rows from public.vehicle_power_specs
      union all select 'vehicle_power_evidence', count(*)::int from public.vehicle_power_evidence
      union all select 'vehicle_power_spec_matches', count(*)::int from public.vehicle_power_spec_matches
      union all select 'vehicle_power_resolution_events', count(*)::int from public.vehicle_power_resolution_events
      union all select 'vehicle_power_ai_evidence', count(*)::int from public.vehicle_power_ai_evidence
      union all select 'catalog_generation_dictionary', count(*)::int from public.catalog_generation_dictionary
      union all select 'vehicle_power_source_batches', count(*)::int from public.vehicle_power_source_batches
      union all select 'vehicle_power_source_rows', count(*)::int from public.vehicle_power_source_rows
      order by 1`);
    const catalogGeneration = await q(`
      select status, count(*)::int as rows, coalesce(sum(cars_count), 0)::int as cars
      from public.catalog_generation_dictionary group by 1 order by 2 desc`);

    // --- E. where enrichment lives, archive and media coverage -----------------
    const columnsOf = async (table: string) => (await q<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name=$1 order by ordinal_position`, [table])).map((row) => row.column_name);

    const enrichmentColumns = await columnsOf("encar_enrichment_staging");
    const archiveColumns = await columnsOf("catalog_archive_members");
    const automaticReferenceColumns = await columnsOf("vehicle_power_automatic_reference");

    const enrichmentCoverage = enrichmentColumns.includes("source_listing_id")
      ? await q(`
          select
            (select count(*)::int from public.encar_enrichment_staging) as enrichment_rows,
            (select count(distinct e.source_listing_id)::int from public.encar_enrichment_staging e
               join public.chestny_catalog_staging s on s.source_listing_id = e.source_listing_id) as joined_to_staging,
            (select count(distinct c.id)::int from public.cars c
               join public.encar_enrichment_staging e on e.source_listing_id = c.source_id
               where c.is_available) as published_with_enrichment,
            (select count(*)::int from public.cars where is_available) as published_total`)
      : [];

    const queueByStatus = await q(`
      select status, count(*)::int as rows from public.encar_enrichment_queue group by 1 order by 2 desc`);

    const mediaCoverage = await q(`
      select
        (select count(distinct car_id)::int from public.car_media) as cars_with_media,
        (select count(*)::int from public.car_media where media_type = 'image') as image_rows,
        (select count(*)::int from public.cars c where c.is_available
           and not exists (select 1 from public.car_media m where m.car_id = c.id)) as published_without_media,
        (select count(distinct car_id)::int from public.car_options) as cars_with_options,
        (select count(distinct car_id)::int from public.car_condition_reports) as cars_with_reports,
        (select count(distinct car_id)::int from public.calc_snapshots) as cars_with_snapshot`);

    const archiveBy = archiveColumns.includes("member_status")
      ? await q(`select member_status, count(*)::int as rows from public.catalog_archive_members group by 1 order by 2 desc`)
      : await q(`select 'n/a' as member_status, count(*)::int as rows from public.catalog_archive_members`);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnly: true,
      encarRequests: 0,
      databaseWrites: 0,
      capturedAt: new Date().toISOString(),
      A_tables: tableCounts,
      B_catalog: { carsBySourceAvailability, carsByStatus, carsByPowerConfidence, carsByCalculationStatus, carsEnrichment: carsEnrichment[0], carsBySourceDetail },
      C_reserve: { staging, queue, runs, reviewQueue, stagingVsCars },
      D_reference: { powerReference, catalogGeneration },
      E_enrichmentAndArchive: { enrichmentColumns, archiveColumns, automaticReferenceColumns, enrichmentCoverage, queueByStatus, mediaCoverage, archiveBy },
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
