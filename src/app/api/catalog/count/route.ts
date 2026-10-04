import { NextResponse } from "next/server";
import { getCatalogCount } from "@/server/cars/repository";
import { catalogFiltersFromParams } from "@/lib/catalog-filter-params";

export async function GET(request: Request) {
  const filters = catalogFiltersFromParams(new URL(request.url).searchParams);
  return NextResponse.json({ count: await getCatalogCount(filters) }, {
    headers: { "Cache-Control": "public, s-maxage=30" },
  });
}
