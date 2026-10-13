import { NextResponse } from "next/server";
import { getCatalogCardPage } from "@/server/cars/repository";
import { catalogFiltersFromParams } from "@/lib/catalog-filter-params";

const MAX_LIMIT = 48;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sort = params.get("sort");
  const filters = catalogFiltersFromParams(params);
  filters.sort = sort === "price_asc" || sort === "price_desc" || sort === "mileage_asc" || sort === "year_desc" ? sort : "fresh";
  const requestedLimit = Number(params.get("limit"));
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 24, 1), MAX_LIMIT);
  const result = await getCatalogCardPage(filters, params.get("cursor"), limit);
  return NextResponse.json(result, {
    headers: {
      // Feed pages are short-lived cacheable data, not user-specific content.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
    },
  });
}
