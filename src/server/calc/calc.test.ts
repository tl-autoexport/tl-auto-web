import assert from "node:assert/strict";
import { calculateRuVladivostok } from "./ru";

const genesisG70 = calculateRuVladivostok({
  priceKrw: 26_690_000,
  year: 2021,
  month: 10,
  engineCc: 1998,
  powerHp: 252,
  fuelType: "gasoline",
  calculationDate: "2026-07-26T00:00:00.000Z",
  rates: {
    krwRub: 0.050135,
    usdRub: 77.929,
    eurRub: 88.707,
  },
});

assert.equal(genesisG70.carPriceRub, 1_338_103);
assert.equal(genesisG70.freightRub, 93_515);
assert.equal(genesisG70.brokerRub, 90_000);
assert.equal(genesisG70.dutyRub, 478_539);
assert.equal(genesisG70.exciseRub, 0);
assert.equal(genesisG70.vatRub, 0);
assert.equal(genesisG70.feesRub, 13_541);
assert.equal(genesisG70.utilRub, 1_838_400);
assert.equal(genesisG70.totalRub, 3_852_098);

const ageBoundary = calculateRuVladivostok({
  priceKrw: 10_000_000,
  year: 2021,
  month: 8,
  engineCc: 998,
  powerHp: 76,
  calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.0531039, usdRub: 78.0308, eurRub: 88.8927 },
});
assert.ok(ageBoundary.currentCarAgeYears < 5);
assert.ok(ageBoundary.carAgeYears > 5);
assert.equal(ageBoundary.customs.eurPerCc, 1.5);

const mercedesA250 = calculateRuVladivostok({
  priceKrw: 20_000_000,
  year: 2021,
  month: 6,
  engineCc: 1991,
  powerHp: 306,
  calculationDate: "2026-07-26T00:00:00.000Z",
});
assert.equal(mercedesA250.util.coefficient, 100.56);
assert.equal(mercedesA250.utilRub, 2_011_200);

const usedGrandeurHybrid = calculateRuVladivostok({
  priceKrw: 14_150_000,
  year: 2019,
  month: 2,
  engineCc: 2359,
  powerHp: 159,
  fuelType: "hybrid",
  calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.0531039, usdRub: 78.0308, eurRub: 88.8927 },
});
assert.equal(usedGrandeurHybrid.customs.mode, "hybrid");

const expensiveUsedCombustion = calculateRuVladivostok({
  priceKrw: 99_900_000,
  year: 2022,
  month: 5,
  engineCc: 2497,
  powerHp: 281,
  fuelType: "gasoline",
  calculationDate: "2026-07-30T00:00:00.000Z",
  rates: { krwRub: 0.0541243, usdRub: 79.357, eurRub: 90.2051 },
});
assert.equal(expensiveUsedCombustion.customs.mode, "volume");
assert.equal(
  expensiveUsedCombustion.dutyRub,
  Math.round(
    2497 *
      expensiveUsedCombustion.customs.eurPerCc *
      expensiveUsedCombustion.rates.eurRub,
  ),
);
assert.equal(usedGrandeurHybrid.customs.excisePerHp, 613);
assert.equal(usedGrandeurHybrid.dutyRub, 112_713);
assert.equal(usedGrandeurHybrid.exciseRub, 97_467);
assert.equal(usedGrandeurHybrid.vatRub, 211_552);
assert.equal(usedGrandeurHybrid.util.coefficient, 111.36);
assert.equal(usedGrandeurHybrid.utilRub, 2_227_200);
assert.equal(usedGrandeurHybrid.totalRub, 3_588_913);

const newGrandeurHybrid = calculateRuVladivostok({
  priceKrw: 43_500_000,
  year: 2025,
  month: 1,
  engineCc: 1598,
  powerHp: 180,
  fuelType: "hybrid",
  calculationDate: "2026-07-26T00:00:00.000Z",
  rates: { krwRub: 0.0531039, usdRub: 78.0308, eurRub: 88.8927 },
});
assert.equal(newGrandeurHybrid.customs.excisePerHp, 613);
assert.equal(newGrandeurHybrid.util.coefficient, 92.4);
assert.equal(newGrandeurHybrid.totalRub, 5_420_751);

const usedElantraHybrid = calculateRuVladivostok({
  priceKrw: 16_500_000,
  year: 2021,
  month: 12,
  engineCc: 1580,
  powerHp: 105,
  fuelType: "hybrid",
  calculationDate: "2026-07-30T00:00:00.000Z",
  rates: { krwRub: 0.0541243, usdRub: 79.357, eurRub: 90.2051 },
});
assert.equal(usedElantraHybrid.util.coefficient, 95.64);
assert.equal(usedElantraHybrid.utilRub, 1_912_800);

const newK9 = calculateRuVladivostok({
  priceKrw: 52_500_000,
  year: 2025,
  month: 7,
  engineCc: 3778,
  powerHp: 315,
  fuelType: "gasoline",
  calculationDate: "2026-07-30T00:00:00.000Z",
  rates: { krwRub: 0.0541243, usdRub: 79.357, eurRub: 90.2051 },
});
assert.equal(newK9.util.coefficient, 186.36);
assert.equal(newK9.utilRub, 3_727_200);

const newGv80 = calculateRuVladivostok({
  priceKrw: 60_000_000,
  year: 2024,
  month: 5,
  engineCc: 3470,
  powerHp: 380,
  fuelType: "gasoline",
  calculationDate: "2026-07-30T00:00:00.000Z",
});
assert.equal(newGv80.util.coefficient, 169.2);
assert.equal(newGv80.utilRub, 3_384_000);

const feeBoundary = (carPriceRub: number) =>
  calculateRuVladivostok({
    priceKrw: carPriceRub,
    year: 2022,
    month: 1,
    engineCc: 1000,
    powerHp: 100,
    calculationDate: "2026-07-26T00:00:00.000Z",
    rates: { krwRub: 1, usdRub: 1, eurRub: 1 },
  }).feesRub;
assert.equal(feeBoundary(450_000), 2_464);
assert.equal(feeBoundary(450_001), 4_924);
assert.equal(feeBoundary(1_200_001), 13_541);
assert.equal(feeBoundary(5_500_001), 49_240);

console.log("calc benchmark passed", {
  fixture: "Korex Genesis G70 2021",
  totalRub: genesisG70.totalRub,
});
