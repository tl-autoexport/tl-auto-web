export type TksAgeGroup = "under_3" | "from_3_to_5" | "from_5_to_7" | "over_7";

export type TksCustomsFeeBand = {
  maxRub: number;
  feeRub: number;
};

/** Fixed customs-clearance fees used by the individual-import TKS regime. */
export const TKS_CUSTOMS_FEE_BANDS: readonly TksCustomsFeeBand[] = [
  { maxRub: 200_000, feeRub: 1_231 },
  { maxRub: 450_000, feeRub: 2_462 },
  { maxRub: 1_200_000, feeRub: 4_924 },
  { maxRub: 2_700_000, feeRub: 13_541 },
  { maxRub: 4_200_000, feeRub: 18_465 },
  { maxRub: 5_500_000, feeRub: 21_344 },
  { maxRub: 10_000_000, feeRub: 49_240 },
  // The next TKS threshold is not yet captured in our HAR set. Keep the
  // last verified value explicit until that control is recorded.
  { maxRub: Number.POSITIVE_INFINITY, feeRub: 49_240 },
];

export type TksDutyVolumeBand = {
  maxCc: number;
  eurPerCc: number;
};

export const TKS_DUTY_VOLUME_BANDS: Readonly<Record<Exclude<TksAgeGroup, "under_3"> , readonly TksDutyVolumeBand[]>> = {
  from_3_to_5: [
    { maxCc: 1_000, eurPerCc: 1.5 }, { maxCc: 1_500, eurPerCc: 1.7 },
    { maxCc: 1_800, eurPerCc: 2.5 }, { maxCc: 2_300, eurPerCc: 2.7 },
    { maxCc: 3_000, eurPerCc: 3 }, { maxCc: Number.POSITIVE_INFINITY, eurPerCc: 3.6 },
  ],
  from_5_to_7: [
    { maxCc: 1_000, eurPerCc: 3 }, { maxCc: 1_500, eurPerCc: 3.2 },
    { maxCc: 1_800, eurPerCc: 3.5 }, { maxCc: 2_300, eurPerCc: 4.8 },
    { maxCc: 3_000, eurPerCc: 5 }, { maxCc: Number.POSITIVE_INFINITY, eurPerCc: 5.7 },
  ],
  over_7: [
    { maxCc: 1_000, eurPerCc: 3 }, { maxCc: 1_500, eurPerCc: 3.2 },
    { maxCc: 1_800, eurPerCc: 3.5 }, { maxCc: 2_300, eurPerCc: 4.8 },
    { maxCc: 3_000, eurPerCc: 5 }, { maxCc: Number.POSITIVE_INFINITY, eurPerCc: 5.7 },
  ],
};

export type TksNewPriceBand = { maxEur: number; eurPerCc: number; percent: number };

export const TKS_NEW_PRICE_BANDS: readonly TksNewPriceBand[] = [
  { maxEur: 8_500, eurPerCc: 2.5, percent: 0.54 },
  { maxEur: 16_700, eurPerCc: 3.5, percent: 0.48 },
  { maxEur: 42_300, eurPerCc: 5.5, percent: 0.48 },
  { maxEur: 84_500, eurPerCc: 7.5, percent: 0.48 },
  { maxEur: 169_000, eurPerCc: 15, percent: 0.48 },
  { maxEur: Number.POSITIVE_INFINITY, eurPerCc: 20, percent: 0.48 },
];

export function tksCustomsFeeRub(customsValueRub: number) {
  return TKS_CUSTOMS_FEE_BANDS.find((band) => customsValueRub <= band.maxRub)?.feeRub ?? 49_240;
}

export function tksDutyVolumeRate(ageGroup: Exclude<TksAgeGroup, "under_3">, engineCc: number) {
  return TKS_DUTY_VOLUME_BANDS[ageGroup].find((band) => engineCc <= band.maxCc)?.eurPerCc ?? 5.7;
}

