import { NextResponse } from "next/server";
import { getCatalogCount, type CatalogFilters } from "@/server/cars/repository";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const under160 = params.get("under160") === "1";

  const filters: CatalogFilters = {
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
    driveType: params.get("drive") || undefined,
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
    passable: params.get("passable") === "1",
    sourceId: params.get("number") || undefined,
  };

  return NextResponse.json({ count: await getCatalogCount(filters) });
}

function numberParam(value: string | null) {
  if (!value) return undefined;
  const number = Number(value.replace(/\s/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
