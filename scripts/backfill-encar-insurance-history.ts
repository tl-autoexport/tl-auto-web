/**
 * Restore missing Encar insurance reports from payloads already saved in
 * encar_enrichment_staging or source_snapshots. This script never calls Encar.
 * It is read-only by default; pass --write to insert missing reports and fill
 * null denormalized counters in one database transaction.
 */
import { Client } from "pg";
import { config } from "dotenv";
import { mapEncarOpenHistory } from "../src/server/imports/encar-history";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const write = process.argv.includes("--write");
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Candidate = {
  car_id: string;
  source_id: string;
  open_history: Record<string, unknown> | null;
  payload_source: "staging" | "source_snapshot" | null;
};

async function main() {
  const db = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
  });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const { rows } = await db.query<Candidate>(`
      select c.id as car_id, c.source_id,
        case
          when s.raw_payload ? 'openHistory' then s.raw_payload->'openHistory'
          else snap.payload->'openHistory'
        end as open_history,
        case
          when s.raw_payload ? 'openHistory' then 'staging'
          when snap.payload ? 'openHistory' then 'source_snapshot'
          else null
        end as payload_source
      from public.cars c
      left join lateral (
        select raw_payload
        from public.encar_enrichment_staging e
        where e.source = 'encar' and e.source_listing_id = c.source_id
        order by (e.run_id::text = c.vehicle_specs->>'enrichment_run_id') desc,
                 e.fetched_at desc nulls last
        limit 1
      ) s on true
      left join lateral (
        select payload
        from public.source_snapshots p
        where p.source = 'encar' and p.source_id = c.source_id
        order by p.fetched_at desc nulls last
        limit 1
      ) snap on true
      where c.is_available = true
        and c.primary_source = 'encar'
        and not exists (
          select 1 from public.car_condition_reports r
          where r.car_id = c.id and r.source = 'encar'
            and r.report_type = 'encar_carhistory'
        )
    `);

    const prepared = rows.flatMap((candidate) => {
      const report = candidate.open_history
        ? mapEncarOpenHistory(candidate.open_history)
        : null;
      if (!report) return [];
      return [{
        car_id: candidate.car_id,
        source_id: candidate.source_id,
        payload_source: candidate.payload_source,
        summary: report.summary,
        items: report.items,
        raw_payload: report.raw_payload,
      }];
    });

    const report = {
      readOnly: !write,
      externalEncarRequests: 0,
      databaseWrites: write,
      publishedCarsWithoutHistoryReport: rows.length,
      recoverableFromSavedOpenHistory: prepared.length,
      skippedNoOpenData: rows.length - prepared.length,
      bySavedPayload: Object.fromEntries(
        ["staging", "source_snapshot"].map((source) => [
          source,
          prepared.filter((row) => row.payload_source === source).length,
        ]),
      ),
      examples: prepared.slice(0, 8).map((row) => ({
        sourceId: row.source_id,
        savedPayload: row.payload_source,
        accidents: row.summary.accident_count,
        payoutEvents: row.summary.insurance_payout_count,
        ownVehicleCostKrw: row.summary.my_car_accident_cost,
      })),
      insertedReports: 0,
      updatedCars: 0,
    };

    if (!write) {
      await db.query("rollback");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (prepared.length) {
      const payload = JSON.stringify(prepared);
      const applied = await db.query<{ inserted_reports: number; updated_cars: number }>(`
        with input as (
          select * from jsonb_to_recordset($1::jsonb) as x(
            source_id text, summary jsonb, items jsonb, raw_payload jsonb
          )
        ), inserted as (
          insert into public.car_condition_reports(
            car_id, source, report_type, summary, items, raw_payload
          )
          select c.id, 'encar', 'encar_carhistory', x.summary, x.items, x.raw_payload
          from input x
          join public.cars c on c.source_id = x.source_id
            and c.primary_source = 'encar' and c.is_available = true
          where not exists (
            select 1 from public.car_condition_reports r
            where r.car_id = c.id and r.source = 'encar'
              and r.report_type = 'encar_carhistory'
          )
          on conflict (car_id, source, report_type) do nothing
          returning car_id
        ), updated as (
          update public.cars c
          set accident_count = coalesce(c.accident_count, (x.summary->>'accident_count')::integer),
              insurance_payout_count = coalesce(c.insurance_payout_count,
                (x.summary->>'insurance_payout_count')::integer),
              insurance_payout_total_krw = coalesce(c.insurance_payout_total_krw,
                (x.summary->>'insurance_payout_total_krw')::bigint)
          from inserted i
          join input x on x.source_id = (select source_id from public.cars where id = i.car_id)
          where c.id = i.car_id
          returning c.id
        )
        select (select count(*)::integer from inserted) as inserted_reports,
               (select count(*)::integer from updated) as updated_cars
      `, [payload]);
      report.insertedReports = applied.rows[0]?.inserted_reports ?? 0;
      report.updatedCars = applied.rows[0]?.updated_cars ?? 0;
      if (report.insertedReports !== prepared.length) {
        throw new Error(`Expected ${prepared.length} inserted reports; got ${report.insertedReports}. Transaction rolled back.`);
      }
    }

    await db.query("commit");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
