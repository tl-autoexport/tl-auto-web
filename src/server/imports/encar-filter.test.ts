import assert from "node:assert/strict";
import { normalizeFuel, resolveHybridPower } from "../normalization/vehicles";
import { buildFilter } from "./encar";

assert.equal(
  buildFilter(),
  "(And.Hidden.N._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);
assert.equal(
  buildFilter("BMW"),
  "(And.Hidden.N._.Manufacturer.BMW._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);
assert.equal(
  buildFilter(undefined, "electric"),
  "(And.Hidden.N._.FuelType.전기._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);
assert.equal(
  buildFilter(undefined, "hybrid"),
  "(And.Hidden.N._.FuelType.가솔린+전기._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);
assert.equal(
  buildFilter(undefined, undefined, {
    minYear: 201800,
    maxYear: 202700,
    maxMileage: 180000,
    minPrice: 100,
    maxPrice: 15000,
  }),
  "(And.Hidden.N._.Year.range(201800..202700)._.Mileage.range(..180000)._.Price.range(100..15000).)",
);
assert.equal(normalizeFuel("전기"), "electric");
assert.equal(normalizeFuel("가솔린+전기"), "hybrid");
assert.equal(normalizeFuel("디젤 + Electric"), "hybrid");

const k5Hybrid = resolveHybridPower({
  brand: "기아",
  model: "K5",
  badgeDetail: "Signature",
  fuelType: "가솔린+전기",
  engineCc: 1999,
  year: 2021,
});
assert.deepEqual(k5Hybrid, {
  powerHp: 152,
  electricPowerKw: 38.6,
  dvsAboveElectric30Min: true,
  sequential: false,
  source: "verified_specs",
  note: "Kia K5 Signature 1999",
});
assert.equal(
  resolveHybridPower({
    brand: "Lexus",
    model: "RX",
    badge: "Luxury",
    fuelType: "hybrid",
    engineCc: 2487,
    year: 2023,
  }),
  null,
);

for (const control of [
  { brand: "Kia", model: "Sportage", engineCc: 1598, year: 2024, powerHp: 180, electricPowerKw: 44.2 },
  { brand: "Hyundai", model: "Sonata", engineCc: 1999, year: 2023, powerHp: 152, electricPowerKw: 38.6 },
  { brand: "Kia", model: "Niro", engineCc: 1580, year: 2024, powerHp: 105, electricPowerKw: 32 },
  { brand: "Hyundai", model: "Kona", engineCc: 1580, year: 2024, powerHp: 105, electricPowerKw: 32 },
] as const) {
  const resolved = resolveHybridPower({
    ...control,
    badge: "HEV",
    fuelType: "가솔린+전기",
  });
  assert.equal(resolved?.powerHp, control.powerHp, `${control.model} DVS power`);
  assert.equal(resolved?.electricPowerKw, control.electricPowerKw, `${control.model} electric power`);
  assert.equal(resolved?.dvsAboveElectric30Min, true, `${control.model} TKS flag`);
  assert.equal(resolved?.sequential, false, `${control.model} topology`);
}

console.log("Encar list filters passed");
