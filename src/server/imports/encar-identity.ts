/** Encar duplicate advertisements retain their own listing ID but share a vehicle. */
export function resolveEncarVehicleId(listingId: string, payload: unknown): string {
  if (!/^\d+$/.test(listingId)) throw new Error("Invalid Encar listing ID");
  if (!payload || typeof payload !== "object") throw new Error("Missing Encar detail");
  const detail = payload as Record<string, unknown>;
  if (detail.vehicleId == null && !detail.spec) throw new Error("Missing Encar vehicle identity");
  const vehicleId = String(detail.vehicleId ?? listingId);
  const queryCarId = detail.queryCarId == null ? null : String(detail.queryCarId);
  if (!/^\d+$/.test(vehicleId) || (queryCarId !== null && queryCarId !== listingId)) {
    throw new Error("Encar detail identity mismatch");
  }
  return vehicleId;
}
