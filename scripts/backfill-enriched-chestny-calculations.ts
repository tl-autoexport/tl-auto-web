import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.CHESTNY_CALC_BACKFILL_DRY_RUN !== "false";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const fuel = (value: string | null) => {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("diesel") || text.includes("диз")) return "diesel";
  if (text.includes("hybrid") || text.includes("гибрид")) return "hybrid";
  if (text.includes("lpg") || text.includes("газ")) return "lpg";
  return "gasoline";
};

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const rateSnapshot = await getCbrCalcRates();
    const { rows } = await client.query<{
      id: string; price_krw: number; price_rub: number; year: number; engine_cc: number; power_hp: number; fuel_type: string | null;
    }>(`select id,price_krw,price_rub,year,engine_cc,power_hp,fuel_type from public.cars where is_available=true and primary_source='chestny_prigon' and vehicle_specs->>'calculation_status'='calculated_from_local_enriched_staging'`);
    const prepared = rows.map((car) => ({
      car,
      calc: calculateRuVladivostok({
        priceKrw: Number(car.price_krw),
        year: car.year,
        month: 6,
        engineCc: car.engine_cc,
        powerHp: car.power_hp,
        fuelType: fuel(car.fuel_type),
        destinationCity: "Владивосток",
        rates: rateSnapshot.rates,
        customsRates: rateSnapshot.customsRates,
        ratesAsOf: rateSnapshot.asOf,
        ratesSource: rateSnapshot.source,
        rateDetails: rateSnapshot.rateDetails,
      }),
    }));
    const mismatched = prepared.filter(({ car, calc }) => Math.round(calc.totalRub) !== Number(car.price_rub));
    if (mismatched.length) throw new Error(`Refusing to create mismatched snapshots: ${mismatched.length}`);
    if (!dryRun) {
      await client.query("begin");
      try {
        const ids = prepared.map(({ car }) => car.id);
        await client.query(`delete from public.calc_snapshots where car_id = any($1::uuid[])`, [ids]);
        for (let offset = 0; offset < prepared.length; offset += 100) {
          const values: unknown[] = [];
          const tuples = prepared.slice(offset, offset + 100).map(({ car, calc }, index) => {
            const base = index * 12;
            values.push(car.id, calc.calcVersion,
              JSON.stringify({ priceKrw: car.price_krw, year: car.year, month: 6, engineCc: car.engine_cc, powerHp: car.power_hp, fuelType: fuel(car.fuel_type), destinationCity: "Владивосток" }),
              JSON.stringify({ ...calc.rates, details: calc.rateDetails }), JSON.stringify(calc), Math.round(calc.carPriceRub), Math.round(calc.dutyRub), Math.round(calc.feesRub), Math.round(calc.utilRub), Math.round(calc.freightRub), Math.round(calc.brokerRub), Math.round(calc.totalRub));
            return `($${base + 1},'RU','Владивосток','individual',$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12})`;
          });
          await client.query(`insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub) values ${tuples.join(",")}`, values);
        }
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    console.log(JSON.stringify({ dryRun, cars: rows.length, priceMismatches: mismatched.length, snapshotsWritten: dryRun ? 0 : prepared.length, encarRequests: 0, publicCatalogChanged: !dryRun }, null, 2));
  } finally { await client.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
