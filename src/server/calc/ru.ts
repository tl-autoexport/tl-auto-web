import type { CalcInput, CalcRates, CalcResult } from "./types";

export const CALC_VERSION = "ru-vladivostok-cbr-korex-2026-07-30";

const DEFAULT_RATES: CalcRates = {
  krwRub: 0.050135,
  usdRub: 77.929,
  eurRub: 88.707,
};

const DEFAULT_CLEARANCE_DAYS = 90;
const BROKER_RUB = 90_000;
const FREIGHT_USD = 1_200;
const UTIL_BASE_RUB = 20_000;
const HYBRID_DUTY_RATE = 0.15;
const HYBRID_VAT_RATE = 0.22;

function roundRub(value: number): number {
  return Math.round(value);
}

function getEstimatedClearanceDate(
  from: Date,
  days = DEFAULT_CLEARANCE_DAYS,
): Date {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function getCarAgeYears(
  year: number,
  month: number,
  clearanceDate: Date,
): number {
  const releaseDate = new Date(Date.UTC(year, month - 1, 15));
  return (
    (clearanceDate.getTime() - releaseDate.getTime()) /
    (1000 * 60 * 60 * 24 * 365.25)
  );
}

function getCustomsRate(
  engineCc: number,
  projectedAgeYears: number,
  currentAgeYears: number,
  priceRub: number,
  eurRub: number,
) {
  const priceEur = priceRub / eurRub;

  let eurPerCc: number;
  let percentRate: number;

  if (projectedAgeYears < 3) {
    if (priceEur <= 8500) {
      eurPerCc = 2.5;
      percentRate = 0.54;
    } else if (priceEur <= 16700) {
      eurPerCc = 3.5;
      percentRate = 0.48;
    } else if (priceEur <= 42300) {
      eurPerCc = 5.5;
      percentRate = 0.48;
    } else if (priceEur <= 84500) {
      eurPerCc = 7.5;
      percentRate = 0.48;
    } else if (priceEur <= 169000) {
      eurPerCc = 15;
      percentRate = 0.48;
    } else {
      eurPerCc = 20;
      percentRate = 0.48;
    }
  } else if (currentAgeYears <= 5) {
    if (engineCc <= 1000) eurPerCc = 1.5;
    else if (engineCc <= 1500) eurPerCc = 1.7;
    else if (engineCc <= 1800) eurPerCc = 2.5;
    else if (engineCc <= 2300) eurPerCc = 2.7;
    else if (engineCc <= 3000) eurPerCc = 3;
    else eurPerCc = 3.6;
    percentRate = 0.154;
  } else {
    if (engineCc <= 1000) eurPerCc = 3;
    else if (engineCc <= 1500) eurPerCc = 3.2;
    else if (engineCc <= 1800) eurPerCc = 3.5;
    else if (engineCc <= 2300) eurPerCc = 4.8;
    else if (engineCc <= 3000) eurPerCc = 5;
    else eurPerCc = 5.7;
    percentRate = 0.2;
  }

  return { eurPerCc, percentRate };
}

function getDutyRub(
  engineCc: number,
  priceRub: number,
  rates: CalcRates,
  projectedAgeYears: number,
  currentAgeYears: number,
) {
  const { eurPerCc, percentRate } = getCustomsRate(
    engineCc,
    projectedAgeYears,
    currentAgeYears,
    priceRub,
    rates.eurRub,
  );
  const dutyByVolume = engineCc * eurPerCc * rates.eurRub;
  const dutyByValue = priceRub * percentRate;
  const useValueDuty =
    projectedAgeYears < 3 && dutyByValue > dutyByVolume;
  const mode: "volume" | "value" = useValueDuty ? "value" : "volume";

  return {
    dutyRub: roundRub(useValueDuty ? dutyByValue : dutyByVolume),
    eurPerCc,
    percentRate,
    mode,
  };
}

type PowerCoefficient = readonly [maxPowerHp: number, coefficient: number];

const UTIL_COEFFICIENTS = {
  new: {
    small: [
      [160, 0.17],
      [190, 45],
      [220, 47.64],
      [250, 50.52],
      [280, 57.12],
      [309, 64.56],
      [340, 72.96],
      [369, 83.16],
      [400, 94.8],
      [429, 108],
      [460, 123.24],
      [500, 140.4],
      [Infinity, 160.08],
    ],
    mid: [
      [160, 0.17],
      [190, 115.34],
      [220, 118.2],
      [250, 120.12],
      [280, 126],
      [309, 131.04],
      [340, 136.32],
      [369, 141.72],
      [400, 147.48],
      [429, 153.36],
      [460, 159.48],
      [500, 165.84],
      [Infinity, 172.44],
    ],
    large: [
      [160, 129.2],
      [190, 131.76],
      [220, 134.4],
      [250, 137.16],
      [280, 140.52],
      [309, 144],
      [340, 151.92],
      [369, 160.32],
      [400, 169.2],
      [429, 178.44],
      [460, 188.28],
      [500, 198.6],
      [Infinity, 209.52],
    ],
    extraLarge: [
      [160, 164.53],
      [190, 167.28],
      [220, 170.16],
      [250, 173.04],
      [280, 176.52],
      [309, 180],
      [340, 186.36],
      [369, 192.88],
      [400, 199.68],
      [429, 206.64],
      [460, 213.84],
      [500, 221.28],
      [Infinity, 229.08],
    ],
  },
  used: {
    small: [
      [160, 0.26],
      [190, 74.64],
      [220, 79.2],
      [250, 83.88],
      [280, 91.92],
      [309, 100.56],
      [340, 110.16],
      [369, 120.6],
      [400, 132],
      [429, 144.6],
      [460, 158.4],
      [500, 173.4],
      [Infinity, 189.84],
    ],
    mid: [
      [160, 0.26],
      [190, 172.8],
      [220, 175.08],
      [250, 177.6],
      [280, 183],
      [309, 188.52],
      [340, 193.68],
      [369, 199.08],
      [400, 204.72],
      [429, 210.48],
      [460, 216.36],
      [500, 222.36],
      [Infinity, 228.6],
    ],
    large: [
      [160, 197.81],
      [190, 200.04],
      [220, 202.2],
      [250, 204.36],
      [280, 207.24],
      [309, 212.4],
      [340, 217.8],
      [369, 224.28],
      [400, 231],
      [429, 237.96],
      [460, 245.04],
      [500, 252.48],
      [Infinity, 260.04],
    ],
    extraLarge: [
      [160, 216.29],
      [190, 219.48],
      [220, 222.84],
      [250, 226.2],
      [280, 231.36],
      [309, 236.64],
      [340, 249.6],
      [369, 263.4],
      [400, 277.92],
      [429, 293.16],
      [460, 309.36],
      [500, 326.4],
      [Infinity, 344.28],
    ],
  },
} satisfies Record<
  "new" | "used",
  Record<"small" | "mid" | "large" | "extraLarge", readonly PowerCoefficient[]>
>;

// Korex applies a separate utilization-fee scale to petrol/electric hybrids.
// Unlike combustion-only vehicles, the scale depends on power and age, not engine volume.
const HYBRID_UTIL_COEFFICIENTS = {
  new: [
    [80, 0.17],
    [100, 49.26],
    [129, 65.88],
    [160, 78],
    [190, 92.4],
    [220, 109.68],
    [250, 129.96],
    [280, 153.96],
    [Infinity, 182.4],
  ],
  used: [
    [80, 0.26],
    [100, 82.08],
    [129, 95.64],
    [160, 111.36],
    [190, 129.72],
    [220, 151.2],
    [250, 176.16],
    [280, 205.2],
    [Infinity, 239.04],
  ],
} satisfies Record<"new" | "used", readonly PowerCoefficient[]>;

const HYBRID_EXCISE_RATES: readonly PowerCoefficient[] = [
  [90, 0],
  [150, 64],
  [200, 613],
  [300, 1004],
  [400, 1711],
  [500, 1771],
  [Infinity, 1829],
];

function getUtilCoefficient(
  powerHp: number,
  engineCc: number,
  projectedAgeYears: number,
): number {
  const ageGroup = projectedAgeYears < 3 ? "new" : "used";
  const volumeGroup =
    engineCc <= 2000
      ? "small"
      : engineCc <= 3000
        ? "mid"
        : engineCc <= 3500
          ? "large"
          : "extraLarge";
  return UTIL_COEFFICIENTS[ageGroup][volumeGroup].find(
    ([maxPower]) => powerHp <= maxPower,
  )![1];
}

function getHybridUtilCoefficient(powerHp: number, projectedAgeYears: number) {
  const ageGroup = projectedAgeYears < 3 ? "new" : "used";
  return HYBRID_UTIL_COEFFICIENTS[ageGroup].find(
    ([maxPower]) => powerHp <= maxPower,
  )![1];
}

function getHybridExcisePerHp(powerHp: number) {
  return HYBRID_EXCISE_RATES.find(([maxPower]) => powerHp <= maxPower)![1];
}

function getCustomsFeeRub(priceRub: number): number {
  if (priceRub <= 200_000) return 1_231;
  if (priceRub <= 450_000) return 2_464;
  if (priceRub <= 1_200_000) return 4_924;
  if (priceRub <= 2_700_000) return 13_541;
  if (priceRub <= 4_200_000) return 18_465;
  if (priceRub <= 5_500_000) return 21_344;
  return 49_240;
}

export function calculateRuVladivostok(input: CalcInput): CalcResult {
  const rates: CalcRates = {
    krwRub: input.rates?.krwRub ?? DEFAULT_RATES.krwRub,
    usdRub: input.rates?.usdRub ?? DEFAULT_RATES.usdRub,
    eurRub: input.rates?.eurRub ?? DEFAULT_RATES.eurRub,
  };
  const calculationDate = input.calculationDate
    ? new Date(input.calculationDate)
    : new Date();
  if (Number.isNaN(calculationDate.getTime()))
    throw new Error("Invalid calculation date");
  const clearanceDate = getEstimatedClearanceDate(
    calculationDate,
    input.clearanceDays,
  );
  const currentAgeYears = getCarAgeYears(
    input.year,
    input.month || 6,
    calculationDate,
  );
  const projectedAgeYears = getCarAgeYears(
    input.year,
    input.month || 6,
    clearanceDate,
  );
  const carPriceRub = roundRub(input.priceKrw * rates.krwRub);
  const freightRub = roundRub(FREIGHT_USD * rates.usdRub);
  const brokerRub = BROKER_RUB;
  const isHybrid = input.fuelType === "hybrid";
  const combustionDuty = isHybrid
    ? null
    : getDutyRub(
        input.engineCc,
        carPriceRub,
        rates,
        projectedAgeYears,
        currentAgeYears,
      );
  const excisePerHp = isHybrid ? getHybridExcisePerHp(input.powerHp) : 0;
  const dutyRub = isHybrid
    ? Math.ceil(carPriceRub * HYBRID_DUTY_RATE)
    : combustionDuty!.dutyRub;
  const exciseRub = isHybrid ? Math.ceil(input.powerHp * excisePerHp) : 0;
  const vatRub = isHybrid
    ? Math.ceil((carPriceRub + dutyRub + exciseRub) * HYBRID_VAT_RATE)
    : 0;
  const feesRub = getCustomsFeeRub(carPriceRub);
  const utilCoefficient = isHybrid
    ? getHybridUtilCoefficient(input.powerHp, projectedAgeYears)
    : getUtilCoefficient(input.powerHp, input.engineCc, projectedAgeYears);
  const utilRub = roundRub(UTIL_BASE_RUB * utilCoefficient);
  const totalRub =
    carPriceRub +
    freightRub +
    brokerRub +
    dutyRub +
    exciseRub +
    vatRub +
    feesRub +
    utilRub;

  return {
    countryCode: "RU",
    destinationCity: "Владивосток",
    importerType: "individual",
    calcVersion: CALC_VERSION,
    carPriceRub,
    freightRub,
    brokerRub,
    dutyRub,
    exciseRub,
    vatRub,
    feesRub,
    utilRub,
    totalRub,
    rates,
    ratesAsOf: input.ratesAsOf ?? null,
    ratesSource: input.ratesSource ?? "provided-or-default",
    customs: {
      eurPerCc: combustionDuty?.eurPerCc ?? 0,
      percentRate: isHybrid ? HYBRID_DUTY_RATE : combustionDuty!.percentRate,
      mode: isHybrid ? "hybrid" : combustionDuty!.mode,
      excisePerHp,
      vatRate: isHybrid ? HYBRID_VAT_RATE : 0,
    },
    util: {
      baseRub: UTIL_BASE_RUB,
      coefficient: utilCoefficient,
    },
    estimatedClearanceDate: clearanceDate.toISOString(),
    carAgeYears: Number(projectedAgeYears.toFixed(3)),
    currentCarAgeYears: Number(currentAgeYears.toFixed(3)),
    disclaimer:
      "Расчет предварительный: итог зависит от курса, даты оформления, состояния авто и фактических расходов.",
  };
}
