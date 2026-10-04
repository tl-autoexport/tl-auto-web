import { NextResponse } from "next/server";
import { getCatalogCount } from "@/server/cars/repository";
import { catalogFiltersFromParams } from "@/lib/catalog-filter-params";

export async function GET(request: Request) {
  const filters = catalogFiltersFromParams(new URL(request.url).searchParams);
  try {
    return NextResponse.json({ count: await getCatalogCount(filters) }, {
      headers: { "Cache-Control": "public, s-maxage=30" },
    });
  } catch {
    return NextResponse.json({ error: "Could not count catalog cars" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" },
    });
  }
}
