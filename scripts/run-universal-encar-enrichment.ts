import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetch, ProxyAgent } from "undici";
import { open, readFile, rm } from "node:fs/promises";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const proxy = process.env.ENCAR_PROXY_URL?.trim();
const runId = process.env.ENCAR_UNIVERSAL_RUN_ID?.trim();
const delayMs = Math.max(1_000, Number(process.env.ENCAR_UNIVERSAL_DELAY_MS ?? 3_000));
const leaseMinutes = Math.max(5, Math.min(120, Number(process.env.ENCAR_UNIVERSAL_LEASE_MINUTES ?? 15)));
const pollMs = Math.max(1_000, Number(process.env.ENCAR_UNIVERSAL_POLL_MS ?? 10_000));
const dryRun = process.env.ENCAR_UNIVERSAL_DRY_RUN === "true";
const radarPriorityPath = `${process.env.ENCAR_COORDINATION_DIR ?? "/tmp/encar-coordination"}/radar-priority.json`;
const lockPath = process.env.ENCAR_UNIVERSAL_LOCK_PATH?.trim()
  || `/tmp/tl-auto-encar-enrichment-${(runId ?? "unknown").replace(/[^a-zA-Z0-9-]/g, "_")}.lock`;

if (!url || !key || !proxy || !runId) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, service key, ENCAR_PROXY_URL and ENCAR_UNIVERSAL_RUN_ID are required");
}

type Row = {
  id: string;
  source_listing_id: string;
  task: Record<string, boolean>;
  candidate_snapshot: Record<string, unknown>;
};
type Probe = { status: number; body?: unknown; error?: string };

