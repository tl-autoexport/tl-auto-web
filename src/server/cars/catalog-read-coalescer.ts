import type { CatalogFilters } from "./repository";

/** Identity filters can use the split, indexable canonical-name projection.
 * Keep unfiltered listing/count reads on the original sort-index path. */
export function catalogDisplayReadView(filters: CatalogFilters) {
  return filters.brand || filters.model || filters.generation || filters.modification || filters.trim
    ? "catalog_display_cascade_cars"
    : "catalog_display_cars";
}

/** Counts do not depend on ordering or pagination. Keep shared cache keys stable. */
export function catalogCountFilters(filters: CatalogFilters): CatalogFilters {
  return Object.fromEntries(Object.entries(filters)
    .filter(([key, value]) => !["sort", "limit", "offset"].includes(key) && Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right)));
}

/** Count bounded ID pages after an aggregate timeout, keeping every predicate. */
export async function countCatalogIdPages(load: (afterId: string | null, limit: number) => Promise<string[]>) {
  const limit = 500;
  let total = 0;
  let afterId: string | null = null;
  for (;;) {
    const ids = await load(afterId, limit);
    total += ids.length;
    if (ids.length < limit) return total;
    const nextId = ids[ids.length - 1];
    if (nextId === afterId) throw new Error("Catalog count cursor did not advance");
    afterId = nextId;
  }
}

/** A failed aggregate must not discard a successful, independently filtered page. */
export async function readCatalogPage<T>(count: Promise<number>, page: Promise<T>, onCountError: (error: unknown) => void) {
  const [totalCars, initialPage] = await Promise.all([
    count.catch((error: unknown) => { onCountError(error); return null; }),
    page,
  ]);
  return { totalCars, initialPage };
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
