import assert from "node:assert/strict";
import { calculateRuVladivostok } from "./ru";

const genesisG70 = calculateRuVladivostok({
  priceKrw: 26_690_000, year: 2021, month: 10, engineCc: 1998, powerHp: 252,
  fuelType: "gasoline", calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.050135, usdRub: 77.929, eurRub: 88.707, kztRub: 0.15 },
});
assert.equal(genesisG70.carPriceRub, 1_338_103);
assert.equal(genesisG70.dutyRub, 850_735.61);
assert.equal(genesisG70.feesRub, 13_541);
assert.equal(genesisG70.utilRub, 1_838_400);
assert.equal(genesisG70.koreaExpensesRub, 105_284);
assert.equal(genesisG70.totalRub, 4_329_578.76);
assert.equal(genesisG70.customs.mode, "volume");

const genesisLargeNew = calculateRuVladivostok({
  priceKrw: 29_000_000, year: 2024, month: 7, engineCc: 3342, powerHp: 370,
  fuelType: "gasoline", calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
  rates: { krwRub: 0.0620787, usdRub: 85.9541, eurRub: 100.2998, kztRub: 0.14 },
});
assert.equal(genesisLargeNew.util.coefficient, 160.32);
assert.equal(genesisLargeNew.utilRub, 3_206_400);

const ageBoundary = calculateRuVladivostok({
  priceKrw: 10_000_000, year: 2021, month: 8, engineCc: 998, powerHp: 76,
  calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.0531039, usdRub: 78.0308, eurRub: 88.8927, kztRub: 0.15 },
});
assert.ok(ageBoundary.currentCarAgeYears < 5);
assert.ok(ageBoundary.carAgeYears > 5);
assert.equal(ageBoundary.customs.eurPerCc, 3);
assert.equal(ageBoundary.util.coefficient, 0.26);

const hybridUsesIndividualRegime = calculateRuVladivostok({
  priceKrw: 14_150_000, year: 2019, month: 2, engineCc: 2359, powerHp: 159,
  fuelType: "hybrid", calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.0531039, usdRub: 78.0308, eurRub: 88.8927, kztRub: 0.15 },
});
assert.equal(hybridUsesIndividualRegime.exciseRub, 0);
assert.equal(hybridUsesIndividualRegime.vatRub, 0);
assert.equal(hybridUsesIndividualRegime.dutyRub, 1_048_489.4);
assert.equal(hybridUsesIndividualRegime.utilRub, 5_200);

const feeBoundary = (carPriceRub: number) => calculateRuVladivostok({
  priceKrw: carPriceRub, year: 2022, month: 1, engineCc: 1000, powerHp: 100,
  calculationDate: "2026-07-26T00:00:00.000Z", rates: { krwRub: 1, usdRub: 1, eurRub: 1, kztRub: 1 },
}).feesRub;
assert.equal(feeBoundary(450_000), 2_462);
assert.equal(feeBoundary(450_001), 4_924);
assert.equal(feeBoundary(1_200_001), 13_541);
assert.equal(feeBoundary(4_200_001), 27_540);
assert.equal(feeBoundary(10_000_001), 73_860);

console.log("calc benchmark passed", { fixture: "AutoExport individual regime", totalRub: genesisG70.totalRub });
