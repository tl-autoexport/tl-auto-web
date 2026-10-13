import { Client } from "pg";
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, "ssjfvjetrlgrjwzkvfsk.supabase.co");
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, application_name: "tl-auto-appearance-verification" });

async function main() {
  const dbUrl = new URL(process.env.SUPABASE_DB_URL!);
  assert.ok(dbUrl.username.includes("ssjfvjetrlgrjwzkvfsk") || dbUrl.hostname.includes("ssjfvjetrlgrjwzkvfsk"), "Unexpected database target");
  await db.connect();
  await db.query("set statement_timeout='25s'; set lock_timeout='3s'");
  if (process.argv.includes("--test-triggers")) {
    // All test inserts, updates and deletes are unconditionally rolled back.
    await db.query("begin");
    try {
      const sample = (await db.query("select id,filter_option_ids from cars order by id limit 2 for update")).rows;
      const [a, b] = sample;
      const keys = async (id: string) => (await db.query("select filter_option_ids ids from cars where id=$1", [id])).rows[0].ids;
      const union = (ids: string[], extra: string[]) => [...new Set([...ids, ...extra])].sort();
      const inserted = (await db.query(`insert into car_options(car_id,source,name_original,is_present)
        values($1,'encar','후방 카메라',true),($1,'encar','선루프',true) returning id`, [a.id])).rows;
      assert.deepEqual(await keys(a.id), union(a.filter_option_ids, ["rear-camera", "sunroof"]));
      await db.query("update car_options set is_present=false where id=any($1::uuid[])", [inserted.map(r => r.id)]);
      assert.deepEqual(await keys(a.id), a.filter_option_ids);
      await db.query("update car_options set car_id=$1,is_present=true where id=any($2::uuid[])", [b.id, inserted.map(r => r.id)]);
      assert.deepEqual(await keys(a.id), a.filter_option_ids);
      assert.deepEqual(await keys(b.id), union(b.filter_option_ids, ["rear-camera", "sunroof"]));
      await db.query("delete from car_options where id=any($1::uuid[])", [inserted.map(r => r.id)]);
      assert.deepEqual(await keys(b.id), b.filter_option_ids);
      console.log("statement triggers verified: insert, false flags, moved car_id, delete");
    } finally { await db.query("rollback"); }
  }
  const definitions = (await db.query(`select
    (select count(*)::int from pg_trigger where tgrelid='public.car_options'::regclass and tgname like 'car_options_filter_%' and not tgisinternal) triggers,
    (select indisvalid and indisready from pg_index where indexrelid='public.cars_filter_option_ids_gin_idx'::regclass) index_valid,
    has_function_privilege('anon','public.refresh_car_filter_option_ids(uuid[])','execute') anon_can_write,
    has_function_privilege('authenticated','public.refresh_car_filter_option_ids(uuid[])','execute') authenticated_can_write`)).rows[0];
  assert.equal(definitions.triggers, 3);
  assert.equal(definitions.index_valid, true);
  assert.equal(definitions.anon_can_write, false);
  assert.equal(definitions.authenticated_can_write, false);
  console.log("schema and privileges", definitions);
  const cases = [ {}, { options: ["rear-camera"] }, { options: ["rear-camera", "heated-front-seats"] },
    { options: ["rear-camera"], colorValues: ["흰색", "Белый"] },
    { brand: "Hyundai", options: ["rear-camera"] }, { source: "chestny_prigon", options: ["rear-camera"] },
    { options: ["not-an-existing-option"] } ];
  for (const filter of cases) {
    const json = JSON.stringify(filter);
    const count = (await db.query("select count(*)::int n from catalog_display_cars c where catalog_display_match(c,$1::jsonb,null)", [json])).rows[0].n;
    const total = (await db.query("select cars from catalog_display_facet_options($1::jsonb,array['__total'])", [json])).rows[0].cars;
    assert.equal(total, count, JSON.stringify(filter));
    console.log("verified counts", { filter, count });
  }
  if (process.argv.includes("--record-migration")) {
    const path = (await db.query("select proconfig from pg_proc where oid='public.catalog_filter_option_id(text)'::regprocedure")).rows[0].proconfig;
    assert.ok(path?.includes("search_path=pg_catalog"));
    for (const [version, name] of [["20261013", "catalog_appearance_filters"], ["2026101301", "catalog_appearance_function_path"]]) {
      const sql = await readFile(`supabase/migrations/${version}_${name}.sql`, "utf8");
      await db.query(`insert into supabase_migrations.schema_migrations(version,name,statements)
        values($1,$2,$3::text[]) on conflict(version) do nothing`, [version, name, [sql]]);
      const recorded = (await db.query("select name from supabase_migrations.schema_migrations where version=$1", [version])).rows[0];
      assert.equal(recorded.name, name);
    }
    console.log("migration history recorded");
  }
}
main().catch(e => { console.error(e.message); process.exitCode=1; }).finally(() => db.end());
