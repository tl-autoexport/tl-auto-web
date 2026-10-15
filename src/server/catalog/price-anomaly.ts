/** Conservative pre-publication comparison of source vehicle prices to active catalog analogs. */

export type PriceVehicle = {
  sourceId: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  mileageKm: number | null;
  priceKrw: number | null;
};

export type PriceAnalogVerdict = {
  status: "comparable" | "insufficient_comparables" | "price_outlier";
  analogCount: number;
  medianPriceKrw: number | null;
  ratioToMedian: number | null;
  band: "year_±2_cc_±20%" | "year_±4_cc_±30%" | null;
};

const MIN_ANALOGS = 5;
const MIN_PRICE_RATIO = 0.45;
const MAX_PRICE_RATIO = 2.2;
const normalize = (value: string | null) => (value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Requires at least five active analogs with same make/model/fuel and close year/engine.
 * If fewer are available, return an informational status; lack of analogs alone must not
 * prevent publication. Price bands are
 * intentionally broad to avoid rejecting trim-level price variation automatically.
 */
export function assessPriceAgainstAnalogs(candidate: PriceVehicle, inventory: PriceVehicle[]): PriceAnalogVerdict {
  const brand = normalize(candidate.brand), model = normalize(candidate.model), fuel = normalize(candidate.fuelType);
  const price = Number(candidate.priceKrw), year = Number(candidate.year), cc = Number(candidate.engineCc);
  if (!brand || !model || !fuel || !Number.isFinite(price) || price <= 0 || !Number.isFinite(year) || !Number.isFinite(cc) || cc <= 0) {
    return { status: "insufficient_comparables", analogCount: 0, medianPriceKrw: null, ratioToMedian: null, band: null };
  }
  const peers = inventory.filter((peer) => peer.sourceId !== candidate.sourceId && normalize(peer.brand) === brand &&
    normalize(peer.model) === model && normalize(peer.fuelType) === fuel && Number.isFinite(Number(peer.priceKrw)) &&
    Number(peer.priceKrw) > 0 && Number.isFinite(Number(peer.year)) && Number.isFinite(Number(peer.engineCc)) && Number(peer.engineCc) > 0);
  const select = (yearWindow: number, ccTolerance: number) => peers.filter((peer) =>
    Math.abs(Number(peer.year) - year) <= yearWindow && Math.abs(Number(peer.engineCc) - cc) / cc <= ccTolerance);
  let analogs = select(2, 0.2);
  let band: PriceAnalogVerdict["band"] = "year_±2_cc_±20%";
  if (analogs.length < MIN_ANALOGS) {
    analogs = select(4, 0.3);
    band = "year_±4_cc_±30%";
  }
  if (analogs.length < MIN_ANALOGS) {
    return { status: "insufficient_comparables", analogCount: analogs.length, medianPriceKrw: null, ratioToMedian: null, band: null };
  }
  const medianPriceKrw = median(analogs.map((peer) => Number(peer.priceKrw)));
  const ratioToMedian = price / medianPriceKrw;
  return {
    status: ratioToMedian < MIN_PRICE_RATIO || ratioToMedian > MAX_PRICE_RATIO ? "price_outlier" : "comparable",
    analogCount: analogs.length,
    medianPriceKrw: Math.round(medianPriceKrw),
    ratioToMedian: Number(ratioToMedian.toFixed(3)),
    band,
  };
}

/** Encar's price is a sale price only for NORMAL sale advertisements. */
export function isEncarSaleAdvertisement(advertisementType: unknown): boolean {
  return String(advertisementType ?? "").trim().toUpperCase() === "NORMAL";
}
