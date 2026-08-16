import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { calculateRu } from "/Users/koreakim/Developer/autoexport/src/lib/calculator/engine.ts";

config({ path: "/Users/koreakim/Developer/tl-auto/.env.local", quiet: true });

type Car = {
  id: string;
  source_id: string;
  primary_source: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  registration_month: number | null;
  price_krw: number | null;
  engine_cc: number | null;
  power_hp: number | null;
  fuel_type: string | null;
};

type Snapshot = {
  car_id: string;
  calculated_at: string;
  total_rub: number | null;
  car_price_rub: number | null;
  duty_rub: number | null;
  fees_rub: number | null;
  util_rub: number | null;
  result: { rates?: { krwRub?: number; eurRub?: number; usdRub?: number } } | null;
};

async function paged<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function percentage(delta: number, base: number | null) {
  return base ? Number(((delta / base) * 100).toFixed(3)) : null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("TL Auto Supabase secret key is not configured");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const cars = await paged<Car>((from, to) => supabase
    .from("cars")
    .select("id,source_id,primary_source,brand,model,year,registration_month,price_krw,engine_cc,power_hp,fuel_type")
    .eq("primary_source", "encar")
    .range(from, to));
  const snapshots = await paged<Snapshot>((from, to) => supabase
    .from("calc_snapshots")
    .select("car_id,calculated_at,total_rub,car_price_rub,duty_rub,fees_rub,util_rub,result")
    .order("calculated_at", { ascending: false })
    .range(from, to));

  const latest = new Map<string, Snapshot>();
  for (const snapshot of snapshots) if (!latest.has(snapshot.car_id)) latest.set(snapshot.car_id, snapshot);

  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const car of cars) {
    const snapshot = latest.get(car.id);
    if (!snapshot || !car.price_krw || !car.year || !car.engine_cc || !car.power_hp || snapshot.total_rub == null) {
      skipped += 1;
      continue;
    }
    const rates = snapshot.result?.rates;
    const bot = calculateRu({
      priceKrw: car.price_krw,
      year: car.year,
      month: car.registration_month ?? 6,
      engineCc: car.engine_cc,
      powerHp: car.power_hp,
      fuelType: car.fuel_type ?? undefined,
      rates: {
        krwRub: rates?.krwRub ?? 0.050135,
        eurRub: rates?.eurRub ?? 88.707,
        usdRub: rates?.usdRub ?? 77.929,
        source: "TL snapshot",
      },
    });
    const deltaRub = Number((bot.totalRub - snapshot.total_rub).toFixed(2));
    rows.push({
      sourceId: car.source_id,
      car: [car.brand, car.model, car.year].filter(Boolean).join(" "),
      tlRub: snapshot.total_rub,
      botRub: bot.totalRub,
      deltaRub,
      deltaPct: percentage(deltaRub, snapshot.total_rub),
      components: {
        dutyRub: snapshot.duty_rub == null ? null : Number((bot.customsDutyRub - snapshot.duty_rub).toFixed(2)),
        feesRub: snapshot.fees_rub == null ? null : Number((bot.customsFeeRub - snapshot.fees_rub).toFixed(2)),
        utilRub: snapshot.util_rub == null ? null : Number((bot.utilRub - snapshot.util_rub).toFixed(2)),
      },
    });
  }

  const absolute = rows.map((row) => Math.abs(Number(row.deltaPct))).sort((a, b) => a - b);
  const overOne = rows.filter((row) => Math.abs(Number(row.deltaPct)) > 1).length;
  const overFive = rows.filter((row) => Math.abs(Number(row.deltaPct)) > 5).length;
  const largest = [...rows].sort((a, b) => Math.abs(Number(b.deltaRub)) - Math.abs(Number(a.deltaRub))).slice(0, 20);
  console.log(JSON.stringify({
    source: "TL Auto catalog vs AutoExport Bot Calculator engine",
    readOnly: true,
    carsInCatalog: cars.length,
    snapshotsAvailable: latest.size,
    checked: rows.length,
    skipped,
    meanAbsolutePct: Number((absolute.reduce((sum, value) => sum + value, 0) / Math.max(absolute.length, 1)).toFixed(3)),
    medianAbsolutePct: absolute.length ? absolute[Math.floor(absolute.length / 2)] : null,
    overOnePercent: overOne,
    overFivePercent: overFive,
    largestDifferences: largest,
    tksNote: "Live TKS endpoint returned CAPTCHA during audit; no automated bypass was attempted.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
