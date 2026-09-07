import type { CalcInput, CalcRates, CalcResult } from "./types";
import {
  tksCustomsFeeRub,
  tksDutyVolumeRate,
  tksNewPriceRate,
  tksUtilCoefficient,
  tksUtilCoefficientKwForPropulsion,
  tksStpExciseRub,
} from "./tks-rules";

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
    const band = tksNewPriceRate(priceEur);
    [eurPerCc, percent] = [band.eurPerCc, band.percent];
  } else if (ageYearsAtClearance <= 5) {
    eurPerCc = tksDutyVolumeRate("from_3_to_5", engineCc);
    percent = 0.154;
  } else {
    eurPerCc = tksDutyVolumeRate("over_7", engineCc);
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

export function calculateRuVladivostok(input: CalcInput): CalcResult {
  const powerHp = input.hybridDvsPowerHp != null
    ? input.hybridDvsPowerHp + (input.hybridElectricPowerKw ?? 0) * KW_TO_HP
    : input.powerHp;
  const hybridDvsPowerKw = input.hybridDvsPowerKw
    ?? (input.hybridDvsPowerHp != null ? input.hybridDvsPowerHp / KW_TO_HP : null);
  const hybridPowerKw = input.hybridSequential
    ? (input.hybridElectricPowerKw ?? input.powerKw ?? null)
    : hybridDvsPowerKw != null && input.hybridElectricPowerKw != null
      ? hybridDvsPowerKw + input.hybridElectricPowerKw
      : null;
  const powerKw = hybridPowerKw ?? input.powerKw;
  if ((powerHp == null || !Number.isFinite(powerHp)) && (powerKw == null || !Number.isFinite(powerKw))) throw new Error("Engine power is required");
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
  const propulsion = input.hybridSequential
    ? "hybrid_sequential" as const
    : input.fuelType === "electric"
      ? "electric" as const
      : input.fuelType === "petrol_electric" || input.fuelType === "diesel_electric" || input.fuelType === "hybrid"
        ? "hybrid_parallel" as const
        : "ice" as const;
  const usesStp = propulsion === "electric" || propulsion === "hybrid_sequential";
  const customs = usesStp
    ? { dutyRub: roundRub(customsValueRub * 0.15), eurPerCc: 0, percentRate: 0.15, mode: "stp" as const, excisePerHp: 0, vatRate: 0.22 }
    : getIndividualDutyRub({ priceRub: customsValueRub, engineCc: input.engineCc ?? 0, ageYearsAtClearance: carAgeYears, eurRub: rates.eurRub });
  const freightRub = Math.round(FREIGHT_USD * rates.usdRub);
  const koreaExpensesRub = Math.round(KOREA_EXPENSES_KRW * rates.krwRub);
  const brokerRub = BROKER_RUB;
  const feesRub = tksCustomsFeeRub(customsValueRub);
  const utilCoefficient = powerKw != null
    ? tksUtilCoefficientKwForPropulsion(powerKw, input.engineCc ?? 0, carAgeYears < 3 ? "under_3" : "older", propulsion)
    : tksUtilCoefficient(powerHp!, input.engineCc ?? 0, carAgeYears < 3 ? "under_3" : "older", input.hybridSequential === true);
  const utilRub = Math.round(UTIL_BASE_RUB * utilCoefficient);
  const exciseRub = usesStp ? roundRub(tksStpExciseRub(powerKw!)) : 0;
  const vatRub = usesStp ? roundRub((customsValueRub + customs.dutyRub + exciseRub) * 0.22) : 0;
  const totalRub = roundRub(customsValueRub + freightRub + koreaExpensesRub + brokerRub + customs.dutyRub + exciseRub + vatRub + feesRub + utilRub);
  return {
    countryCode: "RU", destinationCity: "Владивосток", importerType: "individual", calcVersion: CALC_VERSION,
    carPriceRub, freightRub, brokerRub, dutyRub: customs.dutyRub, exciseRub, vatRub, feesRub, utilRub, totalRub,
    rates, ratesAsOf: input.ratesAsOf ?? null, ratesSource: input.ratesSource ?? "provided-or-default",
    rateDetails: input.rateDetails ?? null,
    koreaExpensesRub,
    customs: { eurPerCc: customs.eurPerCc, percentRate: customs.percentRate, mode: customs.mode, excisePerHp: usesStp ? tksStpExciseRub(powerKw!) / (powerKw! * KW_TO_HP) : 0, vatRate: usesStp ? 0.22 : 0 },
    util: { baseRub: UTIL_BASE_RUB, coefficient: utilCoefficient },
    estimatedClearanceDate: clearanceDate.toISOString(), carAgeYears: Number(carAgeYears.toFixed(3)), currentCarAgeYears: Number(currentCarAgeYears.toFixed(3)),
    disclaimer: "Расчёт предварительный: итог зависит от курса, даты оформления, состояния авто и фактических расходов.",
  };
}
