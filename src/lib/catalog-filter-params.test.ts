import assert from "node:assert/strict";
import { catalogFiltersFromParams } from "./catalog-filter-params";

const filters = catalogFiltersFromParams(new URLSearchParams(
  "under160=1&crossovers4wd=1&electricOnly=1&lpgOnly=1&clean=1&noInsurance=1",
));

assert.equal(filters.maxPowerHp, 160);
assert.equal(filters.crossovers4wd, true);
assert.equal(filters.electricOnly, true);
assert.equal(filters.lpgOnly, true);
assert.equal(filters.noAccidents, true);
assert.equal(filters.noInsurance, true);

console.log("catalog quick filter parameter tests passed");
