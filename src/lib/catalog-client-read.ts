/** Short-lived browser cache; share overlapping reads, never retain errors. */
const ready = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export function catalogRead<T>(url: string): Promise<T> {
  const parsed = new URL(url, "https://catalog.local");
  for (const [key, value] of Array.from(parsed.searchParams)) {
    if (!value || ["sort", "page", "cursor"].includes(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  const key = parsed.pathname + (parsed.search ? parsed.search : "");
  const cached = ready.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
      // One shared retry for a transient upstream failure, within the same
      // total time budget. All subscribers still share this request.
      const signal = AbortSignal.timeout(12_000);
      let response = await fetch(key, { signal });
      if ([429, 502, 503, 504].includes(response.status)) {
        const seconds = Number(response.headers.get("Retry-After"));
        await new Promise(resolve => setTimeout(resolve, Math.min(1_000, Math.max(250, seconds * 1_000 || 250))));
        response = await fetch(key, { signal });
      }
      if (!response.ok) throw new Error(`Catalog read failed: ${response.status}`);
      const value: unknown = await response.json();
      if (ready.size >= 100) ready.delete(ready.keys().next().value!);
      ready.set(key, { expires: Date.now() + 30_000, value });
      return value;
    })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request as Promise<T>;
}

export function catalogFacetUrl(query: string, axis: string): string {
  const params = new URLSearchParams(query);
  const identity = ["brand", "model", "generation", "modification", "trim"];
  const index = identity.indexOf(axis);
  // Descendants must not restrict a parent picker or fragment its cache.
  if (index >= 0) for (const key of identity.slice(index)) params.delete(key);
  params.set("axes", axis);
  params.set("count", "0");
  return `/api/catalog/facets?${params}`;
}
