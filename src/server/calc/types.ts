export interface CalcInput {
  priceKrw: number;
  year: number;
  month: number;
  engineCc: number;
  powerHp: number;
  fuelType?: string;
  countryCode?: "RU" | "KZ" | "BY" | "UZ" | "KG" | "DE" | "SE" | "IT" | "NL" | "AE";
  destinationCity?: string;
  importerType?: "individual";
  rates?: Partial<CalcRates>;
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
  destinationCity: "Владивосток";
  importerType: "individual";
  calcVersion: string;
  carPriceRub: number;
  freightRub: number;
  brokerRub: number;
  dutyRub: number;
  exciseRub: number;
  vatRub: number;
  feesRub: number;
  utilRub: number;
  totalRub: number;
  rates: CalcRates;
  ratesAsOf: string | null;
  ratesSource: string;
  rateDetails: CalcRateDetails | null;
  koreaExpensesRub: number;
  customs: {
    eurPerCc: number;
    percentRate: number;
    mode: "volume" | "value" | "hybrid";
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
