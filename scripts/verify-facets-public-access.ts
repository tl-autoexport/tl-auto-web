import { config } from "dotenv";
import { createSupabasePublic } from "../src/server/supabase/public";

/**
 * Verifies that the public (browser) client can use the facet functions and read
 * the dictionary through row level security. The facet route depends on exactly
 * this path, so it is checked before the interface is built.
 */
config({ path: ".env.local", override: true, quiet: true });

async function main() {
  const supabase = createSupabasePublic();
  const filters = { brand: "Kia", model: "K5" };

  const count = await supabase.rpc("catalog_listing_count", { f: filters });
  const facets = await supabase.rpc("catalog_facets", { f: filters });
  const dictionary = await supabase
    .from("catalog_generation_dictionary")
    .select("code, label_ru, status")
    .eq("status", "approved")
    .limit(5);
  const writeAttempt = await supabase
    .from("catalog_generation_dictionary")
    .update({ label_ru: "should not be writable" })
    .eq("code", "dn8")
    .select("code");

  const rows = (facets.data ?? []) as Array<{ axis: string; value: string; cars: number }>;
  const generation = rows.filter((row) => row.axis === "generation");
  const brands = rows.filter((row) => row.axis === "brand");

  console.log(JSON.stringify({
    listingCount: count.data ?? null,
    listingCountError: count.error?.message ?? null,
    facetRows: rows.length,
    facetError: facets.error?.message ?? null,
    generationOptions: generation.map((row) => `${row.value}=${row.cars}`),
    brandOptionsIncludingOtherBrands: brands.length,
    dictionaryReadable: dictionary.error ? `error: ${dictionary.error.message}` : dictionary.data,
    dictionaryWritable: writeAttempt.error ? `blocked: ${writeAttempt.error.message}` : `NOT BLOCKED: ${JSON.stringify(writeAttempt.data)}`,
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
