/** Minimal project-neutral boundary for the approved TL Auto power resolver. */
export type SharedPowerInput = {
  source: string;
  sourceListingId: string;
  manufacturer: string | null;
  model: string | null;
  generation?: string | null;
  trim?: string | null;
  badge?: string | null;
  modelCode?: string | null;
  engineCode?: string | null;
  fuel?: string | null;
  drive?: string | null;
  modelYear?: number | null;
  engineCc?: number | null;
};

export type SharedPowerResult =
  | { status: "resolved"; powerKw: number; powerHp: number; basis: string; propulsionType: string; dvsPowerKw: number | null; electricPowerKw30Min: number | null; specId: string; specVersion: number; evidenceId: string; evidenceKind: string; evidenceTier: string; confidence: string; sourceUri: string | null; sourceTitle: string | null }
  | { status: "review_required" | "not_found"; reason: string };

/** The shared calculator boundary requires an explicit source month; callers must not synthesize it. */
export type SharedTksInput = {
  priceKrw: number;
  year: number;
  month: number;
  engineCc: number;
  powerKw: number;
  powerBasis: string;
  hybridDvsPowerKw?: number;
  hybridElectricPowerKw?: number;
  hybridSequential?: boolean;
  fuelType: string;
  calculationDate: string;
  rates: { krwRub: number; eurRub: number; usdRub: number; kztRub: number };
  customsRates: { krwRub: number; eurRub: number };
  ratesAsOf: string;
  ratesSource: string;
};
