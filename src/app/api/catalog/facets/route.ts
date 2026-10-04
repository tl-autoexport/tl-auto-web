import { NextResponse } from "next/server";
import { createSupabasePublic } from "@/server/supabase/public";
import { translateModel } from "@/server/normalization/display";
import { catalogBrandValues, normalizeCatalogBrand } from "@/lib/catalog-brand";
import { unstable_cache } from "next/cache";
import { getCatalogCount } from "@/server/cars/repository";
import { catalogFiltersFromParams } from "@/lib/catalog-filter-params";
import { createReadCoalescer } from "@/server/cars/catalog-read-coalescer";

/**
 * Facet counters for the catalogue cascade.
 *
 * The route only translates URL parameters into the filter keys the database
 * function expects; the counting itself happens in `catalog_display_facets`, which is
 * built from the same predicate as the listing. Keeping the mapping here means
 * the database contract does not have to follow the URL naming.
 *
 * The response groups the rows by axis for the interface and carries the total
 * the listing would show, so the "Показать N" button and the grid read the same
 * number.
 */
type FacetRow = { axis: string; value: string; label: string; cars: number };
const AXES = ["brand", "model", "generation", "modification", "trim", "fuel", "drive", "transmission", "body", "color", "power_band", "no_accident", "no_insurance"];
const coalesce = createReadCoalescer<FacetRow[]>();
const readFacets = unstable_cache(async (serialized: string, requested: string[]) => {
  const started = performance.now();
  const { data, error } = await createSupabasePublic().rpc("catalog_display_facet_options", {
    f: JSON.parse(serialized), requested_axes: requested,
  });
  if (error) {
    console.error("[cars] Cascade options query failed", { axes: requested, filters: JSON.parse(serialized), durationMs: Math.round(performance.now() - started), code: error.code, message: error.message });
    throw error;
  }
  return (data ?? []) as FacetRow[];
}, ["catalog-cascade-options-v2-indexed", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unknown"], { revalidate: 60 });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = buildFilters(params);

  const requested = [...new Set(params.get("axes")?.split(",") ?? AXES)].sort();
  if (!requested.length || requested.some(axis => !AXES.includes(axis))) {
    return NextResponse.json({ error: "Unknown facet axis" }, { status: 400 });
  }
  const serialized = JSON.stringify(filters);
  let rows: FacetRow[];
  let total: number | null;
  try {
    [rows, total] = await Promise.all([
      coalesce(JSON.stringify([serialized, requested]), () => readFacets(serialized, requested)),
      params.get("count") === "0" ? Promise.resolve(null) : getCatalogCount(catalogFiltersFromParams(params)),
    ]);
  } catch {
    return NextResponse.json({ error: "Could not load catalog options" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" },
    });
  }

  const axes: Record<string, Array<{ value: string; label: string; cars: number }>> = {};
  for (const row of rows) {
    const bucket = axes[row.axis] ?? [];
    if (row.axis === "brand") {
      const label = normalizeCatalogBrand(row.value) ?? row.value;
      const existing = bucket.find((option) => option.value === label);
      if (existing) existing.cars += row.cars;
      else bucket.push({ value: label, label, cars: row.cars });
    } else {
      bucket.push({ value: row.value, label: row.axis === "model" ? translateModel(null,row.label ?? row.value) : row.label ?? row.value, cars: row.cars });
    }
    axes[row.axis] = bucket;
  }
  for (const bucket of Object.values(axes)) {
    bucket.sort((left, right) => right.cars - left.cars || left.label.localeCompare(right.label, "ru"));
  }

  return NextResponse.json(
    { ...(total !== null ? { total } : {}), axes, filters },
    { headers: { "Cache-Control": "public, s-maxage=60" } },
  );
}

/** URL names belong to the interface; the database contract keeps its own. */
function buildFilters(params: URLSearchParams): Record<string, unknown> {
  const number = (value: string | null) => {
    if (!value) return undefined;
    const parsed = Number(value.replace(/\s/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const under160 = params.get("under160") === "1" || params.get("shelf") === "under-160";

  const filters: Record<string, unknown> = {
    brand: normalizeCatalogBrand(params.get("brand")) || undefined,
    brandValues: params.get("brand") ? catalogBrandValues(params.get("brand")!) : undefined,
    model: params.get("model") || undefined,
    generation: params.get("generation") || undefined,
    modification: params.get("modification") || undefined,
    trim: params.get("trim") || undefined,
    fuel: params.get("fuel") || undefined,
    drive: params.get("drive") || undefined,
    transmission: params.get("transmission") || undefined,
    body: params.get("body") || undefined,
    color: params.get("color") || undefined,
    source: params.get("source") || undefined,
    yearFrom: number(params.get("yearMin")),
    yearTo: number(params.get("yearMax")),
    mileageFrom: number(params.get("mileageMin")),
    mileageTo: number(params.get("mileageMax")),
    priceFrom: number(params.get("priceMin")),
    priceTo: number(params.get("priceMax")),
    maxPowerHp: under160 ? 160 : number(params.get("powerMax")),
    noAccidents: params.get("clean") === "1" ? true : undefined,
    noInsurance: params.get("noInsurance") === "1" ? true : undefined,
  };

  for (const key of Object.keys(filters)) {
    if (filters[key] === undefined) delete filters[key];
  }
  return filters;
}