export function tksNewPriceRate(priceEur: number) {
  return TKS_NEW_PRICE_BANDS.find((band) => priceEur <= band.maxEur) ?? TKS_NEW_PRICE_BANDS.at(-1)!;
}

type UtilBand = { maxHp: number; coefficient: number };
const bands = (...values: Array<[number, number]>): readonly UtilBand[] =>
  values.map(([maxHp, coefficient]) => ({ maxHp, coefficient }));

type KwUtilBand = { maxKw: number; coefficient: number };
const kwBands = (...values: Array<[number, number]>): readonly KwUtilBand[] =>
  values.map(([maxKw, coefficient]) => ({ maxKw, coefficient }));

const TKS_UTIL_NEW: Record<"up_to_1000" | "up_to_2000" | "2001_to_3000" | "3001_to_3500" | "over_3500", readonly UtilBand[]> = {
  up_to_1000: bands([160, 0.17], [190, 15.36], [220, 15.84], [250, 16.2], [Number.POSITIVE_INFINITY, 17.28]),
  up_to_2000: bands([160, 0.17], [190, 45], [220, 47.64], [250, 50.52], [280, 57.12], [310, 64.56], [340, 72.96], [370, 83.16], [400, 94.8], [430, 108], [460, 123.24], [500, 140.4], [Number.POSITIVE_INFINITY, 160.08]),
  "2001_to_3000": bands([160, 0.17], [190, 115.34], [220, 118.2], [250, 120.12], [280, 126], [310, 131.04], [340, 136.32], [370, 141.72], [400, 147.48], [430, 153.36], [460, 159.48], [500, 165.84], [Number.POSITIVE_INFINITY, 172.44]),
  "3001_to_3500": bands([160, 129.2], [190, 131.76], [220, 134.4], [250, 137.16], [280, 140.52], [310, 144], [340, 151.92], [370, 160.32], [400, 169.2], [430, 178.44], [460, 188.28], [500, 198.6], [Number.POSITIVE_INFINITY, 209.52]),
  over_3500: bands([160, 164.53], [190, 167.28], [220, 170.16], [250, 173.04], [280, 176.52], [310, 180], [340, 186.36], [370, 192.88], [400, 199.68], [430, 206.64], [460, 213.84], [500, 221.28], [Number.POSITIVE_INFINITY, 229.08]),
};

const TKS_UTIL_OLDER: Record<"up_to_1000" | "up_to_2000" | "2001_to_3000" | "3001_to_3500" | "over_3500", readonly UtilBand[]> = {
  up_to_1000: bands([160, 0.26], [190, 28.44], [220, 29.28], [250, 30.12], [Number.POSITIVE_INFINITY, 30.12]),
  up_to_2000: bands([160, 0.26], [190, 74.64], [220, 79.2], [250, 83.88], [280, 91.92], [310, 100.56], [340, 110.16], [370, 120.6], [400, 132], [430, 144.6], [460, 158.4], [500, 173.4], [Number.POSITIVE_INFINITY, 189.84]),
  "2001_to_3000": bands([160, 0.26], [190, 172.8], [220, 175.08], [250, 177.6], [280, 183], [310, 188.52], [340, 193.68], [370, 199.08], [400, 204.72], [430, 210.48], [460, 216.36], [500, 222.36], [Number.POSITIVE_INFINITY, 228.6]),
  "3001_to_3500": bands([160, 197.81], [190, 200.04], [220, 202.2], [250, 204.36], [280, 207.24], [310, 212.4], [340, 217.8], [370, 224.28], [400, 231], [430, 237.96], [460, 245.04], [500, 252.48], [Number.POSITIVE_INFINITY, 260.04]),
  over_3500: bands([160, 216.29], [190, 219.48], [220, 222.84], [250, 226.2], [280, 231.36], [310, 236.64], [340, 249.6], [370, 263.4], [400, 277.92], [430, 293.16], [460, 309.36], [500, 326.4], [Number.POSITIVE_INFINITY, 344.28]),
};

