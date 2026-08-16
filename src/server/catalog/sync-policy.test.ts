import assert from "node:assert/strict";
import {
  evaluateCatalogHealth,
  type CatalogStats,
} from "./sync-policy";

const healthyStats: CatalogStats = {
  visible: 502,
  bySource: { encar: 502 },
  byBrand: { "Mercedes-Benz": 40, BMW: 30, Audi: 20 },
  byModel: {
    "Mercedes-Benz:A-Class": 3,
    "Mercedes-Benz:C-Class": 4,
    "Mercedes-Benz:E-Class": 8,
  },
  stale: 0,
};

const baseInput = {
  before: healthyStats,
  after: healthyStats,
  sourceSeen: { encar: 136 },
  minimumSourceSeen: { encar: 100 },
  minimumCatalogBySource: { encar: 420 },
  minimumTotal: 420,
  brandMinimums: { "Mercedes-Benz": 25, BMW: 20, Audi: 15 },
  modelMinimums: {
    "Mercedes-Benz:A-Class": 2,
    "Mercedes-Benz:C-Class": 2,
    "Mercedes-Benz:E-Class": 4,
  },
  maxVisibleDropPercent: 10,
  cleanupSkipped: false,
};

assert.equal(evaluateCatalogHealth(baseInput).complete, true);

const incompleteFetch = evaluateCatalogHealth({
  ...baseInput,
  sourceSeen: { encar: 0 },
});
assert.equal(incompleteFetch.complete, false);
assert.match(incompleteFetch.reasons.join("\n"), /encar: fetched 0/);

const unsafeDrop = evaluateCatalogHealth({
  ...baseInput,
  after: {
    ...healthyStats,
    visible: 320,
    bySource: { encar: 320 },
  },
});
assert.equal(unsafeDrop.complete, false);
assert.match(unsafeDrop.reasons.join("\n"), /dropped 36\.3%/);

const blockedCleanup = evaluateCatalogHealth({
  ...baseInput,
  cleanupSkipped: true,
});
assert.equal(blockedCleanup.complete, false);
assert.match(blockedCleanup.reasons.join("\n"), /cleanup was blocked/);

console.log("catalog sync policy tests passed");
