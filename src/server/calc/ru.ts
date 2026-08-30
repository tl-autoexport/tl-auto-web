import type { CalcInput, CalcRates, CalcResult } from "./types";

export const CALC_VERSION = "ru-individual-autoexport-tks-usdt-2026.01";

const DEFAULT_RATES: CalcRates = { krwRub: 0.04718, eurRub: 87.403, usdRub: 70.95, kztRub: 0.14 };
const DEFAULT_CLEARANCE_DAYS = 90;
const BROKER_RUB = 90_000;
const FREIGHT_USD = 1_200;
const KOREA_EXPENSES_KRW = 2_100_000;
const UTIL_BASE_RUB = 20_000;
const KW_TO_HP = 1.3596216173;

function roundRub(value: number) { return Math.round(value * 100) / 100; }

function getClearanceDate(from: Date, days = DEFAULT_CLEARANCE_DAYS) {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function getCarAgeYears(year: number, month: number, at: Date) {
  const releaseDate = new Date(Date.UTC(year, month - 1, 15));
  return (at.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function getIndividualDutyRub({
  priceRub, engineCc, ageYearsAtClearance, eurRub,
}: { priceRub: number; engineCc: number; ageYearsAtClearance: number; eurRub: number }) {
  const priceEur = priceRub / eurRub;
  let eurPerCc: number;
  let percent: number;
  if (ageYearsAtClearance < 3) {
    if (priceEur <= 8_500) [eurPerCc, percent] = [2.5, 0.54];
    else if (priceEur <= 16_700) [eurPerCc, percent] = [3.5, 0.48];
    else if (priceEur <= 42_300) [eurPerCc, percent] = [5.5, 0.48];
    else if (priceEur <= 84_500) [eurPerCc, percent] = [7.5, 0.48];
    else if (priceEur <= 169_000) [eurPerCc, percent] = [15, 0.48];
    else [eurPerCc, percent] = [20, 0.48];
  } else if (ageYearsAtClearance <= 5) {
    eurPerCc = engineCc <= 1000 ? 1.5 : engineCc <= 1500 ? 1.7 : engineCc <= 1800 ? 2.5 : engineCc <= 2300 ? 2.7 : engineCc <= 3000 ? 3 : 3.6;
    percent = 0.154;
  } else {
    eurPerCc = engineCc <= 1000 ? 3 : engineCc <= 1500 ? 3.2 : engineCc <= 1800 ? 3.5 : engineCc <= 2300 ? 4.8 : engineCc <= 3000 ? 5 : 5.7;
    percent = 0.2;
  }
  const dutyByVolume = engineCc * eurPerCc * eurRub;
  const dutyByValue = priceEur * percent * eurRub;
  return {
    dutyRub: roundRub(Math.max(dutyByVolume, dutyByValue)),
    eurPerCc,
    percentRate: percent,
    mode: (dutyByValue > dutyByVolume ? "value" : "volume") as "volume" | "value",
  };
}

function getUtilCoeff(powerHp: number, engineCc: number, isNew: boolean) {
  const smallCc = engineCc <= 2000;
  const midCc = engineCc <= 3000;
  if (isNew) {
    if (smallCc) {
      if (powerHp <= 160) return 0.17; if (powerHp <= 200) return 45; if (powerHp <= 220) return 47.64;
      if (powerHp <= 250) return 50.52; if (powerHp <= 270) return 57.12; if (powerHp <= 310) return 64.56;
      if (powerHp <= 340) return 72.96; if (powerHp <= 370) return 83.16; if (powerHp <= 400) return 94.8; return 108;
    }
    if (midCc) {
      // TKS-confirmed bands for new cars with engine volume up to 3000 cm³.
      if (powerHp <= 160) return 0.17;
      if (powerHp <= 190) return 115.34;
      if (powerHp <= 220) return 118.2;
      if (powerHp <= 250) return 120.12;
      if (powerHp <= 280) return 126;
      if (powerHp <= 310) return 131.04;
      if (powerHp <= 340) return 136.32;
      if (powerHp <= 370) return 141.72;
      if (powerHp <= 400) return 147.48;
      if (powerHp <= 430) return 153.36;
      if (powerHp <= 460) return 159.48;
      if (powerHp <= 500) return 165.84;
      return 172.44;
    }
    if (engineCc > 3500) {
      // TKS-confirmed bands for engines above 3500 cm³ (HAR: volume 3501).
      if (powerHp <= 160) return 164.53;
      if (powerHp <= 180) return 167.28;
      if (powerHp <= 220) return 170.16;
      if (powerHp <= 250) return 173.04;
      if (powerHp <= 280) return 176.52;
      if (powerHp <= 310) return 180;
      if (powerHp <= 340) return 186.36;
      if (powerHp <= 370) return 192.88;
      if (powerHp <= 400) return 199.68;
      if (powerHp <= 430) return 206.64;
      if (powerHp <= 460) return 213.84;
      if (powerHp <= 500) return 221.28;
      return 229.08;
    }
    // TKS/PP-1291 table for new cars with engine volume 3000–3500 cm³.
    // Boundaries are verified against TKS HAR fixtures (220/221 ... 370/371).
    if (powerHp <= 160) return 129.2;
    if (powerHp <= 190) return 131.76;
    if (powerHp <= 220) return 134.4;
    if (powerHp <= 250) return 137.16;
    if (powerHp <= 280) return 140.52;
    if (powerHp <= 310) return 144;
    if (powerHp <= 340) return 151.92;
    if (powerHp <= 370) return 160.32;
    if (powerHp <= 400) return 169.2;
    if (powerHp <= 430) return 178.44;
    if (powerHp <= 460) return 188.28;
    if (powerHp <= 500) return 198.6;
    return 209.52;
  }
  if (smallCc) {
    if (powerHp <= 160) return 0.26; if (powerHp <= 190) return 74.64; if (powerHp <= 220) return 79.2;
    if (powerHp <= 250) return 83.88; if (powerHp <= 270) return 91.92; if (powerHp <= 310) return 100.56;
    if (powerHp <= 340) return 110.16; if (powerHp <= 370) return 120.6; if (powerHp <= 400) return 132; return 144.6;
  }
  if (midCc) {
    if (powerHp <= 160) return 0.26; if (powerHp <= 190) return 172.8; if (powerHp <= 220) return 175.08;
    if (powerHp <= 250) return 177.6; if (powerHp <= 270) return 183; if (powerHp <= 310) return 188.52;
    if (powerHp <= 340) return 193.68; if (powerHp <= 370) return 199.08; if (powerHp <= 400) return 204.72;
    if (powerHp <= 430) return 210.48; if (powerHp <= 460) return 216.36; if (powerHp <= 500) return 222.36; return 228.6;
  }
  if (engineCc > 3500) {
    // TKS-confirmed bands for older cars with engine volume above 3500 cm³.
    if (powerHp <= 160) return 0.26;
    if (powerHp <= 300) return 219.48;
    if (powerHp <= 310) return 236.64;
    if (powerHp <= 340) return 249.6;
    if (powerHp <= 370) return 263.4;
    if (powerHp <= 400) return 277.92;
    if (powerHp <= 430) return 293.16;
    if (powerHp <= 460) return 309.36;
    if (powerHp <= 500) return 326.4;
    return 344.28;
  }
  // TKS-confirmed bands for older cars with engine volume 3001–3500 cm³.
  if (powerHp <= 160) return 197.81; if (powerHp <= 180) return 200.04; if (powerHp <= 200) return 202.2;
  if (powerHp <= 250) return 204.36; if (powerHp <= 270) return 207.24; if (powerHp <= 310) return 212.4;
  if (powerHp <= 340) return 217.8; if (powerHp <= 370) return 224.28; if (powerHp <= 400) return 231;
  if (powerHp <= 430) return 237.96; if (powerHp <= 460) return 245.04; if (powerHp <= 500) return 252.48; return 260.04;
}

function getCustomsFeeRub(customsValueRub: number) {
  if (customsValueRub <= 200_000) return 1_231;
  if (customsValueRub <= 450_000) return 2_462;
  if (customsValueRub <= 1_200_000) return 4_924;
  if (customsValueRub <= 2_700_000) return 13_541;
  if (customsValueRub <= 4_200_000) return 18_465;
  if (customsValueRub <= 5_500_000) return 21_344;
  if (customsValueRub <= 10_000_000) return 49_240;
  // TKS HAR keeps 49,240 ₽ at 10,000,001 ₽; keep this fallback until the
  // next threshold is captured from TKS rather than introducing an unverified jump.
  return 49_240;
}

export function calculateRuVladivostok(input: CalcInput): CalcResult {
  const powerHp = input.hybridDvsPowerHp != null
    ? input.hybridDvsPowerHp + (input.hybridElectricPowerKw ?? 0) * KW_TO_HP
    : input.powerHp;
  if (powerHp == null || !Number.isFinite(powerHp)) throw new Error("Engine power is required");
  const rates: CalcRates = {
    krwRub: input.rates?.krwRub ?? DEFAULT_RATES.krwRub,
    eurRub: input.rates?.eurRub ?? DEFAULT_RATES.eurRub,
    usdRub: input.rates?.usdRub ?? DEFAULT_RATES.usdRub,
    kztRub: input.rates?.kztRub ?? DEFAULT_RATES.kztRub,
  };
  const calculationDate = input.calculationDate ? new Date(input.calculationDate) : new Date();
  if (Number.isNaN(calculationDate.getTime())) throw new Error("Invalid calculation date");
  const clearanceDate = getClearanceDate(calculationDate, input.clearanceDays);
  const currentCarAgeYears = getCarAgeYears(input.year, input.month || 6, calculationDate);
  const carAgeYears = getCarAgeYears(input.year, input.month || 6, clearanceDate);
  const customsValueRub = input.priceKrw * rates.krwRub;
  const carPriceRub = Math.round(customsValueRub);
  const customs = getIndividualDutyRub({ priceRub: customsValueRub, engineCc: input.engineCc, ageYearsAtClearance: carAgeYears, eurRub: rates.eurRub });
  const freightRub = Math.round(FREIGHT_USD * rates.usdRub);
  const koreaExpensesRub = Math.round(KOREA_EXPENSES_KRW * rates.krwRub);
  const brokerRub = BROKER_RUB;
  const feesRub = getCustomsFeeRub(customsValueRub);
  const utilCoefficient = getUtilCoeff(powerHp, input.engineCc, carAgeYears < 3);
  const utilRub = Math.round(UTIL_BASE_RUB * utilCoefficient);
  const totalRub = roundRub(customsValueRub + freightRub + koreaExpensesRub + brokerRub + customs.dutyRub + feesRub + utilRub);
  return {
    countryCode: "RU", destinationCity: "Владивосток", importerType: "individual", calcVersion: CALC_VERSION,
    carPriceRub, freightRub, brokerRub, dutyRub: customs.dutyRub, exciseRub: 0, vatRub: 0, feesRub, utilRub, totalRub,
    rates, ratesAsOf: input.ratesAsOf ?? null, ratesSource: input.ratesSource ?? "provided-or-default",
    rateDetails: input.rateDetails ?? null,
    koreaExpensesRub,
    customs: { eurPerCc: customs.eurPerCc, percentRate: customs.percentRate, mode: customs.mode, excisePerHp: 0, vatRate: 0 },
    util: { baseRub: UTIL_BASE_RUB, coefficient: utilCoefficient },
    estimatedClearanceDate: clearanceDate.toISOString(), carAgeYears: Number(carAgeYears.toFixed(3)), currentCarAgeYears: Number(currentCarAgeYears.toFixed(3)),
    disclaimer: "Расчёт предварительный: итог зависит от курса, даты оформления, состояния авто и фактических расходов.",
  };
}
