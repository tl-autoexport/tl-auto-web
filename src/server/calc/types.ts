export interface CalcInput {
  priceKrw: number;
  year: number;
  month: number;
  engineCc: number;
  powerHp: number;
  fuelType?: string;
  countryCode?: "RU";
  destinationCity?: "Владивосток";
  importerType?: "individual";
  rates?: Partial<CalcRates>;
  ratesAsOf?: string | null;
  ratesSource?: string;
  calculationDate?: string;
  clearanceDays?: number;
}

export interface CalcRates {
  krwRub: number;
  usdRub: number;
  eurRub: number;
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
