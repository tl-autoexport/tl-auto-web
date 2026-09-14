import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = process.env.CHESTNY_ENRICHMENT_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const batchSize = Math.min(50, Math.max(1, Number(process.env.CHESTNY_ENRICHMENT_BATCH_SIZE ?? 10)));
const previewOffset = Math.max(0, Number(process.env.CHESTNY_ENRICHMENT_PREVIEW_OFFSET ?? 0));
const delayMs = Math.max(1_000, Number(process.env.CHESTNY_ENRICHMENT_DELAY_MS ?? 2_000));
const leaseMinutes = Math.max(5, Number(process.env.CHESTNY_ENRICHMENT_LEASE_MINUTES ?? 30));
const write = process.env.CHESTNY_ENRICHMENT_DRY_RUN === "false";
// Keep the high-priority Radar route isolated. When configured, enrichment
// uses its own proxy; legacy ENCAR_PROXY_URL remains a backward-compatible
// fallback for the controlled manual waves already in progress.
const proxyUrl = process.env.CHESTNY_ENRICHMENT_PROXY_URL?.trim() || process.env.ENCAR_PROXY_URL?.trim();

if (!supabaseUrl || !supabaseKey) throw new Error("TL Auto Supabase admin credentials are required");
if (!proxyUrl && process.env.CHESTNY_ENRICHMENT_ALLOW_DIRECT !== "true") throw new Error("CHESTNY_ENRICHMENT_PROXY_URL or ENCAR_PROXY_URL is required; direct enrichment is disabled");

type QueueRow = { id: string; source_listing_id: string; source_url: string; candidate_snapshot: Record<string, unknown> };
type JsonObject = Record<string, unknown>;
// Supabase RPC signatures are generated from schema types in the app layer;
// this standalone VPS worker intentionally calls two newly migrated RPCs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseClient = ReturnType<typeof createClient<any>>;
class EncarHttpError extends Error { constructor(readonly status: number) { super(`Encar HTTP ${status}`); } }
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): JsonObject => value && typeof value === "object" ? value as JsonObject : {};
const encarId = (row: QueueRow) => text(row.candidate_snapshot.encarId) ?? row.source_url.match(/[?&]carid=(\d+)/i)?.[1] ?? null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url: string, attempts = 3): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await undiciFetch(url, { headers: ENCAR_HEADERS, signal: AbortSignal.timeout(20_000), ...(agent ? { dispatcher: agent } : {}) });
      if (response.ok) return response.json();
      last = new EncarHttpError(response.status);
      if (response.status !== 408 && response.status !== 429 && response.status < 500) break;
    } catch (error) { last = error; }
    if (attempt < attempts) await sleep(attempt * 2_000);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient<any>(supabaseUrl!, supabaseKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: run, error: runError } = await db.from("catalog_enrichment_runs").select("status").eq("id", runId).maybeSingle();
    if (runError) throw new Error(runError.message);
    if (write && run?.status !== "approved" && run?.status !== "running") throw new Error(`Run ${runId} is not approved (status=${run?.status ?? "missing"})`);
    if (write) {
      const { error } = await db.from("catalog_enrichment_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", runId).eq("status", "approved");
      if (error) throw new Error(error.message);
    }
    const rows = write ? await claim(db) : await preview(db);
    const results: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const id = encarId(row);
      try {
        if (!id) throw new Error("missing Encar id");
        // Availability gate: only active detail responses unlock auxiliary calls.
        const detail = await requestJson(`https://api.encar.com/v1/readside/vehicle/${id}`);
        const source = object(detail); const spec = object(source.spec); const category = object(source.category); const advertisement = object(source.advertisement);
        const advertisementStatus = text(advertisement.status) ?? text(advertisement.saleStatus);
        if (advertisementStatus && advertisementStatus !== "ADVERTISE") {
          if (write) await complete(db, row.id, "unavailable", { encarId: id, advertisementStatus });
          results.push({ sourceId: row.source_listing_id, status: "unavailable", advertisementStatus });
          continue;
        }
        const [inspection, inspectionSummary, choiceOptions] = await Promise.all([
          requestJson(`https://api.encar.com/v1/readside/inspection/vehicle/${id}`).catch(() => null),
          requestJson(`https://api.encar.com/v1/readside/inspection/vehicle/${id}/summary`).catch(() => null),
          requestJson(`https://api.encar.com/v1/readside/vehicles/car/${id}/options/choice`).catch(() => []),
        ]);
        const photos = Array.isArray(source.photos) ? source.photos.flatMap((item) => {
          const path = text(object(item).path); return path ? [path.startsWith("http") ? path : `https://ci.encar.com${path}`] : [];
        }) : [];
        const metadata = { fuel: spec.fuelName ?? null, color: spec.colorName ?? null, seats: spec.seatCount ?? null, category: category.gradeEnglishName ?? null, advertisementStatus };
        const payload = { encarId: id, fetchedAt: new Date().toISOString(), detail, inspection, inspectionSummary, choiceOptions, metadata };
        if (write) await complete(db, row.id, "succeeded", { metadata, inspectionAvailable: Boolean(inspection), choiceOptions: Array.isArray(choiceOptions) ? choiceOptions.length : 0, galleryImages: photos.length, payload }, text(spec.fuelName), text(spec.colorName), photos);
        results.push({ sourceId: row.source_listing_id, status: write ? "succeeded" : "dry_run", metadata, inspectionAvailable: Boolean(inspection), galleryImages: photos.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const unavailable = error instanceof EncarHttpError && (error.status === 404 || error.status === 410);
        if (write) await complete(db, row.id, unavailable ? "unavailable" : "failed", { encarId: id, reason: message }, null, null, [], unavailable ? null : message);
        results.push({ sourceId: row.source_listing_id, status: unavailable ? "unavailable" : "failed", error: message });
      }
      await sleep(delayMs);
    }
    if (write) {
      const { count, error } = await db.from("catalog_enrichment_queue").select("id", { count: "exact", head: true }).eq("run_id", runId).in("status", ["queued", "leased", "failed"]);
      if (error) throw new Error(error.message);
      if (count === 0) await db.from("catalog_enrichment_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId).eq("status", "running");
    }
    console.log(JSON.stringify({ runId, write, batchSize, previewOffset: write ? undefined : previewOffset, claimed: rows.length, succeeded: results.filter((x) => x.status === "succeeded").length, unavailable: results.filter((x) => x.status === "unavailable").length, failed: results.filter((x) => x.status === "failed").length, results }, null, 2));
  } finally { await agent?.close(); }
}

async function claim(db: DatabaseClient) {
  const { data, error } = await db.rpc("claim_catalog_enrichment_queue", { p_run_id: runId, p_limit: batchSize, p_lease_minutes: leaseMinutes });
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

async function preview(db: DatabaseClient) {
  const { data, error } = await db.from("catalog_enrichment_queue").select("id,source_listing_id,source_url,candidate_snapshot").eq("run_id", runId).eq("status", "queued").order("created_at").range(previewOffset, previewOffset + batchSize - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

async function complete(db: DatabaseClient, queueId: string, status: "succeeded" | "unavailable" | "failed", result: Record<string, unknown>, fuel: string | null = null, color: string | null = null, imageUrls: string[] = [], error: string | null = null) {
  const { error: rpcError } = await db.rpc("complete_catalog_enrichment_queue_item", { p_queue_id: queueId, p_status: status, p_result: result, p_fuel: fuel, p_color: color, p_image_urls: imageUrls, p_error: error });
  if (rpcError) throw new Error(rpcError.message);
}

main().catch((error) => { console.error(error); process.exit(1); });
