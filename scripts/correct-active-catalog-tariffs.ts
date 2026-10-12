/**
 * One-off migration of active RU individual-import calculation snapshots to
 * CALC_VERSION. Preserves prior inputs, exchange rates and clearance date.
 *
 * Run: npx tsx scripts/correct-active-catalog-tariffs.ts (read-only report).
 * Set TARIFF_CORRECTION_WRITE=true explicitly to insert replacement snapshots,
 * update catalog prices and repoint leads referencing the replaced snapshots.
 * Old snapshots are retained. Writes are transactional and refuse partial
 * coverage or a catalog that changed since the input snapshots were read.
 * Already-corrected snapshots are skipped in dry-run; write mode refuses them.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok, CALC_VERSION } from "../src/server/calc/ru";
import { electricRecalculationPowerKw } from "../src/server/cars/recalculation-power";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const DAY_MS = 24 * 60 * 60 * 1000;
const WRITE = process.env.TARIFF_CORRECTION_WRITE === "true";
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

type SnapshotRow = {
  car_id: string;
  primary_source: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  price_krw: number | string | null;
  price_rub: number | string | null;
  old_snapshot_id: string;
  old_calc_version: string;
  old_calculated_at: string;
  country_code: "RU";
  destination_city: string;
  importer_type: "individual";
  inputs: Record<string, unknown>;
  rates: Record<string, unknown>;
  old_result: Record<string, unknown>;
};

type WriteRow = {
  id: string;
  car_id: string;
  primary_source: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  old_snapshot_id: string;
  old_price_rub: number | null;
  price_rub: number;
  country_code: string;
  destination_city: string;
  importer_type: string;
  calc_version: string;
  inputs: Record<string, unknown>;
  rates: Record<string, unknown>;
  result: ReturnType<typeof calculateRuVladivostok>;
  calculated_at: string;
};

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");
  await client.connect();
  try {
    const { rows } = await client.query<SnapshotRow>(`
      select c.id as car_id, c.primary_source, c.source_id, c.brand, c.model,
             c.price_krw, c.price_rub, s.id as old_snapshot_id, s.calc_version as old_calc_version,
             s.calculated_at as old_calculated_at, s.country_code,
             s.destination_city, s.importer_type, s.inputs, s.rates,
             s.result as old_result
        from public.cars c
        join lateral (
          select x.* from public.calc_snapshots x
           where x.car_id = c.id
           order by x.calculated_at desc, x.created_at desc
           limit 1
        ) s on true
       where c.is_available = true
         and s.country_code = 'RU'
         and s.importer_type = 'individual'
       order by c.id
    `);

    const toWrite: WriteRow[] = [];
    const skipped: Array<{ carId: string; sourceId: string; reason: string }> = [];
    for (const row of rows) {
      if (row.old_calc_version === CALC_VERSION) {
        skipped.push({ carId: row.car_id, sourceId: row.source_id, reason: "already has corrected calculation version" });
        continue;
      }
      const { inputs, rates, old_result: oldResult } = row;
      const priceKrw = Number(inputs.price_krw);
      const year = Number(inputs.year);
      const engineCc = inputs.engine_cc == null ? null : Number(inputs.engine_cc);
      const storedHp = inputs.resolvedPowerHp ?? inputs.power_hp;
      const powerHp = storedHp == null ? undefined : Number(storedHp);
      const approvedPowerKw = inputs.approvedPowerKw == null ? null : Number(inputs.approvedPowerKw);
      const evPowerKw = electricRecalculationPowerKw({
        fuel_type: String(inputs.fuel_type ?? ""),
        power_basis: String(inputs.power_basis ?? ""),
        calculation_power_status: String(inputs.calculation_power_status ?? ""),
        calculation_power_kw: inputs.calculation_power_kw == null ? null : Number(inputs.calculation_power_kw),
      });
      const powerKw = approvedPowerKw ?? evPowerKw ?? undefined;
      if (!(priceKrw > 0) || !(year > 1900) || (engineCc == null && inputs.fuel_type !== "electric") ||
          ((powerHp == null || !Number.isFinite(powerHp)) && powerKw == null && inputs.hybrid_dvs_power_hp == null)) {
        skipped.push({ carId: row.car_id, sourceId: row.source_id, reason: "missing required input in previous snapshot" });
        continue;
      }

      const estimatedClearanceDate = new Date(String(oldResult.estimatedClearanceDate));
      const oldCalculatedAt = new Date(row.old_calculated_at);
      if (Number.isNaN(estimatedClearanceDate.getTime()) || Number.isNaN(oldCalculatedAt.getTime())) {
        skipped.push({ carId: row.car_id, sourceId: row.source_id, reason: "missing calculation date" });
        continue;
      }
      const clearanceDays = Math.max(0, Math.round((estimatedClearanceDate.getTime() - oldCalculatedAt.getTime()) / DAY_MS));
      // Recover the exact prior calculation timestamp from the saved ETA so the
      // age bracket remains unchanged; calculated_at itself is written after calculation.
      const calculationDate = new Date(estimatedClearanceDate.getTime() - clearanceDays * DAY_MS).toISOString();
      const rateDetails = (oldResult.rateDetails ?? rates.details ?? undefined) as Parameters<typeof calculateRuVladivostok>[0]["rateDetails"];
      const calculation = calculateRuVladivostok({
        priceKrw,
        year,
        month: Number(inputs.registration_month ?? 6),
        engineCc,
        powerHp,
        powerKw,
        hybridDvsPowerHp: inputs.hybrid_dvs_power_hp == null ? undefined : Number(inputs.hybrid_dvs_power_hp),
        hybridDvsPowerKw: inputs.hybrid_dvs_power_kw == null ? undefined : Number(inputs.hybrid_dvs_power_kw),
        hybridElectricPowerKw: inputs.hybrid_electric_power_kw == null ? undefined : Number(inputs.hybrid_electric_power_kw),
        hybridDvsAboveElectric30Min: inputs.hybrid_dvs_above_electric_30min == null ? undefined : Boolean(inputs.hybrid_dvs_above_electric_30min),
        hybridSequential: inputs.hybrid_sequential == null ? undefined : Boolean(inputs.hybrid_sequential),
        fuelType: inputs.fuel_type == null ? undefined : String(inputs.fuel_type),
        destinationCity: row.destination_city,
        rates: {
          krwRub: Number(rates.krwRub),
          eurRub: Number(rates.eurRub),
          usdRub: Number(rates.usdRub),
          kztRub: Number(rates.kztRub),
        },
        customsRates: oldResult.customsRates as Parameters<typeof calculateRuVladivostok>[0]["customsRates"],
        ratesAsOf: oldResult.ratesAsOf == null ? null : String(oldResult.ratesAsOf),
        ratesSource: String(oldResult.ratesSource ?? rates.source ?? "provided-or-default"),
        rateDetails,
        calculationDate,
        clearanceDays,
      });
      toWrite.push({
        id: randomUUID(),
        car_id: row.car_id,
        primary_source: row.primary_source,
        source_id: row.source_id,
        brand: row.brand,
        model: row.model,
        old_snapshot_id: row.old_snapshot_id,
        old_price_rub: row.price_rub == null ? null : Number(row.price_rub),
        price_rub: Math.round(calculation.totalRub),
        country_code: row.country_code,
        destination_city: row.destination_city,
        importer_type: row.importer_type,
        calc_version: CALC_VERSION,
        inputs,
        rates,
        result: calculation,
        calculated_at: new Date().toISOString(),
      });
    }

    const changes = toWrite.map((item) => ({
      carId: item.car_id,
      priceRubBefore: item.old_price_rub,
      priceRubAfter: item.price_rub,
      deltaRub: item.old_price_rub == null ? null : item.price_rub - item.old_price_rub,
      dutyRub: item.result.dutyRub,
      feesRub: item.result.feesRub,
      mode: item.result.customs.mode,
    }));
    const deltas = changes.map((item) => item.deltaRub).filter((item): item is number => item != null);
    const summary = {
      dryRun: !WRITE,
      calcVersion: CALC_VERSION,
      activeCandidates: rows.length,
      recalculated: toWrite.length,
      skipped: skipped.length,
      totalDeltaRub: deltas.reduce((sum, value) => sum + value, 0),
      deltaRub: {
        min: deltas.length ? Math.min(...deltas) : null,
        max: deltas.length ? Math.max(...deltas) : null,
      },
      changeCounts: {
        decreased: deltas.filter((value) => value < 0).length,
        unchanged: changes.filter((item) => item.deltaRub === 0).length,
        increased: deltas.filter((value) => value > 0).length,
      },
      bySource: Object.fromEntries([...new Set(toWrite.map((row) => row.primary_source))].map((source) => {
        const sourceRows = toWrite.filter((item) => item.primary_source === source);
        const sourceDeltas = sourceRows.map((item) => item.old_price_rub == null ? 0 : item.price_rub - item.old_price_rub);
        return [source, { count: sourceRows.length, totalDeltaRub: sourceDeltas.reduce((sum, value) => sum + value, 0) }];
      })),
      rollsRoyceGhost: toWrite.filter((item) => item.source_id === "38595395").map((item) => ({
        carId: item.car_id,
        oldRub: item.old_price_rub,
        newRub: item.price_rub,
        deltaRub: item.old_price_rub == null ? null : item.price_rub - item.old_price_rub,
        dutyRub: item.result.dutyRub,
        feesRub: item.result.feesRub,
        totalRubExact: item.result.totalRub,
      })),
      sample: toWrite.slice(0, 5).map((item) => ({
        carId: item.car_id,
        oldRub: item.old_price_rub,
        newRub: item.price_rub,
        dutyRub: item.result.dutyRub,
        feesRub: item.result.feesRub,
        mode: item.result.customs.mode,
      })),
      skippedSamples: skipped.slice(0, 10),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!WRITE) return;
    if (skipped.length || toWrite.length !== rows.length) {
      throw new Error(`Refusing write: recalculated ${toWrite.length}/${rows.length}; skipped ${skipped.length}`);
    }

    await client.query("begin");
    try {
      await client.query(`create temporary table tariff_correction_rows (
        id uuid primary key, car_id uuid not null, old_snapshot_id uuid not null,
        old_price_rub bigint, price_rub bigint not null, country_code text not null,
        destination_city text not null, importer_type text not null, calc_version text not null,
        inputs jsonb not null, rates jsonb not null, result jsonb not null, calculated_at timestamptz not null
      ) on commit drop`);
      await client.query(`insert into tariff_correction_rows
        select * from jsonb_to_recordset($1::jsonb) as x(
          id uuid, car_id uuid, old_snapshot_id uuid, old_price_rub bigint, price_rub bigint,
          country_code text, destination_city text, importer_type text, calc_version text,
          inputs jsonb, rates jsonb, result jsonb, calculated_at timestamptz
        )`, [JSON.stringify(toWrite)]);

      const current = await client.query(`
        select count(*)::int as count
          from tariff_correction_rows r
          join public.cars c on c.id = r.car_id and c.is_available = true
          join lateral (
            select x.id from public.calc_snapshots x where x.car_id = c.id
             order by x.calculated_at desc, x.created_at desc limit 1
          ) latest on latest.id = r.old_snapshot_id
         where c.price_rub is not distinct from r.old_price_rub
      `);
      if (current.rows[0].count !== toWrite.length) throw new Error(`Catalog changed during calculation: matched ${current.rows[0].count}/${toWrite.length}`);

      const inserted = await client.query(`
        insert into public.calc_snapshots (
          id, car_id, country_code, destination_city, importer_type, calc_version,
          inputs, rates, result, car_price_rub, duty_rub, fees_rub, util_rub,
          freight_rub, broker_rub, total_rub, calculated_at
        )
        select r.id, r.car_id, r.country_code, r.destination_city, r.importer_type, r.calc_version,
               r.inputs, r.rates, r.result, round((r.result->>'carPriceRub')::numeric),
               round((r.result->>'dutyRub')::numeric), round((r.result->>'feesRub')::numeric),
               round((r.result->>'utilRub')::numeric), round((r.result->>'freightRub')::numeric),
               round((r.result->>'brokerRub')::numeric), round((r.result->>'totalRub')::numeric), r.calculated_at
          from tariff_correction_rows r
        returning id
      `);
      if (inserted.rowCount !== toWrite.length) throw new Error(`Inserted ${inserted.rowCount}/${toWrite.length} snapshots`);

      const updatedCars = await client.query(`
        update public.cars c set price_rub = r.price_rub
          from tariff_correction_rows r where c.id = r.car_id and c.is_available = true
      `);
      if (updatedCars.rowCount !== toWrite.length) throw new Error(`Updated ${updatedCars.rowCount}/${toWrite.length} cars`);

      await client.query(`update public.leads l set calc_snapshot_id = r.id
        from tariff_correction_rows r where l.calc_snapshot_id = r.old_snapshot_id`);
      await client.query("commit");
      console.log(JSON.stringify({ writeComplete: true, snapshotsInserted: inserted.rowCount, carsUpdated: updatedCars.rowCount }));
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
