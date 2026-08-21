const number = new Intl.NumberFormat("ru-RU");

export function formatVehicleYear(year: number | null | undefined) {
  return year ? `${year} г.` : "-";
}

export function formatEngineCapacity(value: number | null | undefined) {
  return value ? `${number.format(value)} см³` : "-";
}
