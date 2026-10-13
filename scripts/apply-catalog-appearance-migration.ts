import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";
import assert from "node:assert/strict";
import { CATALOG_OPTIONS } from "../src/lib/catalog-appearance-filters";
import { homedir } from "node:os";
import { join } from "node:path";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const write = process.argv.includes("--write");
const expectedProject = "ssjfvjetrlgrjwzkvfsk";
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, `${expectedProject}.supabase.co`);
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
  application_name: "tl-auto-appearance-migration" });
const checkpointDir = join(homedir(), ".codex", "tl-auto-migrations");
const checkpointPath = `${checkpointDir}/appearance-progress.json`;
const invariantSql = `select count(*)::int total,
  md5(string_agg(md5((to_jsonb(c)-'updated_at'-'filter_option_ids')::text),'' order by id)) fingerprint
  from public.cars c`;

async function transaction(fn: () => Promise<void>, rollback = false) {
  await db.query("begin");
  try {
    await db.query("set local lock_timeout = '3s'; set local statement_timeout = '25s'");
    await db.query("select pg_advisory_xact_lock(20261013, 1)");
    await fn();
    await db.query(rollback ? "rollback" : "commit");
  } catch (error) { await db.query("rollback"); throw error; }
}

async function main() {
  await db.connect();
  // Confirm actual database identity as well as configured URL.
  const identity = await db.query("select current_database(), current_user");
  const dbUrl = new URL(process.env.SUPABASE_DB_URL!);
  assert.ok(dbUrl.username.includes(expectedProject) || dbUrl.hostname.includes(expectedProject), "Unexpected database target");
  await db.query("set statement_timeout='25s'");
  const baseline = (await db.query(invariantSql)).rows[0];
  const definitions = (await db.query(`select
    (select jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid,true),'options',c.reloptions,'acl',c.relacl))
      from pg_class c where c.oid in ('public.catalog_display_cars'::regclass,'public.catalog_display_cascade_cars'::regclass)) views,
    (select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl))
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
      ('catalog_display_match','catalog_display_facet_options')) functions`)).rows[0];
  console.log("preflight", { identity: identity.rows[0], baseline, write });
  if (!write) return;
  await mkdir(checkpointDir, { recursive: true, mode: 0o700 });
  const backup = `${checkpointDir}/appearance-before-${Date.now()}.json`;
  await writeFile(backup, JSON.stringify({ baseline, definitions }, null, 2), { mode: 0o600 });
  console.log("definitions saved", backup);
  const sql = await readFile("supabase/migrations/20261013_catalog_appearance_filters.sql", "utf8");
  const boundary = sql.indexOf("-- Add the indexed array");
  assert.ok(boundary > 0);
  const schema = sql.slice(0, boundary) + `
    revoke all on function public.catalog_filter_option_id(text) from public, anon, authenticated;
    revoke all on function public.refresh_car_filter_option_ids(uuid[]) from public, anon, authenticated;
    revoke all on function public.sync_car_filter_option_ids() from public, anon, authenticated;
    alter function public.catalog_filter_option_id(text) set search_path = pg_catalog;`;
  const activation = sql.slice(boundary);
  // Validate every DDL statement together, then discard this trial transaction.
  await transaction(async () => { await db.query(sql); }, true);
  console.log("complete schema trial rolled back successfully");
  await transaction(async () => { await db.query(schema); });
  console.log("schema committed; existing catalogue views still unchanged");
  const aliasChecks = CATALOG_OPTIONS.flatMap(option => option.aliases.map(alias => ({ alias, id: option.id })));
  const incorrectAliases = (await db.query(`select alias from jsonb_to_recordset($1::jsonb) as a(alias text,id text)
    where public.catalog_filter_option_id(alias) is distinct from id`, [JSON.stringify(aliasChecks)])).rows;
  assert.equal(incorrectAliases.length, 0, "SQL/TypeScript alias mismatch");

  // Cursor can resume a partially completed run; operations are idempotent.
  let cursor: string | null = null;
  try { cursor = JSON.parse(await readFile(checkpointPath, "utf8")).cursor ?? null; } catch { /* first run */ }
  let batches = 0, processed = 0;
  while (true) {
    const ids: string[] = (await db.query("select id from public.cars where ($1::uuid is null or id > $1::uuid) order by id limit 100", [cursor])).rows.map((r) => r.id);
    if (!ids.length) break;
    const started = Date.now();
    await transaction(async () => { await db.query("select public.refresh_car_filter_option_ids($1::uuid[])", [ids]); });
    cursor = ids.at(-1)!;
    processed += ids.length;
    batches++;
    await writeFile(checkpointPath, JSON.stringify({ cursor, processed, batches }), { mode: 0o600 });
    if (batches === 1 || batches % 10 === 0) console.log("backfill", { processed, batches, batchMs: Date.now() - started });
  }
  // Independently aggregate source rows once to verify all materialized keys.
  const aliases = CATALOG_OPTIONS.flatMap(option => option.aliases.map(alias => ({ alias: alias.toLowerCase().trim(), id: option.id })));
  const mismatches = (await db.query(`with aliases as materialized (
    select * from jsonb_to_recordset($1::jsonb) as a(alias text,id text)
  ), expected as materialized (
    select o.car_id, array_agg(distinct m.key order by m.key) ids
    from public.car_options o
    left join aliases ru on ru.alias=lower(btrim(o.name_ru))
    left join aliases original on original.alias=lower(btrim(o.name_original))
    cross join lateral (values (ru.id),(original.id)) m(key)
    where o.is_present is true and m.key is not null group by o.car_id
  ) select count(*)::int n from public.cars c left join expected e on e.car_id=c.id
    where c.filter_option_ids is distinct from coalesce(e.ids,'{}'::text[])`, [JSON.stringify(aliases)])).rows[0].n;
  assert.equal(mismatches, 0, "Backfill is incomplete; activation stopped");
  assert.deepEqual((await db.query(invariantSql)).rows[0], baseline, "Existing car data changed; activation stopped");
  await transaction(async () => { await db.query(activation); });
  console.log("catalogue views and filter predicates activated");
  const coverage = (await db.query(`select primary_source,count(*)::int cars,
    count(*) filter(where cardinality(filter_option_ids)>0)::int with_options
    from public.cars where is_available group by 1 order by 1`)).rows;
  console.log("coverage", coverage);
  const filters = [{}, { options: ["rear-camera"] }, { options: ["rear-camera", "heated-front-seats"] },
    { colorValues: ["Белый", "흰색"], options: ["rear-camera"] }];
  for (const filter of filters) {
    const direct = (await db.query("select count(*)::int n from public.catalog_display_cars c where public.catalog_display_match(c,$1::jsonb,null)", [JSON.stringify(filter)])).rows[0].n;
    const rpc = (await db.query("select cars from public.catalog_display_facet_options($1::jsonb,array['__total'])", [JSON.stringify(filter)])).rows[0].cars;
    assert.equal(rpc, direct, "Facet/listing count mismatch");
    console.log("count parity", { filter, count: direct });
  }
  assert.deepEqual((await db.query(invariantSql)).rows[0], baseline);
  console.log("verified: original car fields unchanged; all option keys match source rows");
  await writeFile(`${checkpointDir}/appearance-result.json`, JSON.stringify({ backup, baseline, coverage, mismatches, completedAt: new Date().toISOString() },null,2), { mode: 0o600 });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
