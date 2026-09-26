import { config } from "dotenv";
import { createSupabaseAdmin } from "../src/server/supabase/admin";
import { evaluatePublication, type PublicationCandidate } from "../src/server/cars/calculation-contract";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type ContractCar = {
  id: string;
  price_rub: number | null;
  calculation_power_status: string | null;
  calculation_power_kw: number | null;
  calculation_power_spec_id: string | null;
  power_basis: string | null;
  power_confidence: string | null;
  power_resolution_source: string | null;
  calculation_month: number | null;
  fuel_type: string | null;
  hybrid_dvs_power_hp: number | null;
  legacy_calculation_status: string | null;
};

type SupabaseError = { code?: string; message?: string; details?: string | null; hint?: string | null };

function throwQueryError(operation: string, error: SupabaseError): never {
  throw new Error(`${operation}: ${JSON.stringify({
    code: error.code ?? null,
    message: error.message ?? "Unknown Supabase error",
    details: error.details ?? null,
    hint: error.hint ?? null,
  })}`);
}

async function main() {
  const supabase = createSupabaseAdmin();
  const pageSize = 1_000;
  const cars: ContractCar[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("cars")
      .select(
        "id, price_rub, calculation_power_status, calculation_power_kw, calculation_power_spec_id, power_basis, power_confidence, power_resolution_source, calculation_month, fuel_type, hybrid_dvs_power_hp, legacy_calculation_status",
      )
      .eq("is_available", true)
      .in("primary_source", ["encar", "chestny_prigon"])
      .in("fuel_type", ["gasoline", "diesel", "hybrid", "electric"])
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throwQueryError(`Reading private calculation fields at offset ${offset}`, error);
    const batch = (data ?? []) as ContractCar[];
    cars.push(...batch);
    if (batch.length < pageSize) break;
  }

  const snapshotCarIds = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("calc_snapshots")
      .select("car_id")
      .order("car_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throwQueryError(`Reading calculation snapshots at offset ${offset}`, error);
    const batch = (data ?? []) as Array<{ car_id: string }>;
    for (const row of batch) snapshotCarIds.add(row.car_id);
    if (batch.length < pageSize) break;
  }

  const failures = new Map<string, number>();
  const snapshotSuspects: string[] = [];
  let checked = 0;
  let preliminary = 0;
  for (const car of cars) {
    if (car.price_rub == null) continue;
    checked++;
    const candidate: PublicationCandidate = {
      priceRub: car.price_rub,
      hasSnapshot: snapshotCarIds.has(car.id),
      calculationPowerStatus: car.calculation_power_status,
      calculationPowerKw: car.calculation_power_kw,
      powerBasis: car.power_basis,
      powerResolutionSource: car.power_resolution_source,
      calculationMonth: car.calculation_month,
      fuelType: car.fuel_type,
      hybridDvsPowerHp: car.hybrid_dvs_power_hp,
      powerConfidence: car.power_confidence,
      calculationPowerSpecId: car.calculation_power_spec_id,
      legacyCalculationStatus: car.legacy_calculation_status,
    };
    const verdict = evaluatePublication(candidate);
    if (!verdict.ok) {
      if (verdict.blockers.includes("snapshot_missing")) snapshotSuspects.push(car.id);
      for (const blocker of verdict.blockers) failures.set(blocker, (failures.get(blocker) ?? 0) + 1);
    } else if (verdict.finality === "preliminary") {
      preliminary++;
    }
  }

  let snapshotRaceResolved = 0;
  if (snapshotSuspects.length) {
    const confirmed = new Set<string>();
    for (let index = 0; index < snapshotSuspects.length; index += 100) {
      const { data, error } = await supabase
        .from("calc_snapshots")
        .select("car_id")
        .in("car_id", snapshotSuspects.slice(index, index + 100));
      if (error) throwQueryError(`Rechecking suspected missing snapshots at index ${index}`, error);
      for (const row of (data ?? []) as Array<{ car_id: string }>) confirmed.add(row.car_id);
    }
    snapshotRaceResolved = confirmed.size;
    const remaining = Math.max(0, (failures.get("snapshot_missing") ?? 0) - confirmed.size);
    if (remaining) failures.set("snapshot_missing", remaining);
    else failures.delete("snapshot_missing");
  }

  const report = {
    checked,
    withSnapshot: snapshotCarIds.size,
    snapshotRaceResolved,
    preliminary,
    failures: Object.fromEntries(failures),
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.size) {
    const detail = [...failures.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ");
    throw new Error(`Catalog publication contract is violated (${detail})`);
  }
  console.log("Catalog publication contract audit passed");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
