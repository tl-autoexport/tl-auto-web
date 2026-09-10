import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Car = {
  id: string;
  brand: string | null;
  model: string | null;
  badge: string | null;
  badge_detail: string | null;
  trim: string | null;
  year: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  drive_type: string | null;
  power_hp: number | null;
  power_source: string | null;
  price_krw: number | null;
  price_rub: number | null;
};

type CurrentConfidence = "declared_verified" | "mapped" | "automatic" | "missing";

/**
 * This is deliberately an audit of the CURRENT catalogue, not a claim that
 * existing maps have official evidence. Only a future approved DB spec can
 * receive the final `official` confidence level.
 */
function currentConfidence(source: string | null, powerHp: number | null): CurrentConfidence {
  if (!powerHp) return "missing";
  if (source === "engine_fallback") return "automatic";
  if (source?.includes("verified") || source?.includes("official")) return "declared_verified";
  return "mapped";
}

function identityKey(car: Car) {
  return [
    car.brand ?? "unknown-brand",
    car.model ?? "unknown-model",
    car.fuel_type ?? "unknown-fuel",
    car.engine_cc ?? "unknown-cc",
    car.drive_type ?? "unknown-drive",
  ].join(" | ");
}

function configurationKey(car: Car) {
  return [
    identityKey(car),
    car.badge_detail ?? car.badge ?? car.trim ?? "unknown-trim",
  ].join(" | ");
}

function riskWeight(confidence: CurrentConfidence) {
  if (confidence === "missing") return 4;
  if (confidence === "automatic") return 3;
  if (confidence === "mapped") return 2;
  return 1;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<Car>(
      `select id, brand, model, badge, badge_detail, trim, year, engine_cc, fuel_type, drive_type,
              power_hp, power_source, price_krw, price_rub
       from public.cars
       where is_available = true
       order by id`,
    );
    const cars = result.rows;
    const confidenceCounts: Record<CurrentConfidence, number> = {
      declared_verified: 0,
      mapped: 0,
      automatic: 0,
      missing: 0,
    };
    const sourceCounts = new Map<string, number>();
    const queue = new Map<string, {
      identity: string;
      confidence: CurrentConfidence;
      cars: number;
      priceKrw: number;
      sample: Car[];
      years: Set<number>;
      powerValues: Set<number>;
      sources: Set<string>;
    }>();

    for (const car of cars) {
      const confidence = currentConfidence(car.power_source, car.power_hp);
      confidenceCounts[confidence] += 1;
      const source = car.power_source ?? "missing";
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      // This key deliberately includes the Encar grade/badge: model + engine
      // alone can contain several power variants, especially Mercedes/BMW.
      const key = configurationKey(car);
      const item = queue.get(key) ?? {
        identity: key,
        confidence,
        cars: 0,
        priceKrw: 0,
        sample: [],
        years: new Set<number>(),
        powerValues: new Set<number>(),
        sources: new Set<string>(),
      };
      // A group takes the least reliable status found within it.
      if (riskWeight(confidence) > riskWeight(item.confidence)) item.confidence = confidence;
      item.cars += 1;
      item.priceKrw += Number(car.price_krw ?? 0);
      if (car.year) item.years.add(car.year);
      if (car.power_hp) item.powerValues.add(car.power_hp);
      item.sources.add(source);
      if (item.sample.length < 3) item.sample.push(car);
      queue.set(key, item);
    }

    const queueRows = [...queue.values()]
      .filter((item) => item.confidence !== "declared_verified")
      .sort((a, b) => {
        const byRisk = riskWeight(b.confidence) - riskWeight(a.confidence);
        if (byRisk) return byRisk;
        const byCars = b.cars - a.cars;
        if (byCars) return byCars;
        return b.priceKrw - a.priceKrw;
      })
      .map((item) => ({
        identity: item.identity,
        currentConfidence: item.confidence,
        cards: item.cars,
        totalPriceKrw: item.priceKrw,
        years: [...item.years].sort((a, b) => a - b),
        observedPowerHp: [...item.powerValues].sort((a, b) => a - b),
        currentSources: [...item.sources].sort(),
        sampleSourceIds: item.sample.map((car) => car.id),
      }));

    console.log(JSON.stringify({
      auditVersion: "catalog-power-confidence-v1",
      mode: "read_only",
      activeCars: cars.length,
      currentConfidence: confidenceCounts,
      importantNote: "declared_verified means a legacy code label only; it is not official until it is linked to approved evidence in vehicle_power_specs.",
      sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort((a, b) => b[1] - a[1])),
      reviewQueue: {
        totalConfigurations: queueRows.length,
        immediate: queueRows.filter((item) => item.currentConfidence === "missing" || item.currentConfidence === "automatic").slice(0, 100),
        next: queueRows.filter((item) => item.currentConfidence === "mapped").slice(0, 100),
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
