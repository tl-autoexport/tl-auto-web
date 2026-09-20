import { Client } from "pg";
import { config } from "dotenv";
import { canonicalModelKey } from "../src/server/catalog/display-model";
import { normalizeBrand } from "../src/server/normalization/vehicles";

/**
 * Read-only generation coverage audit — the first deliverable of the cascade
 * plan. It answers, before any backfill:
 *   - how many published cars can be matched to a chestny staging row by
 *     source_listing_id at all;
 *   - whether the matched pair really describes the same car, comparing brand,
 *     model and year in canonical form, because staging and cars spell the same
 *     car differently and must never be assumed identical;
 *   - how many of the matched cars carry a generation value, which distinct
 *     values exist, and which cars would stay without one.
 *
 * The match is restricted to `chestny_prigon`: a numeric `source_id` of an
 * Encar car can coincidentally equal a staging listing id, and such a pair is
 * meaningless.
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type PairRow = {
  primary_source: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  generation: string | null;
  has_staging: boolean;
  staging_brand: string | null;
  staging_model: string | null;
  staging_year: number | null;
  staging_generation: string | null;
};

const sameBrand = (left: string | null, right: string | null) => {
  if (!left || !right) return true;
  return (normalizeBrand(left) ?? left).toLowerCase() === (normalizeBrand(right) ?? right).toLowerCase();
};

const sameModel = (left: string | null, right: string | null) => {
  if (!left || !right) return true;
  return canonicalModelKey(left) === canonicalModelKey(right);
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");

    const { rows } = await db.query<PairRow>(`
      select c.primary_source, c.brand, c.model, c.year, c.generation,
             (s.source_listing_id is not null) as has_staging,
             s.manufacturer as staging_brand, s.model as staging_model,
             s.model_year as staging_year, s.generation as staging_generation
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id = c.source_id
      where c.is_available = true`);

    let matched = 0;
    let matchedWithGeneration = 0;
    let matchedWithoutGeneration = 0;
    let unmatched = 0;
    let brandMismatch = 0;
    let modelMismatch = 0;
    let yearMismatch = 0;
    let withCatalogGeneration = 0;
    let wrongSourceGeneration = 0;
    const bySource: Record<string, { cars: number; matched: number; withGeneration: number }> = {};
    const distinctStaging = new Map<string, number>();
    const distinctCatalog = new Map<string, number>();
    const modelMismatchSample: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const entry = bySource[row.primary_source] ?? { cars: 0, matched: 0, withGeneration: 0 };
      entry.cars++;
      if (row.generation) {
        withCatalogGeneration++;
        distinctCatalog.set(row.generation, (distinctCatalog.get(row.generation) ?? 0) + 1);
      }

      // Only a chestny source row may describe a chestny car.
      const legitimate = row.has_staging && row.primary_source === "chestny_prigon";
      if (!legitimate) {
        if (row.has_staging && row.primary_source !== "chestny_prigon" && row.generation) wrongSourceGeneration++;
        unmatched++;
        bySource[row.primary_source] = entry;
        continue;
      }

      matched++;
      entry.matched++;
      if (row.generation) entry.withGeneration++;
      if (row.staging_generation) {
        matchedWithGeneration++;
        distinctStaging.set(row.staging_generation, (distinctStaging.get(row.staging_generation) ?? 0) + 1);
      } else {
        matchedWithoutGeneration++;
      }
      if (!sameBrand(row.brand, row.staging_brand)) brandMismatch++;
      if (!sameModel(row.model, row.staging_model)) {
        modelMismatch++;
        if (modelMismatchSample.length < 20) {
          modelMismatchSample.push({
            catalogModel: row.model, sourceModel: row.staging_model,
            catalogBrand: row.brand, sourceBrand: row.staging_brand,
            generation: row.staging_generation,
          });
        }
      }
      if (row.year != null && row.staging_year != null && row.year !== row.staging_year) yearMismatch++;
      bySource[row.primary_source] = entry;
    }

    const dictionarySide = await db.query<{ status: string; rows: number; cars: number }>(`
      select status, count(*)::int as rows, coalesce(sum(cars_count), 0)::int as cars
      from public.catalog_generation_dictionary group by 1 order by 2 desc`);

    const codeSide = await db.query<{ with_code: number; without_code: number }>(`
      select count(*) filter (where generation_code is not null)::int as with_code,
             count(*) filter (where generation_code is null)::int as without_code
      from public.cars where is_available = true`);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      dictionary: dictionarySide.rows,
      generationCode: codeSide.rows[0],
      coverage: {
        cars: rows.length,
        matched,
        matchedWithGeneration,
        matchedWithoutGeneration,
        unmatchedNoChestnySourceRow: unmatched,
        brandMismatch,
        modelMismatch,
        yearMismatch,
      },
      catalogSide: {
        withGeneration: withCatalogGeneration,
        withoutGeneration: rows.length - withCatalogGeneration,
        distinctValues: distinctCatalog.size,
      },
      distinctSourceGenerations: distinctStaging.size,
      generationOnForeignSource: wrongSourceGeneration,
      modelMismatchSample,
      bySource,
      topSourceGenerations: [...distinctStaging.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([generation, cars]) => ({ generation, cars })),
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
