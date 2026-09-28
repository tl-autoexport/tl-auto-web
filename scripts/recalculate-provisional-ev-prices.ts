/**
 * Recalculate missing RU/Vladivostok prices for the already-resolved,
 * provisional 30-minute EV power values. Leaves every power/evidence field
 * unchanged; writes only price_rub and a matching calc_snapshot.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const EXPECTED_MISSING_EV_COUNT = 83;
const WRITE = process.env.RECALCULATE_PROVISIONAL_EV_PRICES_WRITE === "true";
const DB_URL = process.env.SUPABASE_DB_URL;

type EvRow = {
  id: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  registration_month: number | null;
  price_krw: string | number | null;
  price_rub: string | number | null;
  calculation_power_kw: string | number | null;
  calculation_power_status: string | null;
  power_basis: string | null;
  power_finality: string | null;
  power_resolution_source: string | null;
};

function requirePositive(value: string | number | null, name: string, sourceId: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} missing/invalid for Encar ${sourceId}`);
  return number;
}

async function main() {
  if (!DB_URL) throw new Error("SUPABASE_DB_URL is required");
  const rates = await getCbrCalcRates();
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(WRITE ? "begin" : "begin read only");
    if (WRITE) await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-provisional-ev-price-recalc'))");
    const rows = (await db.query<EvRow>(`select id,source_id,brand,model,year,registration_month,price_krw,price_rub,
          calculation_power_kw,calculation_power_status,power_basis,power_finality,power_resolution_source
        from public.cars
        where is_available=true and fuel_type='electric' and price_rub is null
        order by source_id${WRITE ? " for update" : ""}`)).rows;
    if (rows.length !== EXPECTED_MISSING_EV_COUNT)
      throw new Error(`Expected ${EXPECTED_MISSING_EV_COUNT} active EVs without price; found ${rows.length}. No changes made.`);

    const prepared = rows.map((row) => {
      if (row.price_rub != null || row.calculation_power_status !== "matched" ||
          row.power_basis !== "electric_30min" || row.power_finality !== "provisional" ||
          !row.power_resolution_source)
        throw new Error(`Power/price contract mismatch for Encar ${row.source_id}. No changes made.`);
      const year = requirePositive(row.year, "year", row.source_id);
      const priceKrw = requirePositive(row.price_krw, "price_krw", row.source_id);
      const powerKw = requirePositive(row.calculation_power_kw, "calculation_power_kw", row.source_id);
      const month = row.registration_month ?? 6;
      if (!Number.isInteger(month) || month < 1 || month > 12)
        throw new Error(`registration_month invalid for Encar ${row.source_id}`);
      const calculation = calculateRuVladivostok({
        priceKrw, year, month, engineCc: null, fuelType: "electric", powerKw,
        destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
        ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails,
      });
      return { row, year, month, priceKrw, powerKw, calculation, priceRub: Math.round(calculation.totalRub) };
    });

    const totals = prepared.map((item) => item.priceRub);
    const summary = {
      readOnly: !WRITE,
      databaseWrites: WRITE ? prepared.length * 2 : 0,
      destination: "RU / Владивосток",
      vehicles: prepared.length,
      allUse30MinuteElectricPower: prepared.every((item) => item.row.power_basis === "electric_30min"),
      powerFinalityPreserved: "provisional",
      powerFieldsModified: 0,
      rates: { asOf: rates.asOf, source: rates.source, details: rates.rateDetails },
      priceRub: { min: Math.min(...totals), max: Math.max(...totals), sum: totals.reduce((sum, value) => sum + value, 0) },
      sample: prepared.slice(0, 5).map(({ row, powerKw, priceRub }) => ({ sourceId: row.source_id, brand: row.brand, model: row.model, powerKw, priceRub })),
    };

    if (!WRITE) {
      await db.query("rollback");
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    for (const item of prepared) {
      const { row, calculation, priceRub, year, month, priceKrw, powerKw } = item;
      const update = await db.query(`update public.cars set price_rub=$1
        where id=$2 and source_id=$3 and is_available=true and fuel_type='electric' and price_rub is null
          and calculation_power_status='matched' and power_basis='electric_30min'
          and power_finality='provisional' and calculation_power_kw=$4 and power_resolution_source=$5`,
      [priceRub, row.id, row.source_id, powerKw, row.power_resolution_source]);
      if (update.rowCount !== 1) throw new Error(`Concurrent catalog change for Encar ${row.source_id}; transaction rolled back.`);
      const inputs = {
        carId: row.id, sourceId: row.source_id, brand: row.brand, model: row.model,
        year, month, priceKrw, fuelType: "electric", powerBasis: "electric_30min",
        calculationPowerKw: powerKw, powerFinality: "provisional",
        powerResolutionSource: row.power_resolution_source,
        destinationCity: "Владивосток", calculationVersion: calculation.calcVersion,
      };
      await db.query(`insert into public.calc_snapshots
          (car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,
           car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
        values ($1,'RU','Владивосток','individual',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
      [row.id, calculation.calcVersion, JSON.stringify(inputs),
        JSON.stringify({ rates: calculation.rates, customsRates: calculation.customsRates,
          rateDetails: calculation.rateDetails, asOf: calculation.ratesAsOf, source: calculation.ratesSource }),
        JSON.stringify(calculation), Math.round(calculation.carPriceRub), Math.round(calculation.dutyRub),
        Math.round(calculation.feesRub), Math.round(calculation.utilRub), Math.round(calculation.freightRub),
        Math.round(calculation.brokerRub), priceRub]);
    }

    const verify = await db.query<{ cars: number; missing_price: number; mismatched_snapshot: number }>(`
      select count(*)::int cars,
        count(*) filter(where c.price_rub is null)::int missing_price,
        count(*) filter(where latest.total_rub is distinct from c.price_rub)::int mismatched_snapshot
      from public.cars c
      left join lateral (select total_rub from public.calc_snapshots s where s.car_id=c.id order by s.calculated_at desc limit 1) latest on true
      where c.is_available=true and c.fuel_type='electric' and c.id=any($1::uuid[])`, [prepared.map((item) => item.row.id)]);
    const verified = verify.rows[0];
    if (verified.cars !== EXPECTED_MISSING_EV_COUNT || verified.missing_price !== 0 || verified.mismatched_snapshot !== 0)
      throw new Error(`Post-write verification failed: ${JSON.stringify(verified)}; transaction rolled back.`);
    await db.query("commit");
    console.log(JSON.stringify({ ...summary, readOnly: false, databaseWrites: prepared.length * 2, verified }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
