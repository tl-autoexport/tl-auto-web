import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";
import { catalogBrandValues } from "../src/lib/catalog-brand";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const visible = `is_available = true
  and primary_source in ('encar','chestny_prigon')
  and fuel_type in ('gasoline','diesel','hybrid','electric','lpg')
  and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null))`;
const displayFields = "id,brand,model,trim,generation,generation_code,generation_label,modification_label,version_line,compact_version,naming_rules_version,catalog_sort_published_at";
type Plan = { "Index Name"?: string; "Actual Rows"?: number; "Rows Removed by Filter"?: number; "Shared Hit Blocks"?: number; Plans?: Plan[] };
type Explained = { Plan: Plan; "Execution Time": number };
function indexes(plan: Plan): string[] {
  return [...(plan["Index Name"] ? [plan["Index Name"]] : []), ...(plan.Plans ?? []).flatMap(indexes)];
}

async function main() {
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  await db.connect();
  try {
    // Only the temporary candidate view is changed. Roll back every check.
    await db.query("begin isolation level repeatable read");
    await db.query("set local statement_timeout = '15s'");
    const migration = await readFile("supabase/migrations/20261006_catalog_indexable_display.sql", "utf8");
    await db.query(migration.split("grant select on public.catalog_display_cascade_cars")[0]
      .replace("create or replace view public.catalog_display_cascade_cars", "create or replace temp view candidate_catalog_display_cars"));
    await db.query("grant select on candidate_catalog_display_cars to anon");
    const differences = (await db.query(`with old as (select ${displayFields} from public.catalog_display_cars where ${visible}),
      candidate as (select ${displayFields} from candidate_catalog_display_cars where ${visible})
      select count(*)::int differences from ((select * from old except all select * from candidate)
        union all (select * from candidate except all select * from old)) d`)).rows[0].differences;
    assert.equal(differences, 0, "the optimized view must preserve every public display row and date");

    const definition = (await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.catalog_display_facet_options(jsonb,text[])'::regprocedure) as definition",
    )).rows[0].definition;
    const predicate = definition.split("$predicate$")[1];
    assert.ok(predicate, "expected deployed scalar facet predicate");
    const report: object[] = [];
    const explain = async (sql: string, filters?: object) => {
      const plan = (await db.query<{ "QUERY PLAN": Explained[] }>(
        `explain (analyze,buffers,format json) ${sql}`, filters ? [JSON.stringify(filters)] : [],
      )).rows[0]["QUERY PLAN"][0];
      return { ms: plan["Execution Time"], blocks: plan.Plan["Shared Hit Blocks"], indexes: indexes(plan.Plan) };
    };
    const identities = (await db.query<{ brand: string; model: string; generation_code: string }>(
      `select distinct on (brand) brand,model,generation_code from public.catalog_display_cars where ${visible}
        and ((brand='Volvo' and model='S90') or brand in ('KGM','BMW','Hyundai','Kia'))
        and generation_code is not null group by 1,2,3 order by brand,count(*) desc`,
    )).rows;
    assert.ok(identities.some(row => row.brand === "Volvo" && row.model === "S90"));
    for (const identity of identities) {
      const filters = { brand: identity.brand, brandValues: catalogBrandValues(identity.brand), model: identity.model, generation: identity.generation_code };
      for (const axis of ["brand", "model", "generation", "modification", "trim"]) {
        const value = axis === "modification" ? "modification_label" : axis === "generation" ? "generation_code" : axis;
        const boundPredicate = predicate.replaceAll("omit", `'${axis}'`).replaceAll("f->", "($1::jsonb)->");
        const query = (view: string) => `select c.${value} as value,count(*)::int as cars from ${view} c
          where ${boundPredicate} and c.${value} is not null group by 1 order by 1`;
        const old = (await db.query(query("public.catalog_display_cars"), [JSON.stringify(filters)])).rows;
        const candidate = (await db.query(query("candidate_catalog_display_cars"), [JSON.stringify(filters)])).rows;
        assert.deepEqual(candidate, old, `facet values/counts changed for ${identity.brand} ${identity.model} ${axis}`);
        report.push({ ...identity, axis, options: old.length,
          old: await explain(query("public.catalog_display_cars"), filters),
          candidate: await explain(query("candidate_catalog_display_cars"), filters) });
      }
    }
    const listing = (view: string) => `select id,brand,model,modification_label from ${view} where ${visible}
      and brand='Volvo' and model='S90' order by catalog_sort_published_at desc nulls last,id limit 25`;
    assert.deepEqual((await db.query(listing("candidate_catalog_display_cars"))).rows,
      (await db.query(listing("public.catalog_display_cars"))).rows, "fresh sort changed");
    report.push({ query: "filteredFresh", old: await explain(listing("public.catalog_display_cars")), candidate: await explain(listing("candidate_catalog_display_cars")) });
    await db.query("set local role anon");
    assert.deepEqual((await db.query(listing("candidate_catalog_display_cars"))).rows,
      (await db.query(listing("public.catalog_display_cars"))).rows, "public RLS or fresh sort changed");
    report.push({ query: "publicFilteredFresh", old: await explain(listing("public.catalog_display_cars")), candidate: await explain(listing("candidate_catalog_display_cars")) });
    console.log(JSON.stringify({ permanentWrites: false, displayDifferences: differences, publicAccessVerified: true, report }, null, 2));
    await db.query("rollback");
  } finally {
    await db.query("rollback").catch(() => undefined);
    await db.end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
