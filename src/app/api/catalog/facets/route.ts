import { NextResponse } from "next/server";
import { createSupabasePublic } from "@/server/supabase/public";

/**
 * Facet counters for the catalogue cascade.
 *
 * The route only translates URL parameters into the filter keys the database
 * function expects; the counting itself happens in `catalog_facets`, which is
 * built from the same predicate as the listing. Keeping the mapping here means
 * the database contract does not have to follow the URL naming.
 *
 * The response groups the rows by axis for the interface and carries the total
 * the listing would show, so the "Показать N" button and the grid read the same
 * number.
 */
type FacetRow = { axis: string; value: string; label: string; cars: number };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = buildFilters(params);

  const supabase = createSupabasePublic();
  const [facets, count] = await Promise.all([
    supabase.rpc("catalog_facets", { f: filters }),
    supabase.rpc("catalog_listing_count", { f: filters }),
  ]);
  if (facets.error) return NextResponse.json({ error: facets.error.message }, { status: 500 });
  if (count.error) return NextResponse.json({ error: count.error.message }, { status: 500 });

  const axes: Record<string, Array<{ value: string; label: string; cars: number }>> = {};
  for (const row of (facets.data ?? []) as FacetRow[]) {
    const bucket = axes[row.axis] ?? [];
    bucket.push({ value: row.value, label: row.label ?? row.value, cars: row.cars });
    axes[row.axis] = bucket;
  }
  for (const bucket of Object.values(axes)) {
    bucket.sort((left, right) => right.cars - left.cars || left.label.localeCompare(right.label, "ru"));
  }

  return NextResponse.json(
    { total: count.data ?? 0, axes, filters },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
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
    brand: params.get("brand") || undefined,
    model: params.get("model") || undefined,
    generation: params.get("generation") || undefined,
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
