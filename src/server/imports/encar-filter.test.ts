import assert from "node:assert/strict";
import { buildFilter } from "./encar";

assert.equal(
  buildFilter(),
  "(And.Hidden.N._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);
assert.equal(
  buildFilter("BMW"),
  "(And.Hidden.N._.Manufacturer.BMW._.Year.range(202100..202700)._.Mileage.range(..120000)._.Price.range(700..15000).)",
);

console.log("Encar list filters passed");
