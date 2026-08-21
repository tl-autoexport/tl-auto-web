import assert from "node:assert/strict";
import { calculatePowersportsPrice } from "./powersports";

const rates = { krwRub: 0.06, usdRub: 80, eurRub: 90 };
const motorcycle = calculatePowersportsPrice("motorcycle", 1_000_000, rates);
assert.equal(motorcycle.sourcePriceRub, 60_000);
assert.equal(motorcycle.routeAndClearanceRub, 360_000);
assert.equal(motorcycle.russianCostsRub, 100_000);
assert.equal(motorcycle.totalRub, 520_000);
assert.deepEqual(motorcycle.russianCosts.map((item) => item.label), ["Брокерские услуги", "Комиссия под ключ"]);

const jetski = calculatePowersportsPrice("jetski", 2_000_000, rates);
assert.equal(jetski.totalRub, 580_000);
assert.deepEqual(jetski.russianCosts.map((item) => item.label), ["Комиссия под ключ", "Судовой билет"]);

const unavailable = calculatePowersportsPrice("motorcycle", null, rates);
assert.equal(unavailable.totalRub, null);

console.log("powersports calculation passed");

