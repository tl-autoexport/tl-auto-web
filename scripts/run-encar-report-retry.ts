import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const runId = process.env.ENCAR_REPORT_RETRY_RUN_ID?.trim();
const limit = Math.min(50, Math.max(1, Number(process.env.ENCAR_REPORT_RETRY_BATCH_SIZE ?? 50)));
const delayMs = Math.max(1_000, Number(process.env.ENCAR_REPORT_RETRY_DELAY_MS ?? 3_000));
const leaseMinutes = Math.max(5, Number(process.env.ENCAR_REPORT_RETRY_LEASE_MINUTES ?? 30));
const write = process.env.ENCAR_REPORT_RETRY_DRY_RUN !== "true";
const proxyUrl = process.env.ENCAR_REPORT_RETRY_PROXY_URL?.trim() || process.env.ENCAR_PROXY_URL?.trim();

if (!url || !key || !runId) throw new Error("NEXT_PUBLIC_SUPABASE_URL, Supabase service key and ENCAR_REPORT_RETRY_RUN_ID are required");
if (!proxyUrl && process.env.ENCAR_REPORT_RETRY_ALLOW_DIRECT !== "true") throw new Error("Proxy is required; direct Encar requests are disabled");

type Row = { id: string; source_listing_id: string; source_url: string; candidate_snapshot: Record<string, unknown> };
/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase client generic is required for the untyped retry queue helpers */
type Db = ReturnType<typeof createClient<any>>;
type Classification = "ready" | "report_not_found" | "timeout" | "http_error" | "captcha" | "blocked" | "proxy_error";
type Probe = { ok: boolean; status?: number; body?: unknown; error?: string };
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;

function encarId(row: Row) {
  const snapshot = row.candidate_snapshot;
  return text(snapshot.encarId) || row.source_url.match(/[?&]carid=(\d+)/i)?.[1] || row.source_listing_id;
}

function classify(probe: Probe): Classification {
  if (probe.ok) return "ready";
  if (probe.error && /captcha/i.test(probe.error)) return "captcha";
  if (probe.error && /proxy|socket|econn|eai_again|fetch failed/i.test(probe.error)) return "proxy_error";
  if (probe.error && /timeout|abort|timed out/i.test(probe.error)) return "timeout";
  if (probe.status === 401 || probe.status === 403) return "blocked";
  if (probe.status === 404 || probe.status === 410) return "report_not_found";
  if (probe.status === 429 || probe.status === 503) return "blocked";
  if (probe.status && probe.status >= 400) return "http_error";
  return "http_error";
}

async function probe(endpoint: string): Promise<Probe> {
  try {
    const response = await undiciFetch(endpoint, { headers: ENCAR_HEADERS, signal: AbortSignal.timeout(20_000), ...(agent ? { dispatcher: agent } : {}) });
    if (response.status === 403 && (response.headers.get("content-type") || "").includes("text/html")) return { ok: false, status: response.status, error: "captcha_or_block_page" };
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status, body: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function claim(db: Db) {
  const { data, error } = await db.rpc("claim_next_encar_enrichment_queue", { p_limit: limit, p_lease_minutes: leaseMinutes });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function complete(db: Db, row: Row, status: "succeeded" | "unavailable" | "failed", result: Record<string, unknown>, raw: unknown, normalized: Record<string, unknown>, error: string | null) {
  const { error: rpcError } = await db.rpc("complete_encar_enrichment_queue_item", {
    p_queue_id: row.id, p_status: status, p_result: result, p_raw_payload: raw, p_normalized: normalized, p_error: error,
  });
  if (rpcError) throw new Error(rpcError.message);
}

async function main() {
  const db = createClient<any>(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = write ? await claim(db) : (await db.from("encar_enrichment_queue").select("id,source_listing_id,source_url,candidate_snapshot").eq("run_id", runId).eq("status", "queued").order("created_at").limit(limit)).data as Row[];
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = encarId(row);
    const [inspection, summary] = await Promise.all([
      probe(`https://api.encar.com/v1/readside/inspection/vehicle/${id}`),
      probe(`https://api.encar.com/v1/readside/inspection/vehicle/${id}/summary`),
    ]);
    const inspectionClass = classify(inspection);
    const summaryClass = classify(summary);
    const classification: Classification = inspectionClass === "ready" ? "ready" : inspectionClass;
    const terminalUnavailable = classification === "report_not_found";
    const result = { encarId: id, classification, inspection: { status: inspection.status ?? null, error: inspection.error ?? null }, summary: { status: summary.status ?? null, error: summary.error ?? null } };
    const raw = { encarId: id, fetchedAt: new Date().toISOString(), inspection: inspection.body ?? null, summary: summary.body ?? null };
    const normalized = { reportStatus: classification, inspectionAvailable: inspection.ok, summaryAvailable: summary.ok, inspectionClassification: inspectionClass, summaryClassification: summaryClass };
    if (write) await complete(db, row, terminalUnavailable ? "unavailable" : inspection.ok || summary.ok ? "succeeded" : "failed", result, raw, normalized, classification === "ready" || terminalUnavailable ? null : classification);
    results.push({ sourceListingId: row.source_listing_id, status: write ? "processed" : "dry_run", ...normalized });
    await sleep(delayMs);
  }
  console.log(JSON.stringify({ runId, write, requested: rows.length, processed: results.length, byClassification: Object.fromEntries([...new Set(results.map((r) => String(r.reportStatus)))].map((s) => [s, results.filter((r) => r.reportStatus === s).length])), results: rows.length <= 10 ? results : undefined }, null, 2));
  await agent?.close();
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
