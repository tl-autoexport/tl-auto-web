export type EncarEvBatteryStatus = "available" | "no_data" | "not_advertised" | "request_error";

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasValue);
  }
  return false;
}

export function classifyEncarEvBatteryResponse(
  httpStatus: number,
  payload: unknown,
): EncarEvBatteryStatus {
  if (httpStatus < 200 || httpStatus >= 300) return "request_error";
  return hasValue(payload) ? "available" : "no_data";
}

export function isEncarElectricFuel(value: unknown): boolean {
  const fuel = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return fuel === "electric" || fuel === "전기";
}
