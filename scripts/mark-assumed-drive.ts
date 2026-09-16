import { Client } from "pg";
import { config } from "dotenv";

/**
 * Records the provenance of the drive axle on cards that were published with
 * the legacy `2WD` fallback. The displayed value is intentionally left as is;
 * only the metadata is corrected so the assumption is no longer mistaken for a
 * source fact.
 *
 * Read-only by default. Set DRIVE_MARK_WRITE=true to apply.
 * No Encar requests, prices and power untouched.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.DRIVE_MARK_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const targets = await db.query<{ id: string; brand: string | null; drive_type: string | null }>(`
      select id, brand, drive_type
      from public.cars
      where primary_source='chestny_prigon' and is_available=true
        and vehicle_specs->>'drive_resolution' = 'best_fit_2wd'
        and coalesce(vehicle_specs->>'drive_source','') <> 'assumed'`);

    const byBrand: Record<string, number> = {};
    const byDrive: Record<string, number> = {};
    for (const row of targets.rows) {
      bump(byBrand, String(row.brand ?? "unknown"));
      bump(byDrive, String(row.drive_type ?? "null"));
    }

    let written = 0;
    if (write && targets.rows.length) {
      await db.query("begin");
      try {
        const result = await db.query(`
          update public.cars
             set vehicle_specs = coalesce(vehicle_specs,'{}'::jsonb)
                 || jsonb_build_object('drive_source','assumed','drive_resolution','assumed_2wd'),
                 updated_at = now()
           where primary_source='chestny_prigon' and is_available=true
             and vehicle_specs->>'drive_resolution' = 'best_fit_2wd'
             and coalesce(vehicle_specs->>'drive_source','') <> 'assumed'`);
        written = result.rowCount ?? 0;
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      cardsToMark: targets.rows.length,
      written,
      byBrand: Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count })),
      byDriveValue: byDrive,
      displayedDriveChanged: false,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
