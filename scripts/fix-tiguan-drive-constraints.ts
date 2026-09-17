import { Client } from "pg";
import { config } from "dotenv";

/**
 * Corrects the Tiguan 2.0 TDI disambiguation.
 *
 * The Korean sources distinguish the variants by drive, not by trim: the
 * 2.0 TDI is 150 PS and the 2.0 TDI 4MOTION is 200 PS. The existing 200 PS rule
 * was constrained by the "2.0 TDI Prestige" badge and its own note admitted it
 * was fitted to Encar badges while unbadged records stayed preliminary. This
 * script replaces the badge constraint with a drive constraint and retires the
 * contained duplicate of the 150 PS rule.
 *
 * A card whose drive is unknown matches neither rule, so it stays in review
 * instead of silently receiving 150 PS.
 *
 * Read-only by default. Set TIGUAN_FIX_WRITE=true to apply.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.TIGUAN_FIX_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const TWO_WD = ["volkswagen-tiguan-ad-1968-150ps-2018-2024", "volkswagen-tiguan-2.0-tdi-1968-150ps-2019-2024"];
const FOUR_WD = ["volkswagen-tiguan-ad-1968-200ps-2021-2024"];
const RETIRE = "volkswagen-tiguan-2.0-tdi-1968-150ps-2019-2024";

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const specs = await db.query(`select id, spec_key, status, calculation_power_kw from public.vehicle_power_specs where spec_key = any($1)`,
      [[...TWO_WD, ...FOUR_WD]]);
    const plan: Array<Record<string, unknown>> = [];

    for (const row of specs.rows) {
      const targetDrive = TWO_WD.includes(row.spec_key) ? "2WD" : "4WD";
      const matches = await db.query(`select id, trim, badge_normalized, drive_type from public.vehicle_power_spec_matches where spec_id=$1`, [row.id]);
      plan.push({
        spec_key: row.spec_key,
        status: row.status,
        powerPs: Math.round(Number(row.calculation_power_kw) * 1.359621617),
        matcherRows: matches.rowCount,
        badgesToClear: matches.rows.filter((m) => m.badge_normalized || m.trim).length,
        driveBecomes: targetDrive,
      });
    }

    const retireSpec = specs.rows.find((row) => row.spec_key === RETIRE);
    let written = 0;

    if (write) {
      await db.query("begin");
      try {
        for (const row of specs.rows) {
          const targetDrive = TWO_WD.includes(row.spec_key) ? "2WD" : "4WD";
          const updated = await db.query(
            `update public.vehicle_power_spec_matches
                set drive_type=$2, trim=null, badge_normalized=null
              where spec_id=$1`,
            [row.id, targetDrive],
          );
          written += updated.rowCount ?? 0;
        }
        if (retireSpec) {
          await db.query(
            `update public.vehicle_power_specs
                set status='retired', approval_note=coalesce(approval_note,'') || ' Retired: contained in volkswagen-tiguan-ad-1968-150ps-2018-2024 after the drive constraint fix.', updated_at=now()
              where id=$1`,
            [retireSpec.id],
          );
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      plan,
      retired: RETIRE,
      matcherRowsWritten: written,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
