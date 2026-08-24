import assert from "node:assert/strict";
import { normalizeFuel } from "../normalization/vehicles";
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

console.log("Encar list filters passed");