const TKS_UTIL_SEQUENTIAL: readonly UtilBand[] = bands([160, 111.36], [190, 129.72], [191, 151.2], [Number.POSITIVE_INFINITY, 239.04]);

/**
 * Direct kW bands from the 2026 TKS table (the table's displayed kW values
 * are the tariff boundaries; they must not be reconstructed by converting HP).
 * The table has two age columns: under three years and from three years.
 * TKS uses the same latter coefficient for all older age buckets here.
 */
const TKS_UTIL_KW_2026 = {
  electric: {
    under_3: kwBands(
      [58.84, 0.17], [73.55, 49.56], [95.61, 65.88], [117.68, 78],
      [139.75, 92.4], [161.81, 109.68], [183.88, 129.96], [205.94, 153.96],
      [Number.POSITIVE_INFINITY, 182.4],
    ),
    older: kwBands(
      [58.84, 0.26], [73.55, 82.08], [95.61, 95.64], [117.68, 111.36],
      [139.75, 129.72], [161.81, 151.2], [183.88, 176.16], [205.94, 205.2],
      [Number.POSITIVE_INFINITY, 239.04],
    ),
  },
  ice: {
    up_to_1000: {
      under_3: kwBands(
        [117.68, 0.17], [139.75, 15.36], [161.81, 15.84], [183.88, 16.2],
        [Number.POSITIVE_INFINITY, 17.28],
      ),
      older: kwBands(
        [117.68, 0.26], [139.75, 28.44], [161.81, 29.28], [183.88, 30.12],
        [Number.POSITIVE_INFINITY, 30.12],
      ),
    },
    up_to_2000: {
      under_3: kwBands(
        [117.68, 0.17], [139.75, 45], [161.81, 47.64], [183.88, 50.52],
        [205.94, 57.12], [228, 64.56], [250.07, 72.96], [272.13, 83.16],
        [294.2, 94.8], [316.26, 108], [338.33, 123.24], [367.75, 140.4],
        [367.76, 160.08],
      ),
      older: kwBands(
        [117.68, 0.26], [139.75, 74.64], [161.81, 79.2], [183.88, 83.88],
        [205.94, 91.92], [228, 100.56], [250.07, 110.16], [272.13, 120.6],
        [294.2, 132], [316.26, 144.6], [338.33, 158.4], [367.75, 173.4],
        [367.76, 189.84],
      ),
    },
    "2001_to_3000": {
      under_3: kwBands(
        [117.68, 0.17], [139.75, 115.34], [161.81, 118.2], [183.88, 120.12],
        [205.94, 126], [228, 131.04], [250.07, 136.32], [272.13, 141.72],
        [294.2, 147.48], [316.26, 153.36], [338.33, 159.48], [367.75, 165.84],
        [367.76, 172.44],
      ),
      older: kwBands(
        [117.68, 0.26], [139.75, 172.8], [161.81, 175.08], [183.88, 177.6],
        [205.94, 183], [228, 188.52], [250.07, 193.68], [272.13, 199.08],
        [294.2, 204.72], [316.26, 210.48], [338.33, 216.36], [367.75, 222.36],
        [367.76, 228.6],
      ),
    },
    "3001_to_3500": {
      under_3: kwBands(
        [117.68, 129.2], [139.75, 131.76], [161.81, 134.4], [183.88, 137.16],
        [205.94, 140.52], [228, 144], [250.07, 151.92], [272.13, 160.32],
        [294.2, 169.2], [316.26, 178.44], [338.33, 188.28], [367.75, 198.6],
        [367.76, 209.52],
      ),
      older: kwBands(
        [117.68, 197.81], [139.75, 200.04], [161.81, 202.2], [183.88, 204.36],
        [205.94, 207.24], [228, 212.4], [250.07, 217.8], [272.13, 224.28],
        [294.2, 231], [316.26, 237.96], [338.33, 245.04], [367.75, 252.48],
        [367.76, 260.04],
      ),
    },
    over_3500: {
      under_3: kwBands(
        [117.68, 164.53], [139.75, 167.28], [161.81, 170.16], [183.88, 173.04],
        [205.94, 176.52], [228, 180], [250.07, 186.36], [272.13, 192.88],
        [294.2, 199.68], [316.26, 206.64], [338.33, 213.84], [367.75, 221.28],
        [367.76, 229.08],
      ),
      older: kwBands(
        [117.68, 216.29], [139.75, 219.48], [161.81, 222.84], [183.88, 226.2],
        [205.94, 231.36], [228, 236.64], [250.07, 249.6], [272.13, 263.4],
        [294.2, 277.92], [316.26, 293.16], [338.33, 309.36], [367.75, 326.4],
        [367.76, 344.28],
      ),
    },
  },
} as const;

