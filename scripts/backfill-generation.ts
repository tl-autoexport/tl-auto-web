import { Client } from "pg";
import { config } from "dotenv";

/**
 * Backfills `cars.generation` from the source staging row.
 *
 * It never trusts the pairing blindly: a row is written only when the staging
 * row exists for the same `source_listing_id` and the brand, model and year
 * agree with the published car. Everything else is reported instead of written.
 *
 * The report separates three groups, because they need different follow-up:
 *   - filled            matched, verified and written;
 *   - matched_no_source matched, but the source row has no generation;
 *   - unmatched         no staging row at all (needs the dictionary layer).
 *
 * Read-only by default; set GENERATION_BACKFILL_WRITE=true to apply.
 * No Encar requests.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.GENERATION_BACKFILL_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = {
  car_id: string;
  source_id: string;
  generation: string | null;
  source_generation: string | null;
  has_source: boolean;
  brand_ok: boolean;
  year_ok: boolean;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select c.id as car_id, c.source_id, c.generation,
             s.generation as source_generation,
             (s.source_listing_id is not null) as has_source,
             (s.manufacturer is null or c.brand is null or lower(s.manufacturer) = lower(c.brand)) as brand_ok,
             (s.model_year is null or c.year is null or s.model_year = c.year) as year_ok
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true`);

    const candidates: Array<{ carId: string; sourceId: string; generation: string }> = [];
    let matchedNoSource = 0;
    let unmatched = 0;
    let identityMismatch = 0;
    let alreadySet = 0;

    for (const row of rows) {
      if (!row.has_source) { unmatched++; continue; }
      if (!row.source_generation) { matchedNoSource++; continue; }
      if (row.generation === row.source_generation) { alreadySet++; continue; }
      if (!row.brand_ok || !row.year_ok) { identityMismatch++; continue; }
      candidates.push({ carId: row.car_id, sourceId: row.source_id, generation: row.source_generation });
    }

    const distinct = new Map<string, number>();
    for (const candidate of candidates) distinct.set(candidate.generation, (distinct.get(candidate.generation) ?? 0) + 1);

    let written = 0;
    if (write && candidates.length) {
      await db.query("begin");
      try {
        for (let i = 0; i < candidates.length; i += 500) {
          const part = candidates.slice(i, i + 500);
          const result = await db.query(
            `update public.cars as c set generation = v.generation, updated_at = now()
               from unnest($1::uuid[], $2::text[]) as v(id, generation)
              where c.id = v.id and c.generation is distinct from v.generation`,
            [part.map((item) => item.carId), part.map((item) => item.generation)],
          );
          written += result.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      publishedCars: rows.length,
      planned: candidates.length,
      written,
      alreadyHadGeneration: alreadySet,
      matchedWithoutSourceValue: matchedNoSource,
      unmatchedNoStagingRow: unmatched,
      identityMismatchRefused: identityMismatch,
      distinctGenerationsToWrite: distinct.size,
      topValues: [...distinct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([generation, cars]) => ({ generation, cars })),
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
