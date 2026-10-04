import { config } from "dotenv";
import { appendFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { fetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Candidate = {
  id: string;
  primary_source: string;
  source_id: string;
  source_url: string | null;
};

type AuditStatus =
  | "available_with_date"
  | "available_without_date"
  | "not_found_confirmed"
  | "not_found_once"
  | "forbidden"
  | "proxy_auth_error"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "invalid_source_id";

type AuditResult = {
  carId: string;
  source: string;
  encarId: string | null;
  status: AuditStatus;
  httpStatuses: number[];
  hasPublicationDate?: boolean;
  publicationDate?: string | null;
  error?: string;
};

const proxyUrl = process.env.ENCAR_PROXY_URL?.trim();
const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
const delayMs = Math.min(5_000, Math.max(250, Number.parseInt(process.env.PUBLICATION_DATE_AUDIT_DELAY_MS ?? "500", 10) || 500));
const outputPath = process.env.PUBLICATION_DATE_AUDIT_OUTPUT?.trim() || `/home/ubuntu/publication-date-audit-${new Date().toISOString().replaceAll(":", "-")}.jsonl`;

function encarIdFor(candidate: Candidate): string | null {
  if (candidate.primary_source === "encar") {
    return /^\d+$/.test(candidate.source_id) ? candidate.source_id : null;
  }
  if (!candidate.source_url) return null;
  try {
    const url = new URL(candidate.source_url);
    if (url.hostname !== "encar.com" && !url.hostname.endsWith(".encar.com")) return null;
    const queryId = url.searchParams.get("carid");
    if (queryId && /^\d+$/.test(queryId)) return queryId;
    return url.pathname.match(/\/cars\/detail\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Do not write proxy credentials or query strings into the audit report.
  return message.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@").slice(0, 240);
}

async function checkOne(agent: ProxyAgent, candidate: Candidate): Promise<AuditResult> {
  const encarId = encarIdFor(candidate);
  if (!encarId) {
    return { carId: candidate.id, source: candidate.primary_source, encarId: null, status: "invalid_source_id", httpStatuses: [] };
  }

  const httpStatuses: number[] = [];
  let networkError: string | undefined;
  // Two independent checks for 404s reduce the chance of treating a transient edge response as removal.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${encarId}`, {
        headers: ENCAR_HEADERS,
        dispatcher: agent,
        signal: AbortSignal.timeout(20_000),
      });
      httpStatuses.push(response.status);
      const text = await response.text();

      if (response.status === 404) continue;
      if (response.status === 401 || response.status === 403) {
        return { carId: candidate.id, source: candidate.primary_source, encarId, status: "forbidden", httpStatuses };
      }
      if (response.status === 407) {
        return { carId: candidate.id, source: candidate.primary_source, encarId, status: "proxy_auth_error", httpStatuses };
      }
      if (response.status === 429) {
        return { carId: candidate.id, source: candidate.primary_source, encarId, status: "rate_limited", httpStatuses };
      }
      if (!response.ok) {
        return { carId: candidate.id, source: candidate.primary_source, encarId, status: "upstream_error", httpStatuses };
      }

      try {
        const payload = JSON.parse(text) as { manage?: { firstAdvertisedDateTime?: unknown } };
        const value = payload.manage?.firstAdvertisedDateTime;
        const publicationDate = typeof value === "string" ? value : null;
        return {
          carId: candidate.id,
          source: candidate.primary_source,
          encarId,
          status: publicationDate ? "available_with_date" : "available_without_date",
          httpStatuses,
          hasPublicationDate: Boolean(publicationDate),
          publicationDate,
        };
      } catch {
        return { carId: candidate.id, source: candidate.primary_source, encarId, status: "upstream_error", httpStatuses, error: "HTTP 200 response was not valid JSON" };
      }
    } catch (error) {
      networkError = errorText(error);
    }
  }

  if (httpStatuses.length === 2 && httpStatuses.every((status) => status === 404)) {
    return { carId: candidate.id, source: candidate.primary_source, encarId, status: "not_found_confirmed", httpStatuses };
  }
  if (httpStatuses.includes(404)) {
    return { carId: candidate.id, source: candidate.primary_source, encarId, status: "not_found_once", httpStatuses, ...(networkError ? { error: networkError } : {}) };
  }
  return { carId: candidate.id, source: candidate.primary_source, encarId, status: "network_error", httpStatuses, ...(networkError ? { error: networkError } : {}) };
}

async function main() {
  if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required");
  if (!proxyUrl) throw new Error("ENCAR_PROXY_URL is required; direct Encar requests are disabled");

  const db = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  const agent = new ProxyAgent(proxyUrl);
  try {
    await db.connect();
    const { rows } = await db.query<Candidate>(
      `select c.id, c.primary_source::text as primary_source, c.source_id, c.source_url
         from public.cars c
        where c.is_available = true
          and c.primary_source::text = any($1::text[])
          and (c.published_at is null or c.published_at_source is null
               or not (c.published_at_source::text = any($2::text[])))
        order by c.id asc`,
      [["encar", "chestny_prigon"], ["source_payload", "source_snapshot"]],
    );

    await writeFile(outputPath, "", { mode: 0o600 });
    const counts = new Map<AuditStatus, number>();
    console.log(JSON.stringify({ event: "audit_started", readOnly: true, proxyRequired: true, candidates: rows.length, outputPath }));

    for (let index = 0; index < rows.length; index += 1) {
      const candidate = rows[index];
      if (!candidate) continue;
      const result = await checkOne(agent, candidate);
      counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
      await appendFile(outputPath, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      console.log(JSON.stringify({ event: "audit_item", progress: `${index + 1}/${rows.length}`, status: result.status, httpStatuses: result.httpStatuses }));
      if (index + 1 < rows.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(JSON.stringify({
      event: "audit_complete",
      readOnly: true,
      candidates: rows.length,
      counts: Object.fromEntries(counts),
      report: outputPath,
      interpretation: "Repeated HTTP 404 means unavailable/not found at audit time; it does not by itself prove permanent deletion.",
    }, null, 2));
  } finally {
    await db.end().catch(() => undefined);
    await agent.close();
  }
}

void main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
