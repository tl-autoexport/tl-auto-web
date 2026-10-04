import { config } from "dotenv";
import { Client } from "pg";
import { normalizeEncarTimestamp } from "../src/server/imports/encar-date";
import { fetchDetail } from "../src/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Candidate = {
  id: string;
  primary_source: "encar" | "chestny_prigon";
  source_id: string;
  source_url: string | null;
  snapshot_date: string | null;
};

type DateUpdate = { id: string; publishedAt: string; source: "source_payload" | "source_snapshot" };

const limit = Math.min(2_000, Math.max(1, Number.parseInt(process.env.PUBLICATION_DATE_BACKFILL_LIMIT ?? "500", 10) || 500));
const concurrency = Math.min(3, Math.max(1, Number.parseInt(process.env.PUBLICATION_DATE_BACKFILL_CONCURRENCY ?? "2", 10) || 2));
const write = process.env.PUBLICATION_DATE_BACKFILL_WRITE === "true";
const delayMs = Math.min(2_000, Math.max(0, Number.parseInt(process.env.PUBLICATION_DATE_BACKFILL_DELAY_MS ?? "300", 10) || 0));
const afterId = process.env.PUBLICATION_DATE_BACKFILL_AFTER_ID?.trim() || null;
const maxBatches = Math.min(200, Math.max(1, Number.parseInt(process.env.PUBLICATION_DATE_BACKFILL_MAX_BATCHES ?? "1", 10) || 1));
const stopAfterErrors = Math.min(limit, Math.max(1, Number.parseInt(process.env.PUBLICATION_DATE_BACKFILL_STOP_AFTER_ERRORS ?? "10", 10) || 10));

function encarIdFor(candidate: Candidate): string | null {
  if (candidate.primary_source === "encar") return /^\d+$/.test(candidate.source_id) ? candidate.source_id : null;
  if (!candidate.source_url) return null;
  try {
    const url = new URL(candidate.source_url);
    if (url.hostname !== "encar.com" && !url.hostname.endsWith(".encar.com")) return null;
    const queryId = url.searchParams.get("carid");
    if (queryId && /^\d+$/.test(queryId)) return queryId;
    const pathId = url.pathname.match(/\/cars\/detail\/(\d+)/)?.[1];
    return pathId ?? null;
  } catch {
    return null;
  }
}

function sourceDate(value: string | null | undefined): string | null {
  const normalized = normalizeEncarTimestamp(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000) return null;
  return normalized;
}

