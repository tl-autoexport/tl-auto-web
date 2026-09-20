import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only generation coverage audit — the first deliverable of the cascade
 * plan. It answers, before any backfill:
 *   - how many published cars can be matched to a staging row by
 *     source_listing_id at all;
 *   - whether the matched pair really describes the same car (model and year
 *     agreement), because staging and cars must never be assumed identical;
 *   - how many of the matched cars carry a generation value, which distinct
 *     values exist, and which cars would stay without one.
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");

    const totals = await db.query<{
      cars: number; matched: number; matched_with_generation: number;
      matched_without_generation: number; mismatched_model: number; mismatched_year: number;
    }>(`
      select
        count(*)::int as cars,
        count(s.source_listing_id)::int as matched,
        count(*) filter (where s.generation is not null)::int as matched_with_generation,
        count(*) filter (where s.source_listing_id is not null and s.generation is null)::int as matched_without_generation,
        count(*) filter (where s.source_listing_id is not null and s.manufacturer is not null and c.brand is not null
                           and lower(s.manufacturer) <> lower(c.brand))::int as mismatched_model,
        count(*) filter (where s.source_listing_id is not null and s.model_year is not null and c.year is not null
                           and s.model_year <> c.year)::int as mismatched_year
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true`);

    const distinct = await db.query<{ generation: string; cars: number }>(`
      select s.generation, count(*)::int as cars
      from public.cars c
      join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true and s.generation is not null
      group by 1 order by 2 desc`);

    const unmatchedSample = await db.query<{ source_id: string; brand: string | null; model: string | null; year: number | null }>(`
      select c.source_id, c.brand, c.model, c.year
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true and s.source_listing_id is null
      order by c.source_id limit 15`);

    const bodyAndFuel = await db.query<{ kind: string; value: string; cars: number }>(`
      select 'body_type' as kind, coalesce(body_type,'<null>') as value, count(*)::int as cars
      from public.cars where is_available = true group by 1,2
      union all
      select 'fuel_type', coalesce(fuel_type,'<null>'), count(*)::int from public.cars where is_available = true group by 1,2
      order by kind, cars desc`);

    const catalogSide = await db.query<{ cars: number; with_generation: number; without_generation: number; distinct_values: number }>(`
      select count(*)::int as cars,
             count(*) filter (where generation is not null)::int as with_generation,
             count(*) filter (where generation is null)::int as without_generation,
             count(distinct generation)::int as distinct_values
      from public.cars where is_available = true`);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      coverage: totals.rows[0],
      catalogSide: catalogSide.rows[0],
      distinctGenerations: distinct.rowCount,
      topGenerations: distinct.rows.slice(0, 25),
      unmatchedSample: unmatchedSample.rows,
      bodyAndFuel: bodyAndFuel.rows,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
