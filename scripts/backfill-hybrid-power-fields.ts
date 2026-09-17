import { Client } from "pg";
import { config } from "dotenv";

/**
 * Populates the explicit hybrid power model from the existing columns.
 *
 * `customs_power_hp` is only written when the composition is valid for the
 * declared hybrid type: ICE power for ordinary cars, the 30-minute electric
 * rating for series hybrids, and the sum for parallel/combined/PHEV. If the
 * type or the 30-minute rating is missing the value stays null, which keeps the
 * specification out of approved resolution and leaves the card in
 * `power_pending` instead of falling back to a marketing system power.
 *
 * Read-only by default; set HYBRID_POWER_WRITE=true to apply.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.HYBRID_POWER_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const KW_TO_PS = 1.359621617;

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query(`
      select id, spec_key, propulsion_type, power_basis, calculation_power_kw,
             engine_power_hp, electric_power_kw_30min, hybrid_type, customs_power_hp
      from public.vehicle_power_specs order by spec_key`);

    const planned: Array<Record<string, unknown>> = [];
    let invalidComposition = 0;

    for (const row of rows) {
      const hybridType =
        row.propulsion_type === "hybrid_sequential" ? "series"
          : row.propulsion_type === "hybrid_parallel" ? "parallel"
            : "none";
      const iceHp = row.engine_power_hp == null
        ? (row.power_basis === "combustion_engine" ? Math.round(Number(row.calculation_power_kw) * KW_TO_PS * 100) / 100 : null)
        : Number(row.engine_power_hp);
      const electricHp = row.electric_power_kw_30min == null
        ? null
        : Math.round(Number(row.electric_power_kw_30min) * KW_TO_PS * 100) / 100;

      let customsHp: number | null = null;
      if (hybridType === "none" && iceHp != null) customsHp = iceHp;
      else if (hybridType === "series" && electricHp != null) customsHp = electricHp;
      else if (hybridType !== "none" && iceHp != null && electricHp != null) customsHp = Math.round((iceHp + electricHp) * 100) / 100;

      if (hybridType !== "none" && customsHp == null) invalidComposition++;

      planned.push({ id: row.id, spec_key: row.spec_key, hybridType, iceHp, electricHp, customsHp,
        previousCustoms: row.customs_power_hp });
    }

    let written = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const item of planned) {
          const result = await db.query(
            `update public.vehicle_power_specs
                set hybrid_type=$2, power_ice_hp=$3, power_electric_30min_hp=$4, customs_power_hp=$5, updated_at=now()
              where id=$1`,
            [item.id, item.hybridType, item.iceHp, item.electricHp, item.customsHp],
          );
          written += result.rowCount ?? 0;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    const byType: Record<string, number> = {};
    for (const item of planned) byType[String(item.hybridType)] = (byType[String(item.hybridType)] ?? 0) + 1;

    console.log(JSON.stringify({
      dryRun: !write,
      specifications: rows.length,
      byType,
      customsPowerSet: planned.filter((item) => item.customsHp != null).length,
      customsPowerWithheld: planned.filter((item) => item.customsHp == null).length,
      invalidHybridComposition: invalidComposition,
      written,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
