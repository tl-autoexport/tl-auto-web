import { config } from "dotenv";
import { calculateRuVladivostok } from "@/server/calc/ru";
import { CALC_VERSION } from "@/server/calc/ru";
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
  drive_type: string | null;
  badge: string | null;
  badge_detail: string | null;
  year: number | null;
  registration_month: number | null;
  price_krw: number | null;
  price_rub: number | null;
  engine_cc: number | null;
  power_hp: number | null;
  power_source: string | null;
  fuel_type: string | null;
  hybrid_dvs_power_hp: number | null;
  hybrid_electric_power_kw: number | null;
  hybrid_dvs_above_electric_30min: boolean | null;
  hybrid_sequential: boolean | null;
  calculation_power_kw: number | null;
  calculation_power_status: "unreviewed" | "matched" | "approved" | "review_required" | "not_applicable";
  power_basis: "combustion_engine" | "electric_30min" | "parallel_sum" | null;
};

type AutomaticPowerReference = {
  configuration_key: string;
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  badge: string | null;
  badge_detail: string | null;
  power_hp: number | null;
  power_kw: number | null;
  source: string;
  status: "automatic" | "confirmed" | "retired";
};

function referenceKey(car: Pick<CatalogCar, "brand" | "model" | "fuel_type" | "engine_cc" | "drive_type" | "badge" | "badge_detail">) {
  const normalize = (value: string | null) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [normalize(car.brand), normalize(car.model), normalize(car.fuel_type), car.engine_cc ?? "unknown", normalize(car.drive_type), normalize(car.badge), normalize(car.badge_detail)].join("|");
}

async function main() {
  const dryRun = process.env.RECALCULATE_DRY_RUN !== "false";
  const rateSnapshot = await getCbrCalcRates();
  const supabase = createSupabaseAdmin();
  const data: CatalogCar[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from("cars")
      .select(
        "id,primary_source,source_id,brand,model,drive_type,badge,badge_detail,year,registration_month,price_krw,price_rub,engine_cc,power_hp,fuel_type,hybrid_dvs_power_hp,hybrid_electric_power_kw,hybrid_dvs_above_electric_30min,hybrid_sequential,calculation_power_kw,calculation_power_status,power_basis",
      )
      .eq("is_available", true)
      .order("primary_source")
      .order("source_id")
      .range(from, from + 999);
    if (error) throw error;
    data.push(...((page ?? []) as CatalogCar[]));
    if (!page || page.length < 1000) break;
  }
  const { data: referenceRows, error: referenceError } = await supabase
    .from("vehicle_power_automatic_reference")
    .select("configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,power_hp,power_kw,source,status")
    .neq("status", "retired");
  if (referenceError) throw referenceError;
  const automaticReferences = new Map(
    ((referenceRows ?? []) as AutomaticPowerReference[]).map((row) => [row.configuration_key, row]),
  );

  const existingVersionIds = new Set<string>();
  if (!dryRun) {
    // PostgREST caps a single response at 1,000 rows. Paginate explicitly so
    // a partial previous run can be resumed without recalculating old cards.
    for (let from = 0; ; from += 1000) {
      const { data: existing, error: existingError } = await supabase
        .from("calc_snapshots")
        .select("car_id")
        .eq("calc_version", CALC_VERSION)
        .range(from, from + 999);
      if (existingError) throw existingError;
      for (const item of existing ?? []) existingVersionIds.add(item.car_id);
      if (!existing || existing.length < 1000) break;
    }
  }
  const force = process.env.RECALCULATE_FORCE === "true";
  const onlyApprovedPower = process.env.RECALCULATE_ONLY_APPROVED_POWER === "true";
  const onlyPowerChanged = process.env.RECALCULATE_ONLY_POWER_CHANGED === "true";
  const modelFilter = new Set(
    (process.env.RECALCULATE_MODELS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const idFilter = new Set((process.env.RECALCULATE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const eligible = onlyApprovedPower
    ? data.filter((car) => car.calculation_power_status === "matched" || car.calculation_power_status === "approved")
    : data;
  const filteredById = idFilter.size ? eligible.filter((car) => idFilter.has(car.id)) : eligible;
  const filtered = modelFilter.size
    ? filteredById.filter((car) => modelFilter.has(String(car.model ?? "").trim().toLowerCase()))
    : filteredById;
  const pending = force ? filtered : filtered.filter((car) => !existingVersionIds.has(car.id));
  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  const concurrency = Math.max(1, Number(process.env.RECALCULATE_CONCURRENCY ?? 10));
  async function processCar(car: CatalogCar) {
    // The provisional reference is used only for an exact configuration key.
    // Hybrid and EV legal branches retain their dedicated inputs until their
    // approved power basis is available.
    const approvedPowerKw = car.calculation_power_status === "matched" || car.calculation_power_status === "approved"
      ? car.calculation_power_kw
      : null;
    const reference = approvedPowerKw != null || car.fuel_type === "hybrid" || car.fuel_type === "electric"
      ? null
      : automaticReferences.get(referenceKey(car));
    const resolvedPowerHp = reference?.power_hp ?? car.power_hp;
    if (
      !car.price_krw ||
      !car.year ||
      !car.engine_cc ||
      (!approvedPowerKw && !resolvedPowerHp && !car.hybrid_dvs_power_hp)
    ) {
      return null;
    }

    const calc = calculateRuVladivostok({
      priceKrw: car.price_krw,
      year: car.year,
      month: car.registration_month ?? 6,
      engineCc: car.engine_cc,
      powerHp: resolvedPowerHp ?? undefined,
      // Confirmed power is passed directly in kW. This is the exact tariff
      // input: it avoids reconstructing a TKS boundary from a rounded hp value.
      powerKw: approvedPowerKw ?? undefined,
      hybridDvsPowerHp: car.hybrid_dvs_power_hp ?? undefined,
      hybridElectricPowerKw: car.hybrid_electric_power_kw ?? undefined,
      hybridDvsAboveElectric30Min: car.hybrid_dvs_above_electric_30min ?? undefined,
      hybridSequential: car.hybrid_sequential ?? undefined,
      fuelType: car.fuel_type ?? undefined,
      rates: rateSnapshot.rates,
      customsRates: rateSnapshot.customsRates,
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
      powerSource: approvedPowerKw != null ? "approved_power_spec" : reference ? "automatic_reference" : car.power_source,
      powerChanged: approvedPowerKw != null
        ? Math.abs(approvedPowerKw - (car.power_hp ?? 0) / 1.3596216173) > 0.01
        : reference != null && reference.power_hp !== car.power_hp,
    };

    if (onlyPowerChanged && !row.powerChanged) return null;

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
        .update({
          price_rub: Math.round(calc.totalRub),
          ...(reference
            ? {
                power_confidence: reference.status === "confirmed" ? "high" : "automatic",
                power_resolution_source: `automatic-reference:${reference.source}`,
                power_resolution_note: "Предварительное автоматическое сопоставление типовой конфигурации; требуется подтверждение комплектации.",
                power_resolved_at: new Date().toISOString(),
              }
            : {}),
        })
        .eq("id", car.id);
      if (updateError) throw updateError;

      const { error: snapshotError } = await supabase.from("calc_snapshots").insert({
        car_id: car.id,
        calc_version: calc.calcVersion,
        inputs: {
          ...car,
          resolvedPowerHp,
          approvedPowerKw,
          powerReference: reference?.configuration_key ?? null,
        },
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
    onlyApprovedPower,
    onlyPowerChanged,
    modelFilter: modelFilter.size ? [...modelFilter] : "all",
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
