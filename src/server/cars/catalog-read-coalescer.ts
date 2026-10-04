import type { CatalogFilters } from "./repository";

/** Counts do not depend on ordering or pagination. Keep shared cache keys stable. */
export function catalogCountFilters(filters: CatalogFilters): CatalogFilters {
  return Object.fromEntries(Object.entries(filters)
    .filter(([key, value]) => !["sort", "limit", "offset"].includes(key) && Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right)));
}

/** Share only unfinished reads; failures and results are never retained here. */
export function createReadCoalescer<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(load).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
