import { Client } from "pg";
import { config } from "dotenv";

/**
 * Marks the electric tariff basis on published electric cars.
 *
 * The Encar import writes `calculation_status = 'pending_official_ev_tariff'`
 * only while a card has no calculation at all. A publisher that later writes a
 * landed price does not clear that marker, so a priced electric car can keep
 * the import-time pending status. This script replaces that stale value with
 * `calculated_external_ev_tariff`, which is what the catalogue audit and the
 * card UI expect for a priced electric car.
 *
 * Read-only by default; set ELECTRIC_TARIFF_WRITE=true to apply.
 * No Encar requests.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.ELECTRIC_TARIFF_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const CALCULATED = "calculated_external_ev_tariff";

type Row = {
  id: string; source_id: string; brand: string | null; model: string | null; year: number | null;
  price_rub: number | null; status: string | null;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select id, source_id, brand, model, year, price_rub,
             vehicle_specs->>'calculation_status' as status
      from public.cars
      where is_available = true and fuel_type = 'electric' and price_rub is not null
      order by source_id`);

    const planned = rows.filter((row) => row.status !== CALCULATED);
    const alreadyMarked = rows.length - planned.length;

    let written = 0;
    if (write && planned.length) {
      await db.query("begin");
      try {
        const result = await db.query(
          `update public.cars
              set vehicle_specs = coalesce(vehicle_specs, '{}'::jsonb) || jsonb_build_object('calculation_status', $1),
                  updated_at = now()
            where is_available = true and fuel_type = 'electric' and price_rub is not null
              and coalesce(vehicle_specs->>'calculation_status', '') <> $1`,
          [CALCULATED],
        );
        written = result.rowCount ?? 0;
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      pricedElectricCars: rows.length,
      alreadyMarked,
      plannedUpdates: planned.length,
      written,
      previousStatuses: [...new Set(rows.map((row) => row.status ?? "<none>"))],
      samples: planned.slice(0, 10).map((row) => ({
        sourceId: row.source_id, brand: row.brand, model: row.model, year: row.year,
        priceRub: row.price_rub, statusBefore: row.status,
      })),
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
