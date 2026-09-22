import { config } from "dotenv";
import { createSupabasePublic } from "../src/server/supabase/public";
import { evaluatePublication, type PublicationCandidate } from "../src/server/cars/calculation-contract";

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
  vehicle_specs: Record<string, unknown> | null;
  calculation_power_status: string | null;
  calculation_power_kw: number | null;
  calculation_power_spec_id: string | null;
  power_basis: string | null;
  power_confidence: string | null;
  power_resolution_source: string | null;
  calculation_month: number | null;
  hybrid_dvs_power_hp: number | null;
  legacy_calculation_status: string | null;
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
        "id, primary_source, brand, fuel_type, price_rub, power_hp, source_url, source_updated_at, has_360_interior, vehicle_specs, calculation_power_status, calculation_power_kw, calculation_power_spec_id, power_basis, power_confidence, power_resolution_source, calculation_month, hybrid_dvs_power_hp, legacy_calculation_status",
      )
      .eq("is_available", true)
      // TL Auto's public catalogue is currently mirrored from the
      // Chestny Prigon staging source. Keep Encar for legacy rows, but do
      // not exclude the active Chestny source from the audit.
      .in("primary_source", ["encar", "chestny_prigon"])
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

  // The publication contract needs to know which cards actually have a stored
  // calculation snapshot. The public policy exposes snapshots for available cars.
  const snapshotCarIds = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("calc_snapshots")
      .select("car_id")
      .order("car_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{ car_id: string }>;
    for (const row of batch) snapshotCarIds.add(row.car_id);
    if (batch.length < pageSize) break;
  }

  const gateFailures = new Map<string, number>();
  const preliminaryByConfidence: Record<string, number> = {};
  const snapshotSuspects: string[] = [];
  let gateChecked = 0;
  for (const car of cars) {
    // An unpriced card simply shows no landed price; the contract only has to
    // hold once a price is exposed.
    if (car.price_rub == null) continue;
    gateChecked++;
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
      // A card published between the two reads of this audit would look like it
      // has no snapshot. Those ids are re-checked below before being reported.
      if (verdict.blockers.includes("snapshot_missing")) snapshotSuspects.push(car.id);
      for (const blocker of verdict.blockers) gateFailures.set(blocker, (gateFailures.get(blocker) ?? 0) + 1);
      continue;
    }
    // A published price that is only preliminary is a normal state, but its
    // number must be visible: it is what the customer sees on the card.
    if (verdict.finality === "preliminary") {
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

  // The catalogue is written by a live publisher, so a card can appear between
  // the two reads. Re-reading only the suspects tells a genuine missing snapshot
  // apart from a card that was mid-publication when the audit started.
  let snapshotRaceResolved = 0;
  if (snapshotSuspects.length) {
    const confirmed = new Set<string>();
    for (let index = 0; index < snapshotSuspects.length; index += 100) {
      const { data } = await supabase
        .from("calc_snapshots")
        .select("car_id")
        .in("car_id", snapshotSuspects.slice(index, index + 100));
      for (const row of (data ?? []) as Array<{ car_id: string }>) confirmed.add(row.car_id);
    }
    snapshotRaceResolved = confirmed.size;
    if (confirmed.size) {
      const remaining = Math.max(0, (gateFailures.get("snapshot_missing") ?? 0) - confirmed.size);
      if (remaining) gateFailures.set("snapshot_missing", remaining);
      else gateFailures.delete("snapshot_missing");
    }
  }

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
    publicationContract: {
      checked: gateChecked,
      withSnapshot: snapshotCarIds.size,
      snapshotRaceResolved,
      failures: Object.fromEntries(gateFailures),
    },
    priceFinality: {
      preliminary: Object.values(preliminaryByConfidence).reduce((sum, count) => sum + count, 0),
      byConfidence: preliminaryByConfidence,
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
  if (gateFailures.size) {
    const detail = [...gateFailures.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ");
    blockers.push(`publication contract is violated (${detail})`);
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