/* Standalone worker intentionally uses untyped Supabase RPCs from migrations. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient<any>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const agent = new ProxyAgent(proxy);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, runId, ...details }));
}

function idOf(row: Row) {
  return String(row.candidate_snapshot.encarId ?? row.candidate_snapshot.encar_id ?? row.source_listing_id);
}

async function radarHasPriority() {
  try {
    const owner = JSON.parse(await readFile(radarPriorityPath, "utf8")) as { pid?: unknown };
    if (!Number.isInteger(owner.pid) || Number(owner.pid) < 1) return false;
    try {
      process.kill(Number(owner.pid), 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function get(endpoint: string): Promise<Probe> {
  let last: Probe | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: ENCAR_HEADERS,
        dispatcher: agent,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { status: response.status, body: await response.json() };
      last = { status: response.status };
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) return last;
    } catch (error) {
      last = { status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (attempt < 2) await sleep(2_000);
  }
  return last ?? { status: 0, error: "request failed without an error" };
}

function classify(probe: Probe) {
  if (probe.status >= 200 && probe.status < 300) return "ready";
  if (/captcha/i.test(probe.error ?? "")) return "captcha";
  if (/timeout|abort/i.test(probe.error ?? "")) return "timeout";
  if (/proxy|socket|fetch failed|econn/i.test(probe.error ?? "")) return "proxy_error";
  if ([403, 429, 503].includes(probe.status)) return "blocked";
  if ([404, 410].includes(probe.status)) return "report_not_found";
  return "http_error";
}

function findValue(value: unknown, keys: string[]): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(key) && (typeof item === "string" || typeof item === "number")) return String(item).trim();
      const found = findValue(item, keys);
      if (found) return found;
    }
  }
  return "";
}

async function claim() {
  const { data, error } = await db.rpc("claim_encar_enrichment_queue_for_run", {
    p_run_id: runId,
    p_lease_minutes: leaseMinutes,
  });
  if (error) throw new Error(error.message);
  return data as Row | null;
}

async function queueCounts() {
  const { data, error } = await db.from("encar_enrichment_queue").select("status").eq("run_id", runId);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

async function complete(row: Row, status: "succeeded" | "unavailable" | "failed", result: Record<string, unknown>, payload: unknown, normalized: Record<string, unknown>, errorMessage: string | null) {
  if (dryRun) return;
  const { error } = await db.rpc("complete_encar_enrichment_queue_item", {
    p_queue_id: row.id,
    p_status: status,
    p_result: result,
    p_raw_payload: payload,
    p_normalized: normalized,
    p_error: errorMessage,
  });
  if (error) throw new Error(error.message);
}

async function processRow(row: Row) {
  const id = idOf(row);
  const task = row.task ?? {};
  const snapshot = row.candidate_snapshot ?? {};
  let vehicleNo = String(snapshot.vehicleNo ?? snapshot.vehicle_no ?? "").trim();
  let manufacturerCd = String(snapshot.manufacturerCd ?? snapshot.manufacturer_cd ?? "").trim();
  let modelCd = String(snapshot.modelCd ?? snapshot.model_cd ?? "").trim();
  const payload: Record<string, unknown> = { encarId: id, fetchedAt: new Date().toISOString() };
  const normalized: Record<string, unknown> = {};
  const probes: Record<string, Probe> = {};

  if (task.insurance) {
    probes.inspection = await get(`https://api.encar.com/v1/readside/inspection/vehicle/${id}`);
    probes.summary = await get(`https://api.encar.com/v1/readside/inspection/vehicle/${id}/summary`);
    payload.inspection = probes.inspection.body ?? null;
    payload.inspectionSummary = probes.summary.body ?? null;
    normalized.reportStatus = classify(probes.inspection);
  }
  if (task.options) {
    probes.options = await get(`https://api.encar.com/v1/readside/vehicles/car/${id}/options/choice`);
    payload.choiceOptions = probes.options.body ?? null;
  }
  if (task.gallery) {
    probes.detail = await get(`https://api.encar.com/v1/readside/vehicle/${id}`);
    payload.detail = probes.detail.body ?? null;
  }
  if (task.diagnosis) {
    probes.diagnosis = await get(`https://api.encar.com/v1/readside/diagnosis/vehicle/${id}`);
    payload.diagnosis = probes.diagnosis.body ?? null;
  }
  if (task.sellingpoint) {
    probes.sellingpoint = await get(`https://api.encar.com/v1/readside/diagnosis/vehicle/${id}/sellingpoint`);
    payload.sellingPoint = probes.sellingpoint.body ?? null;
  }
  if (task.contents) {
    probes.contents = await get(`https://api.encar.com/v1/readside/vehicle/${id}?include=CONTENTS`);
    payload.vehicleContents = probes.contents.body ?? null;
    vehicleNo ||= findValue(probes.contents.body, ["vehicleNo", "vehicle_no"]);
    manufacturerCd ||= findValue(probes.contents.body, ["manufacturerCd", "manufacturer_cd"]);
    modelCd ||= findValue(probes.contents.body, ["modelCd", "model_cd"]);
    normalized.vehicleNo = vehicleNo || null;
    normalized.manufacturerCd = manufacturerCd || null;
    normalized.modelCd = modelCd || null;
  }
  if (task.category && manufacturerCd && modelCd) {
    probes.category = await get(`https://api.encar.com/v1/readside/vehicle/category?manufacturerCd=${encodeURIComponent(manufacturerCd)}&modelCd=${encodeURIComponent(modelCd)}`);
    payload.vehicleCategory = probes.category.body ?? null;
  }
  if (task.history && vehicleNo) {
    probes.history = await get(`https://api.encar.com/v1/readside/record/vehicle/${id}/open?vehicleNo=${encodeURIComponent(vehicleNo)}`);
    payload.openHistory = probes.history.body ?? null;
  }

  const classes = Object.fromEntries(Object.entries(probes).map(([name, probe]) => [name, {
    status: probe.status,
    classification: classify(probe),
    error: probe.error ?? null,
  }]));
  const list = Object.values(probes);
  const hasReady = list.some((probe) => probe.status >= 200 && probe.status < 300);
  const terminal = list.some((probe) => [404, 410].includes(probe.status));
  const technical = list.some((probe) => probe.status === 0 || [403, 429, 503].includes(probe.status));
  const status = terminal && !hasReady ? "unavailable" : technical && !hasReady ? "failed" : "succeeded";
  await complete(row, status, { encarId: id, blocks: task, probes: classes }, payload, { ...normalized, probes: classes }, status === "failed" ? JSON.stringify(classes) : null);
  log("item_completed", { sourceListingId: row.source_listing_id, status, probes: classes });
}

async function main() {
  const lock = await open(lockPath, "wx").catch(() => {
    throw new Error(`Another Encar enrichment worker is already running (${lockPath})`);
  });
  try {
    if (!dryRun) {
      const { data: run, error } = await db.from("encar_enrichment_runs").select("status").eq("id", runId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!run || !["approved", "running"].includes(run.status)) throw new Error(`Run ${runId} is not approved (status=${run?.status ?? "missing"})`);
      const { error: updateError } = await db.from("encar_enrichment_runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "approved");
      if (updateError) throw new Error(updateError.message);
    }

    log("worker_started", { dryRun, leaseMinutes, delayMs, lockPath });
    while (!stopping) {
      if (await radarHasPriority()) {
        log("waiting_for_radar", { pollMs });
        await sleep(pollMs);
        continue;
      }
      const row = await claim();
      if (!row) {
        const counts = await queueCounts();
        const outstanding = (counts.queued ?? 0) + (counts.leased ?? 0);
        if (outstanding === 0) {
          if (!dryRun) {
            const { error } = await db.from("encar_enrichment_runs")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", runId)
              .eq("status", "running");
            if (error) throw new Error(error.message);
          }
          log("run_completed", { counts });
          return;
        }
        log("waiting_for_leases", { counts, pollMs });
        await sleep(pollMs);
        continue;
      }
      try {
        await processRow(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await complete(row, "failed", { encarId: idOf(row), workerError: message }, null, {}, message);
        log("item_failed", { sourceListingId: row.source_listing_id, error: message });
      }
      await sleep(delayMs);
    }
    log("worker_stopped", { reason: "signal" });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    await agent.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
