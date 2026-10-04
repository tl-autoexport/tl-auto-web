import assert from "node:assert/strict";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");

const visible = `is_available = true
  and primary_source in ('encar','chestny_prigon')
  and fuel_type in ('gasoline','diesel','hybrid','electric','lpg')
  and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null))`;

type Plan = { "Index Name"?: string; "Actual Rows"?: number; Plans?: Plan[] };
type Explained = { Plan: Plan; "Execution Time": number };
type Summary = { generationLabels: Record<string, string>; presetCounts: Record<string, number> };
type Facet = { axis: string; value: string; label: string; cars: number };

function indexNames(plan: Plan): string[] {
  return [
    ...(plan["Index Name"] ? [plan["Index Name"]] : []),
    ...(plan.Plans ?? []).flatMap(indexNames),
  ];
}

async function main() {
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  await db.connect();
  try {
    await db.query("begin isolation level repeatable read read only");
    await db.query("set local statement_timeout = '20s'");
    const snapshot = (await db.query(`select count(*)::int as cars,
      md5(string_agg(id::text, ',' order by id)) as ids_hash
      from public.catalog_display_cars where ${visible}`)).rows[0];
    const expectedHash = process.argv.find((arg) => arg.startsWith("--expected-ids-hash="))?.split("=")[1];
    if (expectedHash) assert.equal(snapshot.ids_hash, expectedHash, "visible catalogue IDs changed");

    const indexes = (await db.query<{ name: string; valid: boolean }>(`
      select c.relname as name, i.indisvalid and i.indisready as valid
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relnamespace = 'public'::regnamespace
        and (c.relname like 'cars_public_catalog_v4_%' or c.relname = 'catalog_vehicle_names_summary_idx')
    `)).rows;
    assert.equal(indexes.length, 10);
    assert.ok(indexes.every((index) => index.valid), "all concurrent indexes must be valid and ready");

    const explain = async (name: string, sql: string) => {
      const data = await db.query<{ "QUERY PLAN": Explained[] }>(`explain (analyze, buffers, format json) ${sql}`);
      const plan = data.rows[0]["QUERY PLAN"][0];
      const used = indexNames(plan.Plan);
      assert.ok(used.some((index) => index.startsWith("cars_public_catalog_v4_")), `${name} did not use a matching public catalogue index`);
      return { name, sqlMs: plan["Execution Time"], rows: plan.Plan["Actual Rows"], indexes: used };
    };
    const report: Awaited<ReturnType<typeof explain>>[] = [];
    for (const [name, extra, order] of [
      ["fresh", "", "source_updated_at desc nulls last, id"],
      ["under160", "and power_hp <= 160", "source_updated_at desc nulls last, id"],
      ["bodyDrive", "and body_type in ('Кроссовер','SUV') and drive_type in ('4WD','AWD','4륜','4륜구동','사륜','사륜구동')", "source_updated_at desc nulls last, id"],
      ["priceAsc", "", "price_rub asc nulls last, id"],
      ["priceDesc", "", "price_rub desc nulls last, id"],
      ["mileage", "", "mileage_km asc nulls last, id"],
      ["year", "", "year desc nulls last, id"],
    ]) {
      report.push(await explain(name, `select id, brand, model, trim, generation_label, modification_label,
        source_updated_at, primary_image_url from public.catalog_display_cars
        where ${visible} ${extra} order by ${order} limit 25`));
    }
    report.push(await explain("count", `select count(*) from public.catalog_display_cars where ${visible}`));

    const started = performance.now();
    const summary = (await db.query<{ data: Summary }>("select public.catalog_display_summary() as data")).rows[0].data;
    const summaryMs = Math.round(performance.now() - started);
    const facets = (await db.query<Facet>("select * from public.catalog_display_facets('{}'::jsonb)")).rows;
    const pick = (axis: string, value: string) => facets.find((row) => row.axis === axis && row.value === value)?.cars ?? 0;
    assert.deepEqual(summary, {
      generationLabels: Object.fromEntries(facets.filter((row) => row.axis === "generation" && row.value && row.label)
        .map((row) => [row.value, row.label])),
      presetCounts: {
        under160: pick("power_band", "up_to_160"), electric: pick("fuel", "electric"),
        fourWheelDrive: pick("drive", "4WD"), noAccident: pick("no_accident", "confirmed"),
        noInsurance: pick("no_insurance", "confirmed"),
      },
    }, "compact summary must equal the existing facet contract");

    await db.query("set local role anon");
    report.push(await explain("publicFresh", `select id, brand, model from public.catalog_display_cars
      where ${visible} order by source_updated_at desc nulls last, id limit 25`));
    const publicSummary = (await db.query<{ data: Summary }>("select public.catalog_display_summary() as data")).rows[0].data;
    assert.deepEqual(publicSummary, summary, "public role must receive the same safe aggregate");
    await db.query("rollback");
    console.log(JSON.stringify({ readOnly: true, snapshot, indexes, queries: report, summaryMs,
      generationLabels: Object.keys(summary.generationLabels).length, presetCounts: summary.presetCounts,
      summaryMatchesExistingFacets: true, publicAccessVerified: true }, null, 2));
  } finally {
    await db.query("rollback").catch(() => undefined);
    await db.end();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
