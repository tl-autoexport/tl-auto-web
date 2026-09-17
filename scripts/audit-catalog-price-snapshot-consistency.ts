import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only consistency check between the catalog price and its latest
 * calculation snapshot, plus the month actually recorded in the snapshot
 * inputs. It exists because another pipeline can rewrite snapshots, which would
 * silently desynchronise the repaired cards.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const summary = await db.query(`
      with latest as (
        select distinct on (cs.car_id) cs.car_id, cs.total_rub, cs.inputs, cs.calculated_at, cs.calc_version
        from public.calc_snapshots cs
        order by cs.car_id, cs.calculated_at desc
      )
      select
        count(*)::int as cars,
        count(*) filter (where latest.car_id is null)::int as without_snapshot,
        count(*) filter (where latest.car_id is not null and c.price_rub is distinct from latest.total_rub)::int as price_mismatch,
        count(*) filter (where latest.inputs ? 'month')::int as snapshot_has_month_key,
        count(*) filter (where (latest.inputs->>'month') is not null)::int as snapshot_month_not_null,
        count(*) filter (where latest.inputs->>'month' = '6')::int as snapshot_month_june,
        count(*) filter (where latest.inputs is not null and not (latest.inputs ? 'month'))::int as snapshot_missing_month_key,
        max(latest.calculated_at) as newest_snapshot
      from public.cars c
      left join latest on latest.car_id = c.id
      where c.primary_source='chestny_prigon' and c.is_available = true`);

    const byCalcVersion = await db.query(`
      with latest as (
        select distinct on (cs.car_id) cs.car_id, cs.calc_version
        from public.calc_snapshots cs order by cs.car_id, cs.calculated_at desc
      )
      select latest.calc_version, count(*)::int as cars
      from public.cars c left join latest on latest.car_id = c.id
      where c.primary_source='chestny_prigon' and c.is_available = true
      group by 1 order by 2 desc`);

    const repairs = await db.query(`
      select count(*)::int as repaired_cars,
             count(*) filter (where c.vehicle_specs ? 'power_repair')::int as with_repair_marker,
             count(*) filter (where (latest.inputs->>'month') is not null)::int as repair_snapshot_has_month
      from public.cars c
      left join (
        select distinct on (cs.car_id) cs.car_id, cs.inputs
        from public.calc_snapshots cs order by cs.car_id, cs.calculated_at desc
      ) latest on latest.car_id = c.id
      where c.primary_source='chestny_prigon' and c.vehicle_specs ? 'power_repair'`);

    await db.query("rollback");
    console.log(JSON.stringify({ readOnlyTransaction: true, encarRequests: 0, databaseWrites: 0,
      summary: summary.rows[0], latestByCalcVersion: byCalcVersion.rows, repairs: repairs.rows[0] }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
