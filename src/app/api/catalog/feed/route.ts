import { NextResponse } from "next/server";
import { getCatalogCardPage, type CatalogFilters } from "@/server/cars/repository";

const MAX_LIMIT = 48;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const under160 = params.get("under160") === "1" || params.get("shelf") === "under-160";
  const sort = params.get("sort");
  const filters: CatalogFilters = {
    search: params.get("search") || undefined,
    brand: params.get("brand") || undefined,
    model: params.get("model") || undefined,
    fuelType: params.get("fuel") || undefined,
    transmission: params.get("transmission") || undefined,
    minEngineCc: numberParam(params.get("engineMin")),
    maxEngineCc: numberParam(params.get("engineMax")),
    minYear: numberParam(params.get("yearMin")),
    maxYear: numberParam(params.get("yearMax")),
    registrationMonth: numberParam(params.get("month")),
    trim: params.get("trim") || undefined,
    bodyType: params.get("body") || undefined,
    color: params.get("color") || undefined,
    minOwners: numberParam(params.get("ownersMin")),
    maxOwners: numberParam(params.get("ownersMax")),
    minMileageKm: numberParam(params.get("mileageMin")),
    maxMileageKm: numberParam(params.get("mileageMax")),
    minPriceRub: numberParam(params.get("priceMin")),
    maxPriceRub: numberParam(params.get("priceMax")),
    maxPowerHp: under160 ? 160 : numberParam(params.get("powerMax")),
    noAccidents: params.get("clean") === "1",
    noInsurance: params.get("noInsurance") === "1",
    minInsurancePayoutKrw: numberParam(params.get("insuranceMin")),
    maxInsurancePayoutKrw: numberParam(params.get("insuranceMax")),
    passable: params.get("passable") === "1" || params.get("shelf") === "passable",
    sourceId: params.get("number") || undefined,
    sort: sort === "price_asc" || sort === "price_desc" || sort === "mileage_asc" || sort === "year_desc" ? sort : "fresh",
  };
  const limit = Math.min(Math.max(numberParam(params.get("limit")) ?? 24, 1), MAX_LIMIT);
  const result = await getCatalogCardPage(filters, params.get("cursor"), limit);
  return NextResponse.json(result, {
    headers: {
      // Feed pages are short-lived cacheable data, not user-specific content.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
    },
  });
}

function numberParam(value: string | null) {
  if (!value) return undefined;
  const number = Number(value.replace(/\s/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
