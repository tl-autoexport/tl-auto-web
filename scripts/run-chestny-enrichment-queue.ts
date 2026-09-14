import { Client } from "pg";
import { config } from "dotenv";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.CHESTNY_ENRICHMENT_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const batchSize = Math.min(50, Math.max(1, Number(process.env.CHESTNY_ENRICHMENT_BATCH_SIZE ?? 10)));
const delayMs = Math.max(1_000, Number(process.env.CHESTNY_ENRICHMENT_DELAY_MS ?? 2_000));
const leaseMinutes = Math.max(5, Number(process.env.CHESTNY_ENRICHMENT_LEASE_MINUTES ?? 30));
// Network dry-runs are useful for validating the VPS/proxy route, but they
// must never lease rows or change a run status. Writes require an explicit
// opt-in, including when the command is run manually.
const write = process.env.CHESTNY_ENRICHMENT_DRY_RUN === "false";
const proxyUrl = process.env.ENCAR_PROXY_URL?.trim();

if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!proxyUrl && process.env.CHESTNY_ENRICHMENT_ALLOW_DIRECT !== "true") {
  throw new Error("ENCAR_PROXY_URL is required; direct enrichment is disabled");
}

type QueueRow = { id: string; source_listing_id: string; source_url: string; candidate_snapshot: Record<string, unknown> };
type JsonObject = Record<string, unknown>;
class EncarHttpError extends Error {
  constructor(readonly status: number) { super(`Encar HTTP ${status}`); }
}
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): JsonObject => value && typeof value === "object" ? value as JsonObject : {};
const encarId = (row: QueueRow) => text(row.candidate_snapshot.encarId) ?? row.source_url.match(/[?&]carid=(\d+)/i)?.[1] ?? null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url: string, attempts = 3): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await undiciFetch(url, {
        headers: ENCAR_HEADERS,
        signal: AbortSignal.timeout(20_000),
        ...(agent ? { dispatcher: agent } : {}),
      });
      if (response.ok) return response.json();
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      last = new EncarHttpError(response.status);
      if (!retryable) break;
    } catch (error) { last = error; }
    if (attempt < attempts) await sleep(attempt * 2_000);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function claim(client: Client): Promise<QueueRow[]> {
  const result = await client.query<QueueRow>(`
    with candidates as (
      select q.id
        from public.catalog_enrichment_queue q
       where q.run_id = $1
         and q.status in ('queued','leased')
         and (q.status = 'queued' or q.lease_until < now())
       order by q.created_at
       for update skip locked
       limit $2
    )
    update public.catalog_enrichment_queue q
       set status='leased', lease_until=now() + ($3 || ' minutes')::interval,
           last_attempt_at=now(), attempt_count=q.attempt_count+1, updated_at=now()
      from candidates c
     where q.id=c.id
     returning q.id,q.source_listing_id,q.source_url,q.candidate_snapshot
  `, [runId, batchSize, leaseMinutes]);
  return result.rows;
}

