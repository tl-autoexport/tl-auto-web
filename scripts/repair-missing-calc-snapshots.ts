import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok, CALC_VERSION } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

/**
 * Repairs published cards that carry a price but no calculation snapshot.
 *
 * The publication contract requires a price and its snapshot to come from the
 * same calculation, so a snapshot is never invented: the card is recalculated
 * with the current rate snapshot and both values are written together.
 *
 * Because that can move a live price, the script refuses to write when the
 * recalculated total differs from the stored one — such a card is reported for a
 * separate decision instead of being changed silently.
 *
 * Read-only by default; set SNAPSHOT_REPAIR_WRITE=true to apply.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.SNAPSHOT_REPAIR_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const rates = await getCbrCalcRates();
    const { rows } = await db.query<{
      id: string; source_id: string; brand: string | null; model: string | null; price_krw: number | null;
      price_rub: number | null; year: number | null; engine_cc: number | null; power_hp: number | null;
      fuel_type: string | null; calculation_month: number | null;
    }>(`
      select c.id, c.source_id, c.brand, c.model, c.price_krw, c.price_rub, c.year, c.engine_cc,
             c.power_hp, c.fuel_type, c.calculation_month
      from public.cars c
      where c.is_available and c.price_rub is not null
        and not exists (select 1 from public.calc_snapshots s where s.car_id = c.id)
      order by c.published_at nulls last`);

    const repairable: Array<{ row: (typeof rows)[number]; calc: ReturnType<typeof calculateRuVladivostok>; total: number }> = [];
    const heldBack: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      if (!row.price_krw || !row.year || !row.engine_cc || !row.power_hp || !row.calculation_month) {
        heldBack.push({ sourceId: row.source_id, reason: "incomplete_source_data" });
        continue;
      }
      const calc = calculateRuVladivostok({
        priceKrw: Number(row.price_krw), year: Number(row.year), month: Number(row.calculation_month),
        engineCc: Number(row.engine_cc), powerHp: Number(row.power_hp), fuelType: row.fuel_type ?? undefined,
        rates: rates.rates, customsRates: rates.customsRates, ratesAsOf: rates.asOf,
        ratesSource: rates.source, rateDetails: rates.rateDetails,
      });
      const total = Math.round(calc.totalRub);
      if (total !== Math.round(Number(row.price_rub))) {
        heldBack.push({ sourceId: row.source_id, storedPrice: row.price_rub, recalculated: total, reason: "price_would_change" });
        continue;
      }
      repairable.push({ row, calc, total });
    }

    let written = 0;
    if (write && repairable.length) {
      await db.query("begin");
      try {
        for (const item of repairable) {
          const calc = item.calc;
          await db.query(
            `insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
             values ($1,'RU','Владивосток','individual',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
            [item.row.id, CALC_VERSION,
              JSON.stringify({ priceKrw: Number(item.row.price_krw), year: Number(item.row.year), month: Number(item.row.calculation_month), monthSource: "stored", engineCc: Number(item.row.engine_cc), powerHp: Number(item.row.power_hp), fuelType: item.row.fuel_type, destinationCity: "Владивосток" }),
              JSON.stringify({ ...calc.rates, details: calc.rateDetails }), JSON.stringify(calc),
              Math.round(calc.carPriceRub), Math.round(calc.dutyRub), Math.round(calc.feesRub),
              Math.round(calc.utilRub), Math.round(calc.freightRub), Math.round(calc.brokerRub), item.total],
          );
          written++;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      pricedWithoutSnapshot: rows.length,
      repairable: repairable.map((item) => ({ sourceId: item.row.source_id, brand: item.row.brand, model: item.row.model, priceRub: item.total })),
      heldBack,
      written,
      note: "A snapshot is written only together with a price that did not change.",
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
