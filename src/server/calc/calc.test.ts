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
const genesisLargeNewBoundary = calculateRuVladivostok({
  ...({ priceKrw: 29_000_000, year: 2024, month: 7, engineCc: 3342, powerHp: 371,
    calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
    rates: { krwRub: 0.0620787, usdRub: 85.9541, eurRub: 100.2998, kztRub: 0.14 } }),
});
assert.equal(genesisLargeNewBoundary.util.coefficient, 169.2);

const largeNewUtilCoefficient = (powerHp: number) => calculateRuVladivostok({
  priceKrw: 38_000_000, year: 2024, month: 7, engineCc: 3342, powerHp,
  calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
  rates: { krwRub: 0.06407, usdRub: 87.84204, eurRub: 100, kztRub: 0.14 },
}).util.coefficient;

for (const [power, coefficient] of [
  [160, 129.2], [161, 131.76], [190, 131.76], [191, 134.4],
  [220, 134.4], [221, 137.16], [250, 137.16], [251, 140.52],
  [270, 140.52], [271, 140.52], [280, 140.52], [281, 144], [300, 144], [301, 144],
  [309, 144], [310, 144], [311, 151.92], [340, 151.92],
  [341, 160.32], [350, 160.32], [369, 160.32], [370, 160.32],
  [371, 169.2], [400, 169.2], [401, 178.44], [430, 178.44],
  [431, 188.28], [460, 188.28], [461, 198.6], [500, 198.6], [501, 209.52],
] as const) {
  assert.equal(largeNewUtilCoefficient(power), coefficient, `TKS util coefficient at ${power} hp`);
}

const extraLargeNewUtilCoefficient = (powerHp: number) => calculateRuVladivostok({
  priceKrw: 38_000_000, year: 2024, month: 7, engineCc: 3501, powerHp,
  calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
  rates: { krwRub: 0.06407, usdRub: 87.84204, eurRub: 100, kztRub: 0.14 },
}).util.coefficient;

for (const [power, coefficient] of [
  [160, 164.53], [161, 167.28], [340, 186.36], [341, 192.88],
  [430, 206.64], [431, 213.84], [500, 221.28], [501, 229.08],
] as const) {
  assert.equal(extraLargeNewUtilCoefficient(power), coefficient, `TKS util coefficient at 3501 cm³/${power} hp`);
}

const midNewUtilCoefficient = (powerHp: number) => calculateRuVladivostok({
  priceKrw: 38_000_000, year: 2024, month: 7, engineCc: 3000, powerHp,
  calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
  rates: { krwRub: 0.06407, usdRub: 87.84204, eurRub: 100, kztRub: 0.14 },
}).util.coefficient;

for (const [power, coefficient] of [
  [160, 0.17], [161, 115.34], [220, 118.2], [221, 120.12],
  [280, 126], [281, 131.04], [310, 131.04], [311, 136.32],
  [340, 136.32], [341, 141.72], [370, 141.72], [371, 147.48],
  [400, 147.48], [401, 153.36], [430, 153.36], [431, 159.48],
  [460, 159.48], [461, 165.84], [500, 165.84], [501, 172.44],
] as const) {
  assert.equal(midNewUtilCoefficient(power), coefficient, `TKS util coefficient at 3000 cm³/${power} hp`);
}

const smallNewUtilCoefficient = (powerHp: number) => calculateRuVladivostok({
  priceKrw: 38_000_000, year: 2024, month: 7, engineCc: 2000, powerHp,
  calculationDate: "2026-08-28T00:00:00.000Z", clearanceDays: 0,
  rates: { krwRub: 0.06407, usdRub: 87.84204, eurRub: 100, kztRub: 0.14 },
}).util.coefficient;

for (const [power, coefficient] of [
  [300, 64.56], [310, 64.56], [311, 72.96], [340, 72.96],
  [341, 83.16], [370, 83.16], [371, 94.8], [400, 94.8], [401, 108],
] as const) {
  assert.equal(smallNewUtilCoefficient(power), coefficient, `TKS util coefficient at 2000 cm³/${power} hp`);
}

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
assert.equal(feeBoundary(2_700_000), 13_541);
assert.equal(feeBoundary(2_700_001), 18_465);
assert.equal(feeBoundary(4_200_000), 18_465);
assert.equal(feeBoundary(4_200_001), 21_344);
assert.equal(feeBoundary(5_500_000), 21_344);
assert.equal(feeBoundary(5_500_001), 49_240);
assert.equal(feeBoundary(10_000_001), 49_240);

console.log("calc benchmark passed", { fixture: "AutoExport individual regime", totalRub: genesisG70.totalRub });
