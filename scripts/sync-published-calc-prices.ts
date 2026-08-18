import { config } from "dotenv";
import { Client } from "pg";

import { calculateRuVladivostok } from "@/server/calc/ru";
import { getCbrCalcRates } from "@/server/calc/rates";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type StoredCar = {
  id: string;
  primary_source: string;
  source_id: string;
  price_krw: number;
  price_rub: number;
  year: number;
  registration_month: number | null;
  engine_cc: number;
  power_hp: number;
  fuel_type: "gasoline" | "diesel";
  latest_total_rub: number;
  latest_inputs: Record<string, unknown> | null;
};

type RecalculatedCar = StoredCar & {
  newPriceRub: number;
  snapshot: Record<string, unknown>;
};

const mismatchQuery = `
  WITH latest_snapshots AS (
    SELECT DISTINCT ON (car_id)
      car_id, total_rub, inputs
    FROM calc_snapshots
    ORDER BY car_id, calculated_at DESC, id DESC
  )
  SELECT
    c.id,
    c.primary_source,
    c.source_id,
    c.price_krw,
    c.price_rub,
    c.year,
    c.registration_month,
    c.engine_cc,
    c.power_hp,
    c.fuel_type,
    s.total_rub AS latest_total_rub,
    s.inputs AS latest_inputs
  FROM cars c
  JOIN latest_snapshots s ON s.car_id = c.id
  WHERE c.is_available = true
    AND c.fuel_type IN ('gasoline', 'diesel')
    AND c.price_rub IS NOT NULL
    AND c.price_krw IS NOT NULL
    AND c.year IS NOT NULL
    AND c.engine_cc IS NOT NULL
    AND c.power_hp IS NOT NULL
    AND c.price_rub IS DISTINCT FROM s.total_rub
  ORDER BY c.primary_source, c.source_id
`;

function snapshotSourceId(row: StoredCar) {
  const value = row.latest_inputs?.source_id;
  return value == null ? null : String(value);
}

async function main() {
  const dryRun = process.env.PUBLISHED_CALC_SYNC_DRY_RUN !== "false";
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not configured");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query<StoredCar>(mismatchQuery);
    const snapshotAligned = rows.filter((row) => snapshotSourceId(row) === row.source_id);
    const sourceChanged = rows.filter((row) => snapshotSourceId(row) !== row.source_id);
    const rateSnapshot = sourceChanged.length ? await getCbrCalcRates() : null;
    const recalculated: RecalculatedCar[] = sourceChanged.map((row) => {
      const calc = calculateRuVladivostok({
        priceKrw: row.price_krw,
        year: row.year,
        month: row.registration_month ?? 6,
        engineCc: row.engine_cc,
        powerHp: row.power_hp,
        fuelType: row.fuel_type,
        rates: rateSnapshot!.rates,
        ratesAsOf: rateSnapshot!.asOf,
        ratesSource: rateSnapshot!.source,
        rateDetails: rateSnapshot!.rateDetails,
      });

      return {
        ...row,
        newPriceRub: calc.totalRub,
        snapshot: {
          car_id: row.id,
          calc_version: calc.calcVersion,
          inputs: {
            id: row.id,
            primary_source: row.primary_source,
            source_id: row.source_id,
            price_krw: row.price_krw,
            year: row.year,
            registration_month: row.registration_month,
            engine_cc: row.engine_cc,
            power_hp: row.power_hp,
            fuel_type: row.fuel_type,
          },
          rates: { ...calc.rates, asOf: calc.ratesAsOf, source: calc.ratesSource },
          result: calc,
          car_price_rub: calc.carPriceRub,
          duty_rub: calc.dutyRub,
          fees_rub: calc.feesRub,
          util_rub: calc.utilRub,
          freight_rub: calc.freightRub,
          broker_rub: calc.brokerRub,
          total_rub: calc.totalRub,
        },
      };
    });

    if (!dryRun) {
      const priceUpdates = [
        ...snapshotAligned.map((row) => ({ id: row.id, price_rub: row.latest_total_rub })),
        ...recalculated.map((row) => ({ id: row.id, price_rub: row.newPriceRub })),
      ];
      const snapshots = recalculated.map((row) => row.snapshot);
      await client.query("update leads set calc_snapshot_id = null where calc_snapshot_id in (select id from calc_snapshots where car_id = any($1::uuid[]))", [recalculated.map((row) => row.id)]);
      await client.query("delete from calc_snapshots where car_id = any($1::uuid[])", [recalculated.map((row) => row.id)]);
      const { rows: written } = await client.query<{
        updated_prices: number;
        inserted_snapshots: number;
      }>(
        `WITH updated AS (
          UPDATE cars c
          SET price_rub = values.price_rub
          FROM jsonb_to_recordset($1::jsonb) AS values(id uuid, price_rub numeric)
          WHERE c.id = values.id
          RETURNING c.id
        ), inserted AS (
          INSERT INTO calc_snapshots (
            car_id, calc_version, inputs, rates, result, car_price_rub,
            duty_rub, fees_rub, util_rub, freight_rub, broker_rub, total_rub
          )
          SELECT
            values.car_id, values.calc_version, values.inputs, values.rates, values.result,
            values.car_price_rub, values.duty_rub, values.fees_rub,
            values.util_rub, values.freight_rub, values.broker_rub, values.total_rub
          FROM jsonb_to_recordset($2::jsonb) AS values(
            car_id uuid, calc_version text, inputs jsonb, rates jsonb, result jsonb,
            car_price_rub numeric, duty_rub numeric, fees_rub numeric,
            util_rub numeric, freight_rub numeric, broker_rub numeric, total_rub numeric
          )
          RETURNING id
        )
        SELECT
          (SELECT count(*)::int FROM updated) AS updated_prices,
          (SELECT count(*)::int FROM inserted) AS inserted_snapshots`,
        [
          JSON.stringify(priceUpdates),
          JSON.stringify(
            snapshots.map((snapshot) => ({
              car_id: snapshot.car_id,
              calc_version: snapshot.calc_version,
              inputs: snapshot.inputs,
              rates: snapshot.rates,
              result: snapshot.result,
              car_price_rub: snapshot.car_price_rub,
              duty_rub: snapshot.duty_rub,
              fees_rub: snapshot.fees_rub,
              util_rub: snapshot.util_rub,
              freight_rub: snapshot.freight_rub,
              broker_rub: snapshot.broker_rub,
              total_rub: snapshot.total_rub,
            })),
          ),
        ],
      );
      console.log(JSON.stringify(written[0]));
    }

    console.log(JSON.stringify({
      dryRun,
      found: rows.length,
      updatedFromLatestSnapshot: snapshotAligned.length,
      recalculatedForCurrentSource: recalculated.length,
      rateSnapshot,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
