import assert from "node:assert/strict";
import { calculateKzAlmaty } from "./kz";

const result = calculateKzAlmaty({
  priceKrw: 30_000_000,
  rates: { krwRub: 0.06, usdRub: 84, eurRub: 96, kztRub: 0.14 },
  tariffs: { koreaExpensesKrw: 2_100_000, deliveryUsd: 1_500, serviceFeeKzt: 300_000 },
  ratesAsOf: "2026-08-22",
});
assert.equal(result.customsKzt, 0);
assert.equal(result.carPriceKzt, 12_857_143);
assert.equal(result.koreaExpensesKzt, 900_000);
assert.equal(result.deliveryKzt, 900_000);
assert.equal(result.totalKzt, 14_957_143);
console.log("kz calc benchmark passed", { totalKzt: result.totalKzt });
