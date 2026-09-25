/**
 * Roll back a transfer batch by the ids recorded in its manifest.
 *
 * The manifest is the only precise handle: `car_options` and `car_media` have no
 * `raw_payload` to carry a batch marker, so a batch can only be undone through the
 * ids the writer captured. This script is that other half of the manifest — without
 * it, a manifest proves nothing.
 *
 * Accepts the current JSONL format (a header line followed by one line per card) and
 * the earlier single-JSON-object format, so pilot batches stay rollback-able.
 *
 * Dry-run by default. ROLLBACK_APPLY=true performs the deletion in one transaction.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFileSync } from "node:fs";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const manifestPath = process.env.ROLLBACK_MANIFEST;
const apply = process.env.ROLLBACK_APPLY === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!manifestPath) throw new Error("ROLLBACK_MANIFEST is required");

type Inserted = { reports?: string[]; options?: string[]; media?: string[] };
type CardDetail = { sourceListingId?: string; carId?: string; status?: string; inserted?: Inserted };

function parseManifest(text: string): { runId: string | null; cards: CardDetail[] } {
  const trimmed = text.trim();
  const lines = trimmed.split("\n").filter((line) => line.trim());
  // JSONL: a header line followed by one card per line.
  if (lines.length > 1) {
    try {
      const head = JSON.parse(lines[0]) as { kind?: string; runId?: string };
      if (head?.kind === "header") {
        return { runId: head.runId ?? null, cards: lines.slice(1).map((line) => JSON.parse(line) as CardDetail) };
      }
    } catch {
      // Not JSONL: fall through to the single-object form (a pretty-printed file
      // starts with a lone "{" line, which is not valid JSON on its own).
    }
  }
  const whole = JSON.parse(trimmed) as { runId?: string; cards?: CardDetail[] } | CardDetail[];
  if (Array.isArray(whole)) return { runId: null, cards: whole };
  return { runId: whole.runId ?? null, cards: Array.isArray(whole.cards) ? whole.cards : [] };
}

async function main() {
  const { runId, cards } = parseManifest(readFileSync(manifestPath!, "utf8"));
  const reports: string[] = []; const options: string[] = []; const media: string[] = [];
  for (const card of cards) {
    reports.push(...(card.inserted?.reports ?? []));
    options.push(...(card.inserted?.options ?? []));
    media.push(...(card.inserted?.media ?? []));
  }
  const listingIds = [...new Set(cards.map((card) => card.sourceListingId).filter((value): value is string => Boolean(value)))];
  const summary = { apply, manifestPath, runId, cards: cards.length, listings: listingIds.length, reports: reports.length, options: options.length, media: media.length };
  if (!apply) { console.log(JSON.stringify({ ...summary, note: "dry-run; set ROLLBACK_APPLY=true to delete these ids" }, null, 2)); return; }

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const deletedReports = reports.length ? await db.query(`delete from public.car_condition_reports where id = any($1::uuid[])`, [reports]) : { rowCount: 0 };
    const deletedOptions = options.length ? await db.query(`delete from public.car_options where id = any($1::uuid[])`, [options]) : { rowCount: 0 };
    const deletedMedia = media.length ? await db.query(`delete from public.car_media where id = any($1::uuid[])`, [media]) : { rowCount: 0 };
    // The Encar staging mark must follow the data: a rolled-back transfer is not applied.
    const reset = runId && listingIds.length
      ? await db.query(`update public.encar_enrichment_staging set applied_at = null where run_id = $1 and source_listing_id = any($2)`, [runId, listingIds])
      : { rowCount: 0 };
    await db.query("commit");
    console.log(JSON.stringify({ ...summary, deleted: { reports: deletedReports.rowCount, options: deletedOptions.rowCount, media: deletedMedia.rowCount, appliedAtReset: reset.rowCount } }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
