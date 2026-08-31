import { config } from "dotenv";
import { createSupabasePublic } from "../src/server/supabase/public";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type PublicAuditCar = {
  primary_source: string;
  brand: string | null;
  fuel_type: string | null;
  price_rub: number | null;
  power_hp: number | null;
  source_url: string | null;
  source_updated_at: string | null;
  has_360_interior: boolean;
  vehicle_specs: Record<string, unknown> | null;
};

async function main() {
  const minimumCatalogSize = Number(process.env.CATALOG_MIN_TOTAL ?? 420);
  const freshnessDays = Number(process.env.CATALOG_MAX_LISTING_AGE_DAYS ?? 90);
  const freshnessThreshold = Date.now() - freshnessDays * 24 * 60 * 60 * 1000;
  const supabase = createSupabasePublic();
  const pageSize = 1_000;
  const cars: PublicAuditCar[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("cars")
      .select(
        "primary_source, brand, fuel_type, price_rub, power_hp, source_url, source_updated_at, has_360_interior, vehicle_specs",
      )
      .eq("is_available", true)
      .eq("primary_source", "encar")
      .in("fuel_type", ["gasoline", "diesel", "hybrid", "electric"])
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const batch = (data ?? []) as PublicAuditCar[];
    cars.push(...batch);
    if (batch.length < pageSize) break;
  }

  const sourceCount = (source: string) =>
    cars.filter((car) => car.primary_source === source).length;
  const brandCount = (brand: string) =>
    cars.filter((car) => car.brand === brand).length;
  const stale = cars.filter((car) => {
    const timestamp = Date.parse(car.source_updated_at ?? "");
    return !Number.isFinite(timestamp) || timestamp < freshnessThreshold;
  }).length;
  const missingSourceLink = cars.filter((car) => !car.source_url).length;
  const electric = cars.filter((car) => car.fuel_type === "electric");
  const hybrid = cars.filter((car) => car.fuel_type === "hybrid");
  const combustion = cars.filter(
    (car) => car.fuel_type !== "electric" && car.fuel_type !== "hybrid",
  );
  const incompleteCombustion = combustion.filter(
    (car) => car.price_rub == null || car.power_hp == null,
  ).length;
  const electricWithInventedPrice = electric.filter(
    (car) => car.price_rub != null,
  ).length;
  const electricPendingCalculation = electric.filter(
    (car) =>
      car.vehicle_specs?.calculation_status ===
      "pending_official_ev_tariff",
  ).length;

  const report = {
    total: cars.length,
    sources: {
      encar: sourceCount("encar"),
    },
    premiumBrands: {
      mercedes: brandCount("Mercedes-Benz"),
      bmw: brandCount("BMW"),
      audi: brandCount("Audi"),
    },
    withInterior360: cars.filter((car) => car.has_360_interior).length,
    fuel: {
      combustion: combustion.length,
      hybrid: hybrid.length,
      electric: electric.length,
    },
    calculationCoverage: {
      incompleteCombustion,
      electricPendingCalculation,
      electricWithInventedPrice,
    },
    staleBeyondDays: { days: freshnessDays, count: stale },
    missingSourceLink,
  };

  console.log(JSON.stringify(report, null, 2));

  const blockers: string[] = [];
  if (cars.length < minimumCatalogSize) {
    blockers.push(
      `catalog has ${cars.length} cars, minimum is ${minimumCatalogSize}`,
    );
  }
  if (!report.sources.encar) {
    blockers.push("the required Encar source is empty");
  }
  if (
    !report.premiumBrands.mercedes ||
    !report.premiumBrands.bmw ||
    !report.premiumBrands.audi
  ) {
    blockers.push("Mercedes-Benz, BMW and Audi must all be represented");
  }
  if (missingSourceLink) {
    blockers.push(`${missingSourceLink} cars do not have a source link`);
  }
  if (incompleteCombustion) {
    blockers.push(`${incompleteCombustion} combustion cars have an incomplete calculation`);
  }
  if (electricWithInventedPrice) {
    blockers.push(`${electricWithInventedPrice} electric cars expose an unapproved landed price`);
  }
  if (electric.length && electricPendingCalculation !== electric.length) {
    blockers.push("some electric cars do not carry the pending calculation marker");
  }

  if (blockers.length) {
    throw new Error(`Public catalog audit failed: ${blockers.join("; ")}`);
  }

  if (stale) {
    console.warn(
      `Warning: ${stale} public cars are older than the ${freshnessDays}-day target`,
    );
  }

  console.log("Public catalog audit passed");
}

void main();