async function preview(client: Client): Promise<QueueRow[]> {
  const result = await client.query<QueueRow>(`
    select id,source_listing_id,source_url,candidate_snapshot
      from public.catalog_enrichment_queue
     where run_id=$1 and status='queued'
     order by created_at
     limit $2
  `, [runId, batchSize]);
  return result.rows;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const run = await client.query<{ status: string }>("select status from public.catalog_enrichment_runs where id=$1", [runId]);
    if (write && run.rows[0]?.status !== "approved" && run.rows[0]?.status !== "running") {
      throw new Error(`Run ${runId} is not approved (status=${run.rows[0]?.status ?? "missing"})`);
    }
    if (write) await client.query("update public.catalog_enrichment_runs set status='running', started_at=coalesce(started_at,now()) where id=$1 and status='approved'", [runId]);
    const rows = write ? await claim(client) : await preview(client);
    const results: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const id = encarId(row);
      if (!id) {
        const message = "missing Encar id";
        if (write) await client.query(`update public.catalog_enrichment_queue set status='failed', last_error=$2, lease_until=null, updated_at=now() where id=$1`, [row.id, message]);
        results.push({ sourceId: row.source_listing_id, status: "failed", error: message });
      } else {
        try {
          // Detail is deliberately first: it is the availability gate. Never
          // spend requests on reports/options for a removed Encar listing.
          const detail = await requestJson(`https://api.encar.com/v1/readside/vehicle/${id}`);
          const d = object(detail); const spec = object(d.spec); const category = object(d.category);
          const advertisement = object(d.advertisement);
          const advertisementStatus = text(advertisement.status) ?? text(advertisement.saleStatus);
          if (advertisementStatus && advertisementStatus !== "ADVERTISE") {
            if (write) await client.query(`update public.catalog_enrichment_queue set status='unavailable', result=$2::jsonb, completed_at=now(), lease_until=null, last_error=null, updated_at=now() where id=$1`, [row.id, JSON.stringify({ encarId: id, advertisementStatus })]);
            results.push({ sourceId: row.source_listing_id, status: "unavailable", advertisementStatus });
            continue;
          }
          const [inspection, inspectionSummary, choiceOptions] = await Promise.all([
            requestJson(`https://api.encar.com/v1/readside/inspection/vehicle/${id}`).catch(() => null),
            requestJson(`https://api.encar.com/v1/readside/inspection/vehicle/${id}/summary`).catch(() => null),
            requestJson(`https://api.encar.com/v1/readside/vehicles/car/${id}/options/choice`).catch(() => []),
          ]);
          const photos = Array.isArray(d.photos)
            ? d.photos.flatMap((item) => {
              const path = text(object(item).path);
              return path ? [path.startsWith("http") ? path : `https://ci.encar.com${path}`] : [];
            })
            : [];
          const metadata = { fuel: spec.fuelName ?? null, color: spec.colorName ?? null, seats: spec.seatCount ?? null, category: category.gradeEnglishName ?? null, advertisementStatus };
          const result = { encarId: id, fetchedAt: new Date().toISOString(), detail, inspection, inspectionSummary, choiceOptions, metadata };
          if (write) {
            await client.query(`
              update public.chestny_catalog_staging
                 set raw_payload=coalesce(raw_payload,'{}'::jsonb) || jsonb_build_object('encar_enrichment',$2::jsonb),
                     fuel_type=coalesce(fuel_type,$3), exterior_color=coalesce(exterior_color,$4),
                     image_urls=case when jsonb_array_length(image_urls)=0 and jsonb_array_length($5::jsonb)>0 then $5::jsonb else image_urls end,
                     updated_at=now()
               where source_listing_id=$1
            `, [row.source_listing_id, JSON.stringify(result), text(spec.fuelName), text(spec.colorName), JSON.stringify(photos)]);
            await client.query(`update public.catalog_enrichment_queue set status='succeeded', result=$2::jsonb, completed_at=now(), lease_until=null, last_error=null, updated_at=now() where id=$1`, [row.id, JSON.stringify({ metadata, inspectionAvailable: Boolean(inspection), choiceOptions: Array.isArray(choiceOptions) ? choiceOptions.length : 0, galleryImages: photos.length })]);
          }
          results.push({ sourceId: row.source_listing_id, status: write ? "succeeded" : "dry_run", metadata, inspectionAvailable: Boolean(inspection), galleryImages: photos.length });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const unavailable = error instanceof EncarHttpError && (error.status === 404 || error.status === 410);
          if (write) await client.query(`update public.catalog_enrichment_queue set status=$2, result=case when $2='unavailable' then $3::jsonb else result end, completed_at=case when $2='unavailable' then now() else completed_at end, last_error=case when $2='unavailable' then null else $4 end, lease_until=null, updated_at=now() where id=$1`, [row.id, unavailable ? "unavailable" : "failed", JSON.stringify({ encarId: id, reason: message }), message]);
          results.push({ sourceId: row.source_listing_id, status: unavailable ? "unavailable" : "failed", error: message });
        }
      }
      await sleep(delayMs);
    }
    if (write) {
      const pending = await client.query<{ count: string }>("select count(*)::text as count from public.catalog_enrichment_queue where run_id=$1 and status in ('queued','leased','failed')", [runId]);
      if (pending.rows[0]?.count === "0") await client.query("update public.catalog_enrichment_runs set status='completed', completed_at=now() where id=$1 and status='running'", [runId]);
    }
    console.log(JSON.stringify({ runId, write, batchSize, claimed: rows.length, succeeded: results.filter((x) => x.status === "succeeded").length, unavailable: results.filter((x) => x.status === "unavailable").length, failed: results.filter((x) => x.status === "failed").length, results }, null, 2));
  } finally { await client.end(); await agent?.close(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
