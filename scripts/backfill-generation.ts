import { Client } from "pg";
import { config } from "dotenv";
import { canonicalModelKey } from "../src/server/catalog/display-model";
import { normalizeBrand } from "../src/server/normalization/vehicles";

/**
 * Backfills `cars.generation` from the source staging row.
 *
 * It never trusts the pairing blindly. A row is written only when:
 *   - the car belongs to `chestny_prigon` — a numeric `source_id` of an Encar
 *     car can coincidentally equal a staging listing id, and that pair would be
 *     meaningless;
 *   - the staging row exists for the same `source_listing_id`;
 *   - brand, model and year agree, compared in canonical form through the very
 *     mapping the writers use, so `1-Series` and `1 Series` are not treated as
 *     different cars.
 *
 * A generation written earlier onto a car from another source is cleared,
 * because such a value could only come from a coincidental identifier match.
 *
 * The report separates the follow-up groups: written, matched without a source
 * value, no staging row at all, refused identity mismatches.
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
  primary_source: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  generation: string | null;
  has_source: boolean;
  source_brand: string | null;
  source_model: string | null;
  source_year: number | null;
  source_generation: string | null;
};

const sameBrand = (left: string | null, right: string | null) => {
  if (!left || !right) return true;
  return (normalizeBrand(left) ?? left).toLowerCase() === (normalizeBrand(right) ?? right).toLowerCase();
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select c.id as car_id, c.source_id, c.primary_source, c.brand, c.model, c.year, c.generation,
             (s.source_listing_id is not null) as has_source,
             s.manufacturer as source_brand, s.model as source_model,
             s.model_year as source_year, s.generation as source_generation
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true`);

    const candidates: Array<{ carId: string; generation: string }> = [];
    const foreignSourceCarIds: string[] = [];
    let matchedNoSource = 0;
    let unmatched = 0;
    let identityMismatch = 0;
    let alreadySet = 0;
    let wrongModel = 0;

    for (const row of rows) {
      const isChestny = row.primary_source === "chestny_prigon";

      // A generation on a car from another source can only be a coincidence.
      if (!isChestny) {
        if (row.generation) foreignSourceCarIds.push(row.car_id);
        unmatched++;
        continue;
      }
      if (!row.has_source) { unmatched++; continue; }
      if (!row.source_generation) { matchedNoSource++; continue; }
      if (row.generation === row.source_generation) { alreadySet++; continue; }
      if (!sameBrand(row.brand, row.source_brand) || canonicalModelKey(row.model) !== canonicalModelKey(row.source_model) ||
        (row.year != null && row.source_year != null && row.year !== row.source_year)) {
        identityMismatch++;
        if (canonicalModelKey(row.model) !== canonicalModelKey(row.source_model)) wrongModel++;
        continue;
      }
      candidates.push({ carId: row.car_id, generation: row.source_generation });
    }

    const distinct = new Map<string, number>();
    for (const candidate of candidates) distinct.set(candidate.generation, (distinct.get(candidate.generation) ?? 0) + 1);

    let written = 0;
    let cleared = 0;
    if (write && (candidates.length || foreignSourceCarIds.length)) {
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
        for (let i = 0; i < foreignSourceCarIds.length; i += 500) {
          const result = await db.query(
            `update public.cars set generation = null, updated_at = now()
              where id = any($1::uuid[]) and generation is not null`,
            [foreignSourceCarIds.slice(i, i + 500)],
          );
          cleared += result.rowCount ?? 0;
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
      unmatchedNoChestnySourceRow: unmatched,
      identityMismatchRefused: identityMismatch,
      identityMismatchByModel: wrongModel,
      foreignSourceGenerationToClear: foreignSourceCarIds.length,
      foreignSourceGenerationCleared: cleared,
      distinctGenerationsToWrite: distinct.size,
      sample: candidates.slice(0, 5).map((candidate) => ({ carId: candidate.carId, generation: candidate.generation })),
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
