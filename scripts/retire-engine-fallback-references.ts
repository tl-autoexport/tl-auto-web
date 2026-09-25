/**
 * Retire the displacement-derived automatic references that carry one blanket answer.
 *
 * `engine_fallback` rows are derived from engine displacement only, and 37 of them share
 * the same 150 hp / 110.3249 kW answer across unrelated models. The daily recalculation
 * would adopt them and republish a wrong power, so they are archived rather than left
 * available to buy.
 *
 * Retirement is reversible and additive: `status='retired'` is already excluded by both
 * the recalculation and the reference lookups. Nothing is deleted. The list of retired
 * keys is written to `data/power/engine-fallback-retirement.json`.
 *
 * Dry-run by default; REFERENCE_RETIRE_APPLY=true performs the update.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const apply = process.env.REFERENCE_RETIRE_APPLY === "true";
const source = process.env.REFERENCE_RETIRE_SOURCE ?? "engine_fallback";
const powerKw = Number(process.env.REFERENCE_RETIRE_POWER_KW ?? 110.3249);

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let retiredKeys: string[] = [];
  try {
    const targets = (await db.query<{ id: string; configuration_key: string; brand: string | null; model: string | null; power_hp: number }>(`
      select id, configuration_key, brand, model, power_hp::float8 as power_hp
      from public.vehicle_power_automatic_reference
      where source = $1 and status <> 'retired' and round(power_kw::numeric, 4) = round($2::numeric, 4)
      order by brand, model`, [source, powerKw])).rows;
    retiredKeys = targets.map((row) => row.configuration_key);

    if (!apply) {
      console.log(JSON.stringify({
        apply, source, powerKw, matchingRows: targets.length,
        note: "dry-run; set REFERENCE_RETIRE_APPLY=true to retire these rows",
        sample: targets.slice(0, 6).map((row) => `${row.configuration_key} (${row.power_hp} hp)`),
      }, null, 2));
      return;
    }

    await db.query("begin");
    const updated = await db.query(`
      update public.vehicle_power_automatic_reference
         set status = 'retired', updated_at = now()
       where source = $1 and status <> 'retired' and round(power_kw::numeric, 4) = round($2::numeric, 4)`, [source, powerKw]);
    await db.query("commit");

    mkdirSync("data/power", { recursive: true });
    writeFileSync("data/power/engine-fallback-retirement.json", JSON.stringify({
      retiredAt: new Date().toISOString(), source, powerKw, rows: updated.rowCount, configurationKeys: retiredKeys,
    }, null, 2));
    console.log(JSON.stringify({ apply, source, powerKw, matchingRows: targets.length, updated: updated.rowCount, archive: "data/power/engine-fallback-retirement.json" }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
