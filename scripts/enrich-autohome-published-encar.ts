import { Client } from "pg";
import { config } from "dotenv";
import { fetchDetail, fetchEncarHistory, buildEncarHistoryReport } from "../src/server/imports/encar";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.AUTOHOME_ENCAR_ENRICH_WRITE === "true";
const concurrency = Math.min(4, Math.max(1, Number(process.env.AUTOHOME_ENCAR_ENRICH_CONCURRENCY ?? 2)));
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!process.env.ENCAR_PROXY_URL?.trim()) throw new Error("ENCAR_PROXY_URL is required; direct Encar requests are disabled");
process.env.ENCAR_PROXY_REQUIRED = "true";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query(`
      select distinct on (s.source_listing_id)
        s.source_listing_id,s.raw_payload,c.id car_id,c.vehicle_no_masked
      from public.chestny_catalog_staging s
      join public.cars c on c.source_id=s.source_listing_id and c.primary_source='chestny_prigon'
      where s.source_status='active' and s.promotion_status='published'
        and s.raw_payload->'autohome_power_candidate'->>'review_status'='approved'
      order by s.source_listing_id,c.updated_at desc`);
    let cursor = 0;
    const stats = { cards: rows.length, detailsOk: 0, photos: 0, optionSets: 0, historiesAvailable: 0, historiesUnavailable: 0, accidents: 0, insuranceEvents: 0, payoutTotalKrw: 0, deactivated: 0, errors: [] as Array<{ id: string; error: string }> };
    const worker = async () => {
      while (true) {
        const row = rows[cursor++];
        if (!row) return;
        try {
          const detail = await fetchDetail(String(row.source_listing_id));
          stats.detailsOk++;
          stats.photos += detail.photos.length;
          stats.optionSets += detail.standardOptionCodes.length > 0 ? 1 : 0;
          const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
          const detailRaw = ((payload.encar_enrichment as Record<string, unknown> | undefined)?.detail ?? {}) as Record<string, unknown>;
          const vehicleNo = String(row.vehicle_no_masked ?? detail.vehicleNo ?? detailRaw.vehicleNo ?? "").trim();
          let history: Awaited<ReturnType<typeof fetchEncarHistory>> | null = null;
          if (vehicleNo) {
            history = await fetchEncarHistory(
              vehicleNo,
              String(row.source_listing_id),
            );
          }
          if (history?.status === "available") {
            stats.historiesAvailable++;
            const report = buildEncarHistoryReport(history.payload);
            const summary = report.summary as { accident_count: number; insurance_payout_count: number; insurance_payout_total_krw: number };
            stats.accidents += summary.accident_count;
            stats.insuranceEvents += summary.insurance_payout_count;
            stats.payoutTotalKrw += summary.insurance_payout_total_krw;
            if (write) {
              await db.query(`update public.cars set accident_count=$2,insurance_payout_count=$3,insurance_payout_total_krw=$4,vehicle_specs=coalesce(vehicle_specs,'{}'::jsonb)||$5::jsonb,updated_at=now() where id=$1`, [row.car_id, summary.accident_count, summary.insurance_payout_count, summary.insurance_payout_total_krw, JSON.stringify({ encar_options_count: detail.standardOptionCodes.length, encar_full_gallery_count: detail.photos.length })]);
              await db.query(
                `insert into public.car_condition_reports(car_id,source,report_type,summary,items,raw_payload)
                   values($1,'encar','encar_carhistory',$2::jsonb,$3::jsonb,$4::jsonb)
                   on conflict(car_id,source,report_type) do update set
                     summary=excluded.summary,
                     items=excluded.items,
                     raw_payload=excluded.raw_payload`,
                [row.car_id, JSON.stringify(report.summary), JSON.stringify(report.items), JSON.stringify(report.raw_payload)],
              );
            }
          } else stats.historiesUnavailable++;
          if (write) {
            await db.query(`delete from public.car_media where car_id=$1 and source='encar' and media_type='image'`, [row.car_id]);
            for (const [index, photo] of detail.photos.entries()) await db.query(`insert into public.car_media(car_id,source,media_type,category,url,sort_order,is_primary) values($1,'encar','image',$2,$3,$4,$5)`, [row.car_id, photo.category, photo.url, index, index===0]);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const unavailable = /Encar HTTP (404|410)/i.test(message);
          if (write && unavailable) {
            await db.query(
              `update public.cars
                 set is_available=false,
                     sale_status='source_unavailable',
                     encar_check_status='unavailable',
                     encar_check_error=null,
                     last_seen_at=now(),
                     next_encar_check_at=null,
                     updated_at=now()
               where id=$1`,
              [row.car_id],
            );
            await db.query(
              `update public.chestny_catalog_staging
                  set source_status='inactive',
                      promotion_status='source_unavailable',
                      promotion_note='Encar card returned HTTP 404/410 during refresh',
                      updated_at=now()
                where source_listing_id=$1`,
              [row.source_listing_id],
            );
            stats.deactivated++;
          }
          stats.errors.push({ id: String(row.source_listing_id), error: message });
        }
        await sleep(250);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    console.log(JSON.stringify({ dryRun: !write, concurrency, ...stats, encarRequests: stats.detailsOk + stats.historiesAvailable + stats.historiesUnavailable, databaseWrites: write, publicCatalogChanged: write }, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
