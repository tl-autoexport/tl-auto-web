import type { CalcRates } from "./types";

export const POWERSPORTS_ROUTE_USD = 4_500;

const MOTORCYCLE_RUSSIAN_COSTS = [
  { label: "Брокерские услуги", amountRub: 50_000 },
  { label: "Комиссия под ключ", amountRub: 50_000 },
] as const;

const JETSKI_RUSSIAN_COSTS = [
  { label: "Комиссия под ключ", amountRub: 50_000 },
  { label: "Судовой билет", amountRub: 50_000 },
] as const;

export type PowersportsCategory = "motorcycle" | "jetski";

export type PowersportsCalculation = {
  category: PowersportsCategory;
  sourcePriceKrw: number | null;
  sourcePriceRub: number | null;
  routeAndClearanceUsd: number;
  routeAndClearanceRub: number | null;
  russianCosts: ReadonlyArray<{ label: string; amountRub: number }>;
  russianCostsRub: number;
  totalRub: number | null;
  rates: CalcRates | null;
  disclaimer: string;
};

export function calculatePowersportsPrice(
  category: PowersportsCategory,
  priceKrw: number | null,
  rates: CalcRates | null,
): PowersportsCalculation {
  const russianCosts = category === "jetski" ? JETSKI_RUSSIAN_COSTS : MOTORCYCLE_RUSSIAN_COSTS;
  const russianCostsRub = russianCosts.reduce((total, item) => total + item.amountRub, 0);
  const hasPrice = priceKrw != null && Number.isFinite(priceKrw) && priceKrw >= 0;
  const sourcePriceRub = hasPrice && rates ? Math.round(priceKrw * rates.krwRub) : null;
  const routeAndClearanceRub = rates ? Math.round(POWERSPORTS_ROUTE_USD * rates.usdRub) : null;
  const totalRub = sourcePriceRub != null && routeAndClearanceRub != null
    ? sourcePriceRub + routeAndClearanceRub + russianCostsRub
    : null;

  return {
    category,
    sourcePriceKrw: hasPrice ? priceKrw : null,
    sourcePriceRub,
    routeAndClearanceUsd: POWERSPORTS_ROUTE_USD,
    routeAndClearanceRub,
    russianCosts,
    russianCostsRub,
    totalRub,
    rates,
    disclaimer: "Предварительный расчёт по тарифам TL Auto. Итог зависит от курса и документов.",
  };
}

