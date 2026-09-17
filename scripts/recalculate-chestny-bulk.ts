import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok, CALC_VERSION } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

/**
 * Refresh the RU calculation for active Chestny cards.
 *
 * Root-cause fix: the previous revision passed `registration_month ?? 6` to the
 * calculator and stored `registration_month` (empty for legacy cards) instead
 * of the month actually used, so every snapshot silently fell back to June and
 * the month could not be reviewed afterwards. This revision derives the month
 * from `registration_date`, records it explicitly in `inputs` together with its
 * source, and updates the existing snapshot in place instead of relying on a
 * `not exists` guard that skipped already-calculated cards.
 *
 * Read-only by default. Set RECALC_WRITE=true to apply.
 * No Encar requests. The calculator logic itself is not modified.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.RECALC_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

function monthFromRegistration(value: string | null): { month: number | null; suspicious: boolean } {
  if (!value) return { month: null, suspicious: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { month: null, suspicious: true };
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return { month: null, suspicious: true };
  return { month: date.getUTCMonth() + 1, suspicious: false };
}

type CarRow = {
  id: string; brand: string | null; model: string | null; year: number | null; registration_month: number | null;
  registration_date: string | null; price_krw: number | null; price_rub: number | null; engine_cc: number | null; power_hp: number | null;
  fuel_type: string | null; snapshot_id: string | null;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const rates = await getCbrCalcRates();
    const { rows } = await db.query<CarRow>(`
      select c.id, c.brand, c.model, c.year, c.registration_month, c.registration_date,
             c.price_krw, c.price_rub, c.engine_cc, c.power_hp, c.fuel_type,
             (select s.id from public.calc_snapshots s
               where s.car_id = c.id and s.calc_version = $1
               order by s.calculated_at desc limit 1) snapshot_id
      from public.cars c
      where c.primary_source = 'chestny_prigon' and c.is_available = true`, [CALC_VERSION]);

    const planned: Array<{
      car: CarRow; month: number | null; monthSource: string; updateSnapshot: boolean; priceBefore: number;
      fields: number[]; inputs: Record<string, unknown>; rates: Record<string, unknown>; result: Record<string, unknown>;
    }> = [];
    let skipped = 0;
    let suspiciousDates = 0;
    const monthSources: Record<string, number> = {};

    for (const car of rows) {
      if (!car.price_krw || !car.year || !car.engine_cc) { skipped++; continue; }
      const derived = monthFromRegistration(car.registration_date);
      if (derived.suspicious) suspiciousDates++;
      const month = derived.month ?? car.registration_month ?? null;
      const monthSource = derived.month != null
        ? "first_registration_date"
        : car.registration_month != null
          ? "registration_month"
          : "unknown_june_placeholder";
      monthSources[monthSource] = (monthSources[monthSource] ?? 0) + 1;

      const calc = calculateRuVladivostok({
        priceKrw: Number(car.price_krw), year: Number(car.year), month: month ?? 6,
        engineCc: Number(car.engine_cc), powerHp: Number(car.power_hp ?? 0), fuelType: car.fuel_type ?? undefined,
        rates: rates.rates, customsRates: rates.customsRates, ratesAsOf: rates.asOf,
        ratesSource: rates.source, rateDetails: rates.rateDetails,
      });

      planned.push({
        car, month, monthSource, updateSnapshot: car.snapshot_id != null, priceBefore: Math.round(Number(car.price_rub ?? 0)),
        fields: [Math.round(calc.carPriceRub), Math.round(calc.dutyRub), Math.round(calc.feesRub),
          Math.round(calc.utilRub), Math.round(calc.freightRub), Math.round(calc.brokerRub), Math.round(calc.totalRub)],
        inputs: {
          priceKrw: Number(car.price_krw), year: Number(car.year), month, monthSource,
          engineCc: Number(car.engine_cc), powerHp: Number(car.power_hp ?? 0), fuelType: car.fuel_type,
          destinationCity: "Владивосток",
        },
        rates: { ...calc.rates, asOf: calc.ratesAsOf, source: calc.ratesSource, details: calc.rateDetails },
        result: calc as unknown as Record<string, unknown>,
      });
    }

    let snapshotsUpdated = 0;
    let snapshotsInserted = 0;
    let pricesUpdated = 0;
    let registrationMonthsBackfilled = 0;

    if (write && planned.length) {
      await db.query("begin");
      try {
        for (const part of chunk(planned, 100)) {
          for (const item of part) {
            if (item.updateSnapshot) {
              await db.query(
                `update public.calc_snapshots
                    set inputs=$2::jsonb, rates=$3::jsonb, result=$4::jsonb, calc_version=$5, calculated_at=now(),
                        car_price_rub=$6, duty_rub=$7, fees_rub=$8, util_rub=$9, freight_rub=$10, broker_rub=$11, total_rub=$12
                  where id=$1`,
                [item.car.snapshot_id, JSON.stringify(item.inputs), JSON.stringify(item.rates), JSON.stringify(item.result),
                  CALC_VERSION, ...item.fields],
              );
              snapshotsUpdated++;
            } else {
              await db.query(
                `insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
                 values ($1,'RU','Владивосток','individual',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
                [item.car.id, CALC_VERSION, JSON.stringify(item.inputs), JSON.stringify(item.rates), JSON.stringify(item.result), ...item.fields],
              );
              snapshotsInserted++;
            }
          }
          const ids = part.map((item) => item.car.id);
          const prices = part.map((item) => item.fields[6]);
          const months = part.map((item) => item.month);
          const result = await db.query(
            `update public.cars as c
                set price_rub = v.price, registration_month = coalesce(v.month, c.registration_month), updated_at = now()
               from unnest($1::uuid[], $2::bigint[], $3::int[]) as v(id, price, month)
              where c.id = v.id`,
            [ids, prices, months],
          );
          pricesUpdated += result.rowCount ?? 0;
          registrationMonthsBackfilled += months.filter((month) => month != null).length;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      calcVersion: CALC_VERSION,
      rateAsOf: rates.asOf,
      activeCars: rows.length,
      planned: planned.length,
      skippedIncompleteSourceData: skipped,
      suspiciousRegistrationDates: suspiciousDates,
      monthSources,
      snapshotsToUpdate: planned.filter((item) => item.updateSnapshot).length,
      snapshotsToInsert: planned.filter((item) => !item.updateSnapshot).length,
      snapshotsUpdated,
      snapshotsInserted,
      pricesUpdated,
      registrationMonthsBackfilled,
      priceBeforeTotalRub: planned.reduce((sum, item) => sum + item.priceBefore, 0),
      priceAfterTotalRub: planned.reduce((sum, item) => sum + item.fields[6], 0),
      priceDeltaRub: planned.reduce((sum, item) => sum + item.fields[6] - item.priceBefore, 0),
      priceRaised: planned.filter((item) => item.fields[6] > item.priceBefore).length,
      priceLowered: planned.filter((item) => item.fields[6] < item.priceBefore).length,
      encarRequests: 0,
      publicCatalogChanged: write,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
