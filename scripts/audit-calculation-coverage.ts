import { config } from "dotenv";
import { createSupabaseAdmin } from "@/server/supabase/admin";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const CURRENT_VERSION = "ru-individual-autoexport-tks-usdt-2026.01";

type Car = {
  id: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  price_krw: number | null;
  year: number | null;
  engine_cc: number | null;
  power_hp: number | null;
};

type Snapshot = {
  car_id: string;
  calc_version: string;
  calculated_at: string;
  result: { koreaExpensesRub?: unknown; rateDetails?: unknown } | null;
};

async function fetchAllCars() {
  const supabase = createSupabaseAdmin();
  const rows: Car[] = [];
  for (let from = 0; ; from += 1000) {
    const query = supabase
      .from("cars")
      .select("id,source_id,brand,model,price_krw,year,engine_cc,power_hp")
      .eq("is_available", true)
      .range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as Car[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function fetchAllSnapshots() {
  const supabase = createSupabaseAdmin();
  const rows: Snapshot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("calc_snapshots")
      .select("car_id,calc_version,calculated_at,result")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Snapshot[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function main() {
  const [cars, snapshots] = await Promise.all([
    fetchAllCars(),
    fetchAllSnapshots(),
  ]);
  const byCar = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    const current = byCar.get(snapshot.car_id);
    if (!current || snapshot.calculated_at > current.calculated_at) byCar.set(snapshot.car_id, snapshot);
  }
  const missingInputs: Car[] = [];
  const missingSnapshot: Car[] = [];
  const outdated: Array<{ car: Car; snapshot: Snapshot }> = [];
  const missingRateDetails: Array<{ car: Car; snapshot: Snapshot }> = [];
  const missingKoreaExpenses: Array<{ car: Car; snapshot: Snapshot }> = [];

  for (const car of cars) {
    if (!car.price_krw || !car.year || !car.engine_cc || !car.power_hp) {
      missingInputs.push(car);
      continue;
    }
    const snapshot = byCar.get(car.id);
    if (!snapshot) {
      missingSnapshot.push(car);
      continue;
    }
    if (snapshot.calc_version !== CURRENT_VERSION) outdated.push({ car, snapshot });
    if (!snapshot.result?.rateDetails) missingRateDetails.push({ car, snapshot });
    if (!Number(snapshot.result?.koreaExpensesRub)) missingKoreaExpenses.push({ car, snapshot });
  }
  const sample = (items: Array<Car | { car: Car }>) => items.slice(0, 20).map((item) => {
    const car = "car" in item ? item.car : item;
    return { sourceId: car.source_id, car: [car.brand, car.model].filter(Boolean).join(" ") };
  });
  console.log(JSON.stringify({
    currentVersion: CURRENT_VERSION,
    activeCars: cars.length,
    latestSnapshots: byCar.size,
    eligibleForCalculation: cars.length - missingInputs.length,
    missingInputs: { count: missingInputs.length, sample: sample(missingInputs) },
    missingSnapshot: { count: missingSnapshot.length, sample: sample(missingSnapshot) },
    outdated: { count: outdated.length, sample: sample(outdated) },
    missingRateDetails: { count: missingRateDetails.length, sample: sample(missingRateDetails) },
    missingKoreaExpenses: { count: missingKoreaExpenses.length, sample: sample(missingKoreaExpenses) },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
