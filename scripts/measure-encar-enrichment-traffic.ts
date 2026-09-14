import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = process.env.ENCAR_TRAFFIC_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const limit = Math.min(10, Math.max(1, Number(process.env.ENCAR_TRAFFIC_LIMIT ?? 5)));
if (!supabaseUrl || !supabaseKey) throw new Error("TL Auto Supabase admin credentials are required");

// Traffic measurement must reflect the approved VPS/proxy route. Fail closed
// instead of accidentally sending direct requests from a developer machine.
const proxyUrl = process.env.CHESTNY_ENRICHMENT_PROXY_URL?.trim() || process.env.ENCAR_PROXY_URL?.trim();
if (!proxyUrl && process.env.ENCAR_TRAFFIC_ALLOW_DIRECT !== "true") {
  throw new Error("CHESTNY_ENRICHMENT_PROXY_URL or ENCAR_PROXY_URL is required; direct Encar measurement is disabled");
}

const agent = proxyUrl
  ? new ProxyAgent(proxyUrl)
  : undefined;
const base = "https://api.encar.com/v1/readside";

type QueueRow = { source_listing_id: string; candidate_snapshot: { encarId?: string } };

async function request(path: string) {
  const started = performance.now();
  const response = await undiciFetch(`${base}${path}`, {
    headers: ENCAR_HEADERS,
    signal: AbortSignal.timeout(20_000),
    ...(agent ? { dispatcher: agent } : {}),
  });
  const body = await response.arrayBuffer();
  return {
    status: response.status,
    bytes: body.byteLength,
    milliseconds: Math.round(performance.now() - started),
  };
}

async function main() {
  const client = createClient(supabaseUrl!, supabaseKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const run = await client.from("catalog_enrichment_runs").select("candidate_count").eq("id", runId).maybeSingle();
    if (run.error) throw new Error(run.error.message);
    const targetCards = run.data?.candidate_count ?? 3017;
    // A queue built from a moving source can age unevenly. Sample its start,
    // middle and end instead of declaring the entire run stale from one page.
    const offsets = [...new Set([0, Math.max(0, Math.floor(targetCards / 2) - Math.floor(limit / 2)), Math.max(0, targetCards - limit)])];
    const batches = await Promise.all(offsets.map((offset) => client.from("catalog_enrichment_queue")
      .select("source_listing_id,candidate_snapshot").eq("run_id", runId).eq("status", "queued")
      .order("created_at").range(offset, offset + limit - 1)));
    for (const batch of batches) if (batch.error) throw new Error(batch.error.message);
    const rows = [...new Map(batches.flatMap((batch) => (batch.data ?? []) as QueueRow[]).map((row) => [row.source_listing_id, row])).values()];
    if (!rows.length) throw new Error(`No queued cards found for run ${runId}`);
    const requests: Array<{ sourceId: string; endpoint: string; status: number; bytes: number; milliseconds: number }> = [];
    for (const row of rows) {
      const id = row.candidate_snapshot?.encarId;
      if (!id) continue;
      // Match the real worker: only an active detail response unlocks the
      // three auxiliary requests. This avoids overstating proxy traffic when
      // some source listings have already disappeared.
      const detailEndpoint = `/vehicle/${id}`;
      try {
        const result = await request(detailEndpoint);
        requests.push({ sourceId: row.source_listing_id, endpoint: detailEndpoint, ...result });
        if (result.status < 200 || result.status >= 300) continue;
      } catch (error) {
        requests.push({ sourceId: row.source_listing_id, endpoint: detailEndpoint, status: 0, bytes: 0, milliseconds: 0 });
        console.error(`request failed ${row.source_listing_id} ${detailEndpoint}:`, error instanceof Error ? error.message : String(error));
        continue;
      }
      const endpoints = [
        `/inspection/vehicle/${id}`,
        `/inspection/vehicle/${id}/summary`,
        `/vehicles/car/${id}/options/choice`,
      ];
      for (const endpoint of endpoints) {
        try {
          const result = await request(endpoint);
          requests.push({ sourceId: row.source_listing_id, endpoint, ...result });
        } catch (error) {
          requests.push({ sourceId: row.source_listing_id, endpoint, status: 0, bytes: 0, milliseconds: 0 });
          console.error(`request failed ${row.source_listing_id} ${endpoint}:`, error instanceof Error ? error.message : String(error));
        }
      }
    }
    const totalBytes = requests.reduce((sum, item) => sum + item.bytes, 0);
    const cardCount = new Set(requests.map((item) => item.sourceId)).size;
    const activeCards = new Set(requests.filter((item) => item.endpoint.includes("/vehicle/") && item.status >= 200 && item.status < 300).map((item) => item.sourceId)).size;
    const detailBytes = requests.filter((item) => /\/vehicle\/\d+$/.test(item.endpoint)).reduce((sum, item) => sum + item.bytes, 0);
    const auxiliaryBytes = totalBytes - detailBytes;
    const projectedBytes = cardCount
      ? Math.round((detailBytes / cardCount) * targetCards + (activeCards ? auxiliaryBytes / activeCards : 0) * targetCards * (activeCards / cardCount))
      : 0;
    const summary = {
      runId,
      cardsMeasured: cardCount,
      activeCards,
      activeRate: cardCount ? Number((activeCards / cardCount).toFixed(3)) : 0,
      targetCards,
      sampleOffsets: offsets,
      requests: requests.length,
      successfulResponses: requests.filter((item) => item.status >= 200 && item.status < 300).length,
      notFoundResponses: requests.filter((item) => item.status === 404 || item.status === 410).length,
      totalResponseBytes: totalBytes,
      totalResponseMiB: Number((totalBytes / 1024 / 1024).toFixed(3)),
      averageBytesPerCard: cardCount ? Math.round(totalBytes / cardCount) : 0,
      projectedForTargetBytes: projectedBytes,
      projectedForTargetMiB: Number((projectedBytes / 1024 / 1024).toFixed(3)),
      projectedForTargetGiB: Number((projectedBytes / 1024 / 1024 / 1024).toFixed(3)),
      proxyConfigured: Boolean(agent),
      writes: 0,
      note: "Response bodies measured only; Encar photo files were not downloaded and no database rows were changed.",
      byEndpoint: Object.fromEntries([...new Set(requests.map((item) => item.endpoint))].map((endpoint) => [
        endpoint,
        { requests: requests.filter((item) => item.endpoint === endpoint).length, bytes: requests.filter((item) => item.endpoint === endpoint).reduce((sum, item) => sum + item.bytes, 0) },
      ])),
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally { await agent?.close(); }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
