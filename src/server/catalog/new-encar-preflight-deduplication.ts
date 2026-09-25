export type NewEncarPreflightStatus = "ready" | "unknown" | "dummy" | "contract" | "duplicate_vehicle";

export type NewEncarPreflightRow<T> = {
  candidate: T;
  status: NewEncarPreflightStatus;
  vehicleNoHash: string | null;
  error?: string;
};

/**
 * Excludes plates already active in the catalog and keeps only the first
 * deterministic discovery result for each plate in this candidate batch.
 * Unknown preflight results are preserved: transient source errors must not
 * be treated as proof of a duplicate or as a reason to drop a candidate.
 */
export function deduplicateNewEncarPreflightRows<T>(
  rows: NewEncarPreflightRow<T>[],
  activeVehicleNoHashes: ReadonlySet<string>,
): NewEncarPreflightRow<T>[] {
  const seenInBatch = new Set<string>();

  return rows.map((row) => {
    if (row.status !== "ready" || !row.vehicleNoHash) return row;

    if (activeVehicleNoHashes.has(row.vehicleNoHash) || seenInBatch.has(row.vehicleNoHash)) {
      return { ...row, status: "duplicate_vehicle" };
    }

    seenInBatch.add(row.vehicleNoHash);
    return row;
  });
}