function volumeGroup(engineCc: number): keyof typeof TKS_UTIL_NEW {
  if (engineCc <= 1000) return "up_to_1000";
  if (engineCc <= 2000) return "up_to_2000";
  if (engineCc <= 3000) return "2001_to_3000";
  if (engineCc <= 3500) return "3001_to_3500";
  return "over_3500";
}

export function tksUtilCoefficient(powerHp: number, engineCc: number, ageGroup: "under_3" | "older", sequentialHybrid = false) {
  const table = sequentialHybrid ? TKS_UTIL_SEQUENTIAL : (ageGroup === "under_3" ? TKS_UTIL_NEW : TKS_UTIL_OLDER)[volumeGroup(engineCc)];
  return table.find((band) => powerHp <= band.maxHp)?.coefficient ?? table.at(-1)!.coefficient;
}

export function tksUtilCoefficientKw(powerKw: number, engineCc: number, ageGroup: "under_3" | "older", sequentialHybrid = false) {
  const source = sequentialHybrid
    ? TKS_UTIL_KW_2026.electric[ageGroup]
    : TKS_UTIL_KW_2026.ice[engineCc <= 1000 ? "up_to_1000" : engineCc <= 2000 ? "up_to_2000" : volumeGroup(engineCc)][ageGroup];
  const table = source;
  return table.find((band) => powerKw <= band.maxKw)?.coefficient ?? table.at(-1)!.coefficient;
}

export function tksUtilCoefficientKwForPropulsion(
  powerKw: number,
  engineCc: number,
  ageGroup: "under_3" | "older",
  propulsion: "ice" | "electric" | "hybrid_parallel" | "hybrid_sequential",
) {
  if (propulsion === "electric" || propulsion === "hybrid_sequential") {
    const table = TKS_UTIL_KW_2026.electric[ageGroup];
    return table.find((band) => powerKw <= band.maxKw)?.coefficient ?? table.at(-1)!.coefficient;
  }
  return tksUtilCoefficientKw(powerKw, engineCc, ageGroup, false);
}

/**
 * 2026 TKS standard customs (СТП) excise for EV and sequential hybrids.
 * TKS displays each band as `rate руб./0.75 кВт`; the payable amount is
 * rate × (30-minute electric power / 0.75). Boundaries are inclusive.
 */
export const TKS_STP_EXCISE_KW_BANDS = [
  { maxKw: 67.5, rateRubPer075Kw: 0 },
  { maxKw: 112.5, rateRubPer075Kw: 64 },
  { maxKw: 150, rateRubPer075Kw: 613 },
  { maxKw: 225, rateRubPer075Kw: 1004 },
  { maxKw: 300, rateRubPer075Kw: 1711 },
  { maxKw: 375, rateRubPer075Kw: 1771 },
  { maxKw: Number.POSITIVE_INFINITY, rateRubPer075Kw: 1829 },
] as const;

export function tksStpExciseRub(powerKw: number) {
  const band = TKS_STP_EXCISE_KW_BANDS.find((item) => powerKw <= item.maxKw)
    ?? TKS_STP_EXCISE_KW_BANDS.at(-1)!;
  return band.rateRubPer075Kw * (powerKw / 0.75);
}
