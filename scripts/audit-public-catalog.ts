import { config } from "dotenv";
import { createSupabasePublic } from "../src/server/supabase/public";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type PublicAuditCar = {
  id: string;
  primary_source: string;
  brand: string | null;
  fuel_type: string | null;
  price_rub: number | null;
  power_hp: number | null;
  source_url: string | null;
  source_updated_at: string | null;
  has_360_interior: boolean;
  power_confidence: string | null;
  power_finality: string | null;
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
        "id, primary_source, brand, fuel_type, price_rub, power_hp, source_url, source_updated_at, has_360_interior, power_confidence, power_finality",
      )
      .eq("is_available", true)
      // TL Auto's public catalogue is currently mirrored from the
      // Chestny Prigon staging source. Keep Encar for legacy rows, but do
      // not exclude the active Chestny source from the audit.
      .in("primary_source", ["encar", "chestny_prigon"])
      .in("fuel_type", ["gasoline", "diesel", "hybrid", "electric"])
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throwQueryError(`Reading public cars at offset ${offset}`, error);
    const batch = (data ?? []) as PublicAuditCar[];
    cars.push(...batch);
    if (batch.length < pageSize) break;
  }

  const sourceCount = (source: string) =>
    cars.filter((car) => car.primary_source === source).length;

  const preliminaryByConfidence: Record<string, number> = {};
  let missingPriceFinality = 0;
  for (const car of cars) {
    if (car.price_rub == null) continue;
    if (car.power_finality == null) missingPriceFinality++;
    if (car.power_finality === "provisional") {
      const confidence = car.power_confidence ?? "unknown";
      preliminaryByConfidence[confidence] = (preliminaryByConfidence[confidence] ?? 0) + 1;
    }
  }
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
  // An electric car is covered by the publication contract above: it must be on
  // the 30-minute basis, carry no ICE power fields and expose a price only with
  // a resolved status. The import-time free-form marker is history now and is no
  // longer read as the current status.
  const electricWithPrice = electric.filter((car) => car.price_rub != null).length;
  const electricWithoutPrice = electric.length - electricWithPrice;

  const report = {
    total: cars.length,
    sources: {
      encar: sourceCount("encar"),
      chestny_prigon: sourceCount("chestny_prigon"),
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
      electricWithPrice,
      electricWithoutPrice,
    },
    staleBeyondDays: { days: freshnessDays, count: stale },
    missingSourceLink,
    priceFinality: {
      preliminary: Object.values(preliminaryByConfidence).reduce((sum, count) => sum + count, 0),
      byConfidence: preliminaryByConfidence,
      missing: missingPriceFinality,
      note: "Preliminary prices are published by design and marked on the car page only; the catalogue list and sorting are unchanged.",
    },
  };

  console.log(JSON.stringify(report, null, 2));

  const blockers: string[] = [];
  if (cars.length < minimumCatalogSize) {
    blockers.push(
      `catalog has ${cars.length} cars, minimum is ${minimumCatalogSize}`,
    );
  }
  if (!report.sources.encar && !report.sources.chestny_prigon) {
    blockers.push("the public catalogue has no supported source rows");
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
  if (electricWithoutPrice) {
    console.warn(`Warning: ${electricWithoutPrice} electric cars show no landed price yet`);
  }
  if (missingPriceFinality) {
    blockers.push(`${missingPriceFinality} priced cars have no public finality marker`);
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

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
