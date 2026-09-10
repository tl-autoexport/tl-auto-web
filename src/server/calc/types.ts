export interface CalcInput {
  priceKrw: number;
  year: number;
  month: number;
  /** EVs have no combustion displacement; use null for a pure EV. */
  engineCc: number | null;
  powerHp?: number;
  /** Exact TKS input in kW. Use this when the source provides kW; no display rounding is applied. */
  powerKw?: number;
  /** Hybrid input fields mirror TKS: engine power is the value used for utility bands. */
  hybridDvsPowerHp?: number;
  hybridDvsPowerKw?: number;
  hybridElectricPowerKw?: number;
  hybridDvsAboveElectric30Min?: boolean;
  hybridSequential?: boolean;
  fuelType?: string;
  countryCode?: "RU" | "KZ" | "BY" | "UZ" | "KG" | "DE" | "SE" | "IT" | "NL" | "AE";
  destinationCity?: string;
  importerType?: "individual";
  rates?: Partial<CalcRates>;
  /** Official Central Bank rates used exclusively for customs value and state payments. */
  customsRates?: Partial<CustomsRates>;
  ratesAsOf?: string | null;
  ratesSource?: string;
  rateDetails?: CalcRateDetails;
  calculationDate?: string;
  clearanceDays?: number;
}

export interface CalcRates {
  krwRub: number;
  usdRub: number;
  eurRub: number;
  kztRub: number;
}

/**
 * Customs conversion is deliberately isolated from the commercial TL Auto
 * conversion. TKS uses the official Central Bank rate for customs value.
 */
export interface CustomsRates {
  krwRub: number;
  eurRub: number;
}

export interface CalcRateDetails {
  cbrMarkupPercent: number;
  cbrUsdRub: number;
  cbrEurRub: number;
  cbrKrwRub: number;
  cbrKztRub: number;
  usdtKrwRaw: number;
  usdtKrwAdjustment: number;
  usdtKrwAdjusted: number;
  fetchedAt: string;
  source: string;
}

export interface CalcResult {
  countryCode: "RU";
  destinationCity: "Владивосток" | "Уссурийск" | "Москва";
  importerType: "individual";
  calcVersion: string;
  carPriceRub: number;
  /** Customs value in rubles, converted at the official Central Bank rate. */
  customsValueRub: number;
  freightRub: number;
  brokerRub: number;
  deliveryRub: number;
  serviceFeeRub: number;
  dutyRub: number;
  exciseRub: number;
  vatRub: number;
  feesRub: number;
  utilRub: number;
  totalRub: number;
  rates: CalcRates;
  customsRates: CustomsRates;
  ratesAsOf: string | null;
  ratesSource: string;
  rateDetails: CalcRateDetails | null;
  koreaExpensesRub: number;
  customs: {
    eurPerCc: number;
    percentRate: number;
    mode: "volume" | "value" | "hybrid" | "stp";
    excisePerHp: number;
    vatRate: number;
  };
  util: {
    baseRub: number;
    coefficient: number;
  };
  estimatedClearanceDate: string;
  carAgeYears: number;
  currentCarAgeYears: number;
  disclaimer: string;
}
