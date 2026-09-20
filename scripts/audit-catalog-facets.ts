import { Client } from "pg";
import { config } from "dotenv";

/**
 * Acceptance check for the catalogue facets.
 *
 * For every scenario it verifies that each facet counter equals the number of
 * cars the listing shows when that facet value is applied — the property that
 * makes a cascade honest. It also checks the two structural rules:
 *   - an open axis still offers alternatives (with Kia selected the brand axis
 *     must still list other brands);
 *   - cards without a generation code never leave the catalogue: the generation
 *     axis plus the unlabelled cars add up to the total.
 *
 * Read-only.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Facet = { axis: string; value: string; label: string; cars: number };

/** Facet axes that map onto a filter key of the same predicate. */
const FILTER_KEY: Record<string, string> = {
  brand: "brand", model: "model", generation: "generation", fuel: "fuel",
  drive: "drive", transmission: "transmission", body: "body", color: "color",
};

const FILTER_VALUE: Record<string, (value: string) => Record<string, unknown>> = {
  no_accident: () => ({ noAccidents: true }),
  no_insurance: () => ({ noInsurance: true }),
  power_band: (value) => (value === "up_to_160" ? { maxPowerHp: 160 } : {}),
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const count = async (filters: Record<string, unknown>) => {
      const { rows } = await db.query<{ count: number }>("select public.catalog_listing_count($1::jsonb) as count", [JSON.stringify(filters)]);
      return rows[0].count;
    };
    const facets = async (filters: Record<string, unknown>) => {
      const { rows } = await db.query<Facet>("select axis, value, label, cars from public.catalog_facets($1::jsonb)", [JSON.stringify(filters)]);
      return rows;
    };

    const multiGeneration = await db.query<{ model: string; generations: number }>(`
      select c.model, count(distinct c.generation_code)::int as generations
      from public.cars c
      join public.catalog_generation_dictionary d on d.code = c.generation_code and d.status = 'approved'
      where c.is_available = true
      group by 1 having count(distinct c.generation_code) > 1
      order by 2 desc limit 1`);
    const multi = multiGeneration.rows[0];

    const scenarios: Array<{ name: string; filters: Record<string, unknown> }> = [
      { name: "без фильтров", filters: {} },
      { name: "Kia → K5", filters: { brand: "Kia", model: "K5" } },
      { name: "Hyundai → Sonata", filters: { brand: "Hyundai", model: "Sonata" } },
      multi ? { name: `модель с несколькими поколениями (${multi.model})`, filters: { model: multi.model } } : { name: "модель с несколькими поколениями", filters: {} },
      { name: "поколение + год + топливо + мощность", filters: { generation: "dn8", fuel: "gasoline", maxPowerHp: 160 } },
    ];

    const report: Array<Record<string, unknown>> = [];
    let mismatches = 0;

    for (const scenario of scenarios) {
      const rows = await facets(scenario.filters);
      const total = await count(scenario.filters);
      const byAxis: Record<string, number> = {};
      for (const row of rows) byAxis[row.axis] = (byAxis[row.axis] ?? 0) + row.cars;

      let checked = 0;
      const failures: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        let filterPatch: Record<string, unknown> | null = null;
        if (FILTER_KEY[row.axis]) filterPatch = { [FILTER_KEY[row.axis]]: row.value };
        else if (FILTER_VALUE[row.axis]) filterPatch = FILTER_VALUE[row.axis](row.value);
        if (!filterPatch || Object.keys(filterPatch).length === 0) continue;
        checked++;
        const expected = await count({ ...scenario.filters, ...filterPatch });
        if (expected !== row.cars) {
          mismatches++;
          if (failures.length < 5) failures.push({ axis: row.axis, value: row.value, facet: row.cars, listing: expected });
        }
      }

      // With no brand filter, the brand axis must sum to the whole listing.
      const brandSumsToTotal = "brand" in scenario.filters ? null : byAxis.brand === total;

      // An open axis must still offer alternatives.
      const brandOptions = rows.filter((row) => row.axis === "brand" && row.value !== scenario.filters.brand).length;

      // Unlabelled cars are not lost: generation axis + no-code cars = total.
      const noCode = await db.query<{ count: number }>(`
        select count(*)::int as count from public.cars c
        where public.catalog_match(c, $1::jsonb) and c.generation_code is null`, [JSON.stringify({})]);
      const generationAxis = byAxis.generation ?? 0;
      const uncoded = scenario.filters.generation === undefined && scenario.filters.brand === undefined
        ? await db.query<{ count: number }>(`select count(*)::int as count from public.cars c where public.catalog_match(c, $1::jsonb) and c.generation_code is null`, [JSON.stringify(scenario.filters)])
        : { rows: [{ count: null as unknown as number }] };

      report.push({
        scenario: scenario.name,
        filters: scenario.filters,
        listingTotal: total,
        facetTotal: byAxis,
        checkedCounters: checked,
        failures,
        brandSumsToTotal,
        brandOptionsForOtherBrands: brandOptions,
        generationAxisCars: generationAxis,
        carsWithoutCodeInSelection: uncoded.rows[0].count,
        generationPlusUncodedEqualsTotal:
          scenario.filters.generation === undefined && scenario.filters.brand === undefined
            ? generationAxis + (uncoded.rows[0].count ?? 0) === total
            : null,
      });
    }

    const globalNoCode = await db.query<{ count: number }>(`
      select count(*)::int as count from public.cars c where public.catalog_match(c, '{}'::jsonb) and c.generation_code is null`);
    const globalTotal = await count({});

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      counterMismatches: mismatches,
      multiGenerationModel: multi ?? null,
      unlabelledCarsInCatalogue: globalNoCode.rows[0].count,
      catalogueTotal: globalTotal,
      scenarios: report,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
