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
  const { data, error } = await supabase
    .from("cars")
    .select(
      "id,primary_source,source_id,brand,model,year,registration_month,price_krw,price_rub,engine_cc,power_hp,fuel_type",
    )
    .eq("is_available", true)
    .order("primary_source")
    .order("source_id");
  if (error) throw error;

  const rows = [];
  let skipped = 0;
  for (const car of (data ?? []) as CatalogCar[]) {
    if (
      !car.price_krw ||
      !car.year ||
      !car.engine_cc ||
      !car.power_hp ||
      (car.fuel_type !== "gasoline" && car.fuel_type !== "diesel")
    ) {
      skipped += 1;
      continue;
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
    });
    const oldPriceRub = car.price_rub;
    rows.push({
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
    });

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from("cars")
        .update({ price_rub: calc.totalRub })
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
        },
        result: calc,
        car_price_rub: calc.carPriceRub,
        duty_rub: calc.dutyRub,
        fees_rub: calc.feesRub,
        util_rub: calc.utilRub,
        freight_rub: calc.freightRub,
        broker_rub: calc.brokerRub,
        total_rub: calc.totalRub,
      });
      if (snapshotError) throw snapshotError;
    }
  }

  console.log(JSON.stringify({
    dryRun,
    rateSnapshot,
    recalculated: rows.length,
    skipped,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
