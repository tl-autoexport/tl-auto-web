export function electricRecalculationPowerKw(car: {
  fuel_type: string | null;
  power_basis: string | null;
  calculation_power_status: string | null;
  calculation_power_kw: number | null;
}): number | null {
  if (car.fuel_type !== "electric" || car.power_basis !== "electric_30min" ||
      !["matched", "approved"].includes(car.calculation_power_status ?? "")) return null;
  const powerKw = Number(car.calculation_power_kw);
  return Number.isFinite(powerKw) && powerKw > 0 ? powerKw : null;
}
