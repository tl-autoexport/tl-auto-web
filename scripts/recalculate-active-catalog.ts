import { config } from "dotenv";
import { calculateRuVladivostok } from "@/server/calc/ru";
import { getCbrCalcRates } from "@/server/calc/rates";
import { createSupabaseAdmin } from "@/server/supabase/admin";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type CatalogCar = {
  id: string;
  primary_source: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  registration_month: number | null;
  price_krw: number | null;
  price_rub: number | null;
  engine_cc: number | null;
  power_hp: number | null;
  fuel_type: string | null;
};

async function main() {
  const dryRun = process.env.RECALCULATE_DRY_RUN !== "false";
  const rateSnapshot = await getCbrCalcRates();
  const supabase = createSupabaseAdmin();
  const data: CatalogCar[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from("cars")
      .select(
        "id,primary_source,source_id,brand,model,year,registration_month,price_krw,price_rub,engine_cc,power_hp,fuel_type",
      )
      .eq("is_available", true)
      .order("primary_source")
      .order("source_id")
      .range(from, from + 999);
    if (error) throw error;
    data.push(...((page ?? []) as CatalogCar[]));
    if (!page || page.length < 1000) break;
  }

  const existingVersionIds = new Set<string>();
  if (!dryRun) {
    const { data: existing, error: existingError } = await supabase
      .from("calc_snapshots")
      .select("car_id")
      .eq("calc_version", "ru-individual-autoexport-tks-usdt-2026.01")
      .limit(10000);
    if (existingError) throw existingError;
    for (const item of existing ?? []) existingVersionIds.add(item.car_id);
  }
  const force = process.env.RECALCULATE_FORCE === "true";
  const pending = force ? data : data.filter((car) => !existingVersionIds.has(car.id));
  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  const concurrency = Math.max(1, Number(process.env.RECALCULATE_CONCURRENCY ?? 10));
  async function processCar(car: CatalogCar) {
    if (
      !car.price_krw ||
      !car.year ||
      !car.engine_cc ||
      !car.power_hp
    ) {
      return null;
    }

    const calc = calculateRuVladivostok({
      priceKrw: car.price_krw,
      year: car.year,
      month: car.registration_month ?? 6,
      engineCc: car.engine_cc,
      powerHp: car.power_hp,
      fuelType: car.fuel_type ?? undefined,
      rates: rateSnapshot.rates,
      ratesAsOf: rateSnapshot.asOf,
      ratesSource: rateSnapshot.source,
      rateDetails: rateSnapshot.rateDetails,
    });
    const oldPriceRub = car.price_rub;
    const row = {
      source: car.primary_source,
      sourceId: car.source_id,
      car: [car.brand, car.model].filter(Boolean).join(" "),
      oldPriceRub,
      newPriceRub: calc.totalRub,
      changeRub: oldPriceRub == null ? null : calc.totalRub - oldPriceRub,
      changePct:
        oldPriceRub == null
          ? null
          : Number((((calc.totalRub - oldPriceRub) / oldPriceRub) * 100).toFixed(2)),
      dutyRub: calc.dutyRub,
      feesRub: calc.feesRub,
      utilRub: calc.utilRub,
    };

    if (!dryRun) {
      const { error: leadError } = await supabase
        .from("leads")
        .update({ calc_snapshot_id: null })
        .eq("car_id", car.id);
      if (leadError) throw leadError;

      const { error: cleanupError } = await supabase
        .from("calc_snapshots")
        .delete()
        .eq("car_id", car.id);
      if (cleanupError) throw cleanupError;

      const { error: updateError } = await supabase
        .from("cars")
        .update({ price_rub: Math.round(calc.totalRub) })
        .eq("id", car.id);
      if (updateError) throw updateError;

      const { error: snapshotError } = await supabase.from("calc_snapshots").insert({
        car_id: car.id,
        calc_version: calc.calcVersion,
        inputs: car,
        rates: {
          ...calc.rates,
          asOf: calc.ratesAsOf,
          source: calc.ratesSource,
          details: calc.rateDetails,
        },
        result: calc,
        car_price_rub: Math.round(calc.carPriceRub),
        duty_rub: Math.round(calc.dutyRub),
        fees_rub: Math.round(calc.feesRub),
        util_rub: Math.round(calc.utilRub),
        freight_rub: Math.round(calc.freightRub),
        broker_rub: Math.round(calc.brokerRub),
        total_rub: Math.round(calc.totalRub),
      });
      if (snapshotError) throw snapshotError;
    }
    return row;
  }

  for (let offset = 0; offset < pending.length; offset += concurrency) {
    const batch = pending.slice(offset, offset + concurrency);
    const batchRows = await Promise.all(batch.map(processCar));
    for (const row of batchRows) if (row) rows.push(row);
    skipped += batchRows.filter((row) => !row).length;
    console.error(`Recalculated ${Math.min(offset + batch.length, pending.length)}/${pending.length}`);
  }

  const summary = {
    dryRun,
    rateSnapshot,
    recalculated: rows.length,
    alreadyProcessed: existingVersionIds.size,
    skipped,
  };
  console.log(JSON.stringify(
    process.env.RECALCULATE_SUMMARY === "true" ? summary : { ...summary, rows },
    null,
    2,
  ));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