async function main() {
  const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
  const proxyUrl = process.env.ENCAR_PROXY_URL?.trim();
  if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required");
  if (!proxyUrl) throw new Error("ENCAR_PROXY_URL is required; direct Encar requests are disabled");

  // Enforce proxy routing regardless of the caller's environment configuration.
  process.env.ENCAR_PROXY_REQUIRED = "true";
  const db = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    let cursorId = afterId;
    let totalCandidates = 0;
    let totalConfirmed = 0;
    let totalWritten = 0;
    let totalErrors = 0;
    let batchCount = 0;
    let stoppedForErrors = false;
    let completed = false;

    for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber += 1) {
      const { rows } = await db.query<Candidate>(
        `select c.id, c.primary_source, c.source_id, c.source_url, null::text as snapshot_date
           from public.cars c
          where c.is_available = true
            and c.primary_source in ('encar', 'chestny_prigon')
            and (c.published_at is null or c.published_at_source is null
                 or c.published_at_source not in ('source_payload', 'source_snapshot'))
            and ($2::uuid is null or c.id > $2::uuid)
          order by c.id asc
          limit $1`,
        [limit, cursorId],
      );

      if (rows.length === 0) {
        completed = true;
        break;
      }

      const candidateIds = rows.map(encarIdFor).filter((id): id is string => id !== null);
      const snapshotBySourceId = new Map<string, string>();
      if (candidateIds.length) {
        const snapshots = await db.query<{ source_listing_id: string; snapshot_date: string }>(
          `select distinct on (s.source_listing_id)
                  s.source_listing_id,
                  s.raw_payload #>> '{detail,manage,firstAdvertisedDateTime}' as snapshot_date
             from public.encar_enrichment_staging s
            where s.source_listing_id = any($1::text[])
              and s.raw_payload #>> '{detail,manage,firstAdvertisedDateTime}' is not null
            order by s.source_listing_id,
                     coalesce(s.fetched_at, s.updated_at, s.created_at) desc`,
          [candidateIds],
        );
        for (const snapshot of snapshots.rows) snapshotBySourceId.set(snapshot.source_listing_id, snapshot.snapshot_date);
      }

      const updates: DateUpdate[] = [];
      const outcomes = { candidates: rows.length, sourceSnapshots: 0, liveSource: 0, noEncarLink: 0, noDate: 0, errors: 0 };
      let cursor = 0;
      const worker = async () => {
        while (cursor < rows.length) {
          const candidate = rows[cursor];
          cursor += 1;
          if (!candidate) continue;

          const encarId = encarIdFor(candidate);
          const snapshotDate = sourceDate(encarId ? snapshotBySourceId.get(encarId) : candidate.snapshot_date);
          if (snapshotDate) {
            updates.push({ id: candidate.id, publishedAt: snapshotDate, source: "source_snapshot" });
            outcomes.sourceSnapshots += 1;
            continue;
          }

          if (!encarId) {
            outcomes.noEncarLink += 1;
            continue;
          }
          try {
            const detail = await fetchDetail(encarId);
            const publishedAt = sourceDate(detail.firstAdvertisedAt);
            if (publishedAt) {
              updates.push({ id: candidate.id, publishedAt, source: "source_payload" });
              outcomes.liveSource += 1;
            } else {
              outcomes.noDate += 1;
            }
          } catch {
            outcomes.errors += 1;
          }
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));

      let written = 0;
      if (write && updates.length) {
        const result = await db.query(
          `update public.cars c
              set published_at = u.published_at,
                  published_at_source = u.provenance
             from unnest($1::uuid[], $2::timestamptz[], $3::text[])
                  as u(id, published_at, provenance)
            where c.id = u.id
              and c.is_available = true
              and (c.published_at is null or c.published_at_source is null
                   or c.published_at_source not in ('source_payload', 'source_snapshot'))`,
          [updates.map((item) => item.id), updates.map((item) => item.publishedAt), updates.map((item) => item.source)],
        );
        written = result.rowCount ?? 0;
      }

      const nextAfterId = rows.length === limit ? rows.at(-1)?.id ?? null : null;
      console.log(JSON.stringify({
        batch: batchNumber,
        dryRun: !write,
        proxyRequired: true,
        limit,
        afterId: cursorId,
        nextAfterId,
        concurrency,
        ...outcomes,
        confirmedDatesFound: updates.length,
        written,
        unresolvedInThisBatch: outcomes.noEncarLink + outcomes.noDate + outcomes.errors,
      }));

      batchCount += 1;
      totalCandidates += rows.length;
      totalConfirmed += updates.length;
      totalWritten += written;
      totalErrors += outcomes.errors;
      cursorId = rows.at(-1)?.id ?? cursorId;

      if (outcomes.errors >= stopAfterErrors) {
        stoppedForErrors = true;
        break;
      }
      if (rows.length < limit) {
        completed = true;
        break;
      }
    }

    console.log(JSON.stringify({
      summary: true,
      dryRun: !write,
      proxyRequired: true,
      maxBatches,
      processedBatches: batchCount,
      totalCandidates,
      totalConfirmedDatesFound: totalConfirmed,
      totalWritten,
      totalErrors,
      lastProcessedId: cursorId,
      completed,
      stoppedForErrors,
      nextAfterId: completed || stoppedForErrors ? null : cursorId,
      note: "Only source-payload or source-snapshot dates are written; restart is safe because confirmed rows are skipped.",
    }, null, 2));
  } finally {
    await db.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
