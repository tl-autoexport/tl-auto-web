import type { CalcRates } from "./types";

export const KZ_CALC_VERSION = "kz-almaty-no-customs-2026.01";

export type KzTariffs = {
  koreaExpensesKrw: number;
  deliveryUsd: number;
  serviceFeeKzt: number;
};

export type KzCalculation = {
  calculationStatus: "ready";
  countryCode: "KZ";
  destinationCity: "Алматы";
  currencyCode: "KZT";
  currencySymbol: "₸";
  calcVersion: string;
  carPriceKzt: number;
  koreaExpensesKzt: number;
  deliveryKzt: number;
  serviceFeeKzt: number;
  customsKzt: 0;
  totalKzt: number;
  rates: { krwKzt: number; usdKzt: number; kztRub: number };
  ratesAsOf: string | null;
  ratesSource: string;
  disclaimer: string;
};

function positiveEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function getKzTariffs(): { tariffs: KzTariffs | null; missing: string[] } {
  const values = {
    koreaExpensesKrw: positiveEnv("KZ_KOREA_EXPENSES_KRW"),
    deliveryUsd: positiveEnv("KZ_ALMATY_DELIVERY_USD"),
    serviceFeeKzt: positiveEnv("KZ_SERVICE_FEE_KZT"),
  };
  const missing = [
    values.koreaExpensesKrw == null ? "расходы в Корее" : null,
    values.deliveryUsd == null ? "доставка до Алматы" : null,
    values.serviceFeeKzt == null ? "комиссия компании" : null,
  ].filter((item): item is string => item != null);
  return { tariffs: missing.length === 0 ? values as KzTariffs : null, missing };
}

export function calculateKzAlmaty(input: {
  priceKrw: number;
  rates: CalcRates;
  tariffs: KzTariffs;
  ratesAsOf?: string | null;
  ratesSource?: string;
}): KzCalculation {
  if (!Number.isFinite(input.rates.kztRub) || input.rates.kztRub <= 0) throw new Error("Invalid KZT rate");
  const krwKzt = input.rates.krwRub / input.rates.kztRub;
  const usdKzt = input.rates.usdRub / input.rates.kztRub;
  const carPriceKzt = Math.round(input.priceKrw * krwKzt);
  const koreaExpensesKzt = Math.round(input.tariffs.koreaExpensesKrw * krwKzt);
  const deliveryKzt = Math.round(input.tariffs.deliveryUsd * usdKzt);
  const totalKzt = carPriceKzt + koreaExpensesKzt + deliveryKzt + input.tariffs.serviceFeeKzt;
  return {
    calculationStatus: "ready",
    countryCode: "KZ",
    destinationCity: "Алматы",
    currencyCode: "KZT",
    currencySymbol: "₸",
    calcVersion: KZ_CALC_VERSION,
    carPriceKzt,
    koreaExpensesKzt,
    deliveryKzt,
    serviceFeeKzt: input.tariffs.serviceFeeKzt,
    customsKzt: 0,
    totalKzt,
    rates: { krwKzt, usdKzt, kztRub: input.rates.kztRub },
    ratesAsOf: input.ratesAsOf ?? null,
    ratesSource: input.ratesSource ?? "provided-or-default",
    disclaimer: "Предварительный расчёт в тенге без таможенного оформления в Казахстане. Итог зависит от курса и фактических расходов по доставке.",
  };
}
