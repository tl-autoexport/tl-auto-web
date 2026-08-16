import { config } from "dotenv";
import { calculateRuVladivostok } from "@/server/calc/ru";
import { getCbrCalcRates } from "@/server/calc/rates";
import { createSupabaseAdmin } from "@/server/supabase/admin";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const KOREX_CALCULATOR_URL =
  "https://korex-auto.com/netcat/modules/default/classes/calculator/actions/calculate.php";

type CatalogCar = {
  primary_source: string;
  source_id: string;
  brand: string | null;
  model: string | null;
  year: number;
  registration_month: number | null;
  price_krw: number;
  engine_cc: number;
  power_hp: number;
  fuel_type: string | null;
};

function rublesFromClass(html: string, className: string): number {
  const match = html.match(
    new RegExp(`class="${className}"[^>]*>\\s*([\\d\\s]+)`, "i"),
  );
  if (!match) throw new Error(`Korex response has no ${className}`);
  return Number(match[1].replace(/\s/g, ""));
}

function fuelCode(fuelType: string | null): string {
  if (fuelType === "diesel") return "d";
  if (fuelType === "hybrid") return "be";
  return "b";
}

async function fetchKorex(car: CatalogCar, age: number) {
  const body = new URLSearchParams({
    strategy: "auto_koreya",
    html: "1",
    user: "1",
    ncst: "0",
    currency: "KRW",
    auc_text: "в Корее",
    price: String(car.price_krw),
    fiz: "1",
    m: fuelCode(car.fuel_type),
    age: String(age),
    v: String(car.engine_cc),
    p: String(car.power_hp),
  });
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(KOREX_CALCULATOR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 TL Auto price audit",
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(`Korex request failed with ${response.status}`);
      const html = await response.text();
      return {
        totalRub: rublesFromClass(html, "js-calc-full-price"),
        dutyRub: rublesFromClass(html, "js-calc-full-duty"),
        feesRub: rublesFromClass(html, "js-calc-full-fees"),
        utilRub: rublesFromClass(html, "js-calc-util"),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }

  throw lastError;
}

async function main() {
  const supabase = createSupabaseAdmin();
  const rateSnapshot = await getCbrCalcRates();
  const { data, error } = await supabase
    .from("cars")
    .select(
      "primary_source,source_id,brand,model,year,registration_month,price_krw,engine_cc,power_hp,fuel_type",
    )
    .eq("is_available", true)
    .in("fuel_type", ["gasoline", "diesel"])
    .order("primary_source")
    .order("source_id");
  if (error) throw error;

  const rows = [];
  for (const car of (data ?? []) as CatalogCar[]) {
    const ours = calculateRuVladivostok({
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
    const age =
      ours.carAgeYears < 3
        ? 2
        : ours.currentCarAgeYears <= 5
          ? 4
          : ours.currentCarAgeYears <= 7
            ? 6
            : 8;
    const korex = await fetchKorex(car, age);
    const differenceRub = ours.totalRub - korex.totalRub;
    rows.push({
      source: car.primary_source,
      sourceId: car.source_id,
      car: [car.brand, car.model].filter(Boolean).join(" "),
      oursRub: ours.totalRub,
      korexRub: korex.totalRub,
      differenceRub,
      differencePct: Number(
        ((differenceRub / korex.totalRub) * 100).toFixed(3),
      ),
      components: {
        dutyRub: ours.dutyRub - korex.dutyRub,
        feesRub: ours.feesRub - korex.feesRub,
        utilRub: ours.utilRub - korex.utilRub,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const errors = rows
    .map((row) => Math.abs(row.differencePct))
    .sort((a, b) => a - b);
  const largestDifferences = [...rows]
    .sort(
      (left, right) =>
        Math.abs(right.differencePct) - Math.abs(left.differencePct),
    )
    .slice(0, 20);
  const outliersOverOnePercent = largestDifferences.filter(
    (row) => Math.abs(row.differencePct) > 1,
  );
  console.log(
    JSON.stringify(
      {
        checked: rows.length,
        cbrRateDate: rateSnapshot.asOf,
        meanAbsolutePct: Number(
          (
            errors.reduce((sum, value) => sum + value, 0) / errors.length
          ).toFixed(3),
        ),
        medianAbsolutePct: errors[Math.floor(errors.length / 2)],
        maxAbsolutePct: errors.at(-1),
        withinHalfPercent: errors.filter((value) => value <= 0.5).length,
        withinOnePercent: errors.filter((value) => value <= 1).length,
        outliersOverOnePercent,
        largestDifferences,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
