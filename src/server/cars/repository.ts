import { unstable_cache } from "next/cache";
import { createSupabasePublic } from "@/server/supabase/public";

const buildWithoutCatalog =
  process.env.TL_AUTO_BUILD_WITHOUT_CATALOG === "true";

export type CatalogCar = {
  id: string;
  vehicle_type: "car";
  primary_source: string;
  source_kind: string;
  source_id: string;
  source_url: string | null;
  brand: string | null;
  model: string | null;
  badge: string | null;
  badge_detail: string | null;
  year: number | null;
  registration_month: number | null;
  mileage_km: number | null;
  price_krw: number | null;
  price_rub: number | null;
  engine_cc: number | null;
  power_hp: number | null;
  fuel_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  color: string | null;
  owners_count: number | null;
  accident_count: number | null;
  insurance_payout_count: number | null;
  insurance_payout_total_krw: number | null;
  has_360_exterior: boolean;
  has_360_interior: boolean;
  has_heydealer_eye: boolean;
  has_obd_scan: boolean;
  has_underbody_photo: boolean;
  has_thermal_images: boolean;
  data_confidence: number | null;
  source_updated_at: string | null;
  car_media?: Array<{
    url: string;
    thumbnail_url: string | null;
    media_type: string;
    category: string | null;
    is_primary: boolean;
    sort_order: number;
  }>;
};

export type CarDetail = CatalogCar & {
  car_options?: Array<{
    category: string | null;
    source_code: string | null;
    name_original: string | null;
    name_ru: string | null;
    value_original: string | null;
    value_ru: string | null;
    description_original: string | null;
    description_ru: string | null;
    is_present: boolean | null;
    sort_order: number;
  }>;
  car_condition_reports?: Array<{
    source: string;
    report_type: string;
    summary: unknown;
    items: unknown;
    raw_payload: unknown;
  }>;
  calc_snapshots?: Array<{
    total_rub: number | null;
    car_price_rub: number | null;
    duty_rub: number | null;
    fees_rub: number | null;
    util_rub: number | null;
    freight_rub: number | null;
    broker_rub: number | null;
    calculated_at: string;
    result: unknown;
  }>;
};

export type CatalogFilters = {
  limit?: number;
  offset?: number;
  source?: "encar";
  maxPowerHp?: number;
  brand?: string;
  model?: string;
  fuelType?: string;
  transmission?: string;
  minEngineCc?: number;
  maxEngineCc?: number;
  minYear?: number;
  maxYear?: number;
  maxMileageKm?: number;
  minPriceRub?: number;
  maxPriceRub?: number;
  noAccidents?: boolean;
  passable?: boolean;
  sourceId?: string;
  sort?: "fresh" | "price_asc" | "price_desc" | "mileage_asc" | "year_desc";
};

export type CatalogMetrics = {
  calculated: number;
  under160: number;
  clean: number;
};

export type CatalogFacetCar = Pick<
  CatalogCar,
  "brand" | "model" | "fuel_type" | "transmission"
>;

export type SitemapCar = Pick<
  CatalogCar,
  "primary_source" | "source_id" | "source_updated_at"
>;

export async function getCatalogCars(filters: CatalogFilters = {}): Promise<CatalogCar[]> {
  if (buildWithoutCatalog) return [];
  const {
    limit = 24,
    offset = 0,
    source,
    maxPowerHp,
    brand,
    model,
    fuelType,
    transmission,
    minEngineCc,
    maxEngineCc,
    minYear,
    maxYear,
    maxMileageKm,
    minPriceRub,
    maxPriceRub,
    noAccidents,
    passable,
    sourceId,
    sort = "fresh",
  } = filters;
  const supabase = createSupabasePublic();
  let query = supabase
    .from("cars")
    .select(
      "id, vehicle_type, primary_source, source_kind, source_id, source_url, source_updated_at, brand, model, badge, badge_detail, year, registration_month, mileage_km, price_krw, price_rub, engine_cc, power_hp, fuel_type, transmission, drive_type, color, owners_count, accident_count, insurance_payout_count, insurance_payout_total_krw, has_360_exterior, has_360_interior, has_heydealer_eye, has_obd_scan, has_underbody_photo, has_thermal_images, data_confidence, car_media(url, thumbnail_url, media_type, category, is_primary, sort_order)",
    )
    .eq("is_available", true)
    .eq("primary_source", "encar")
    .in("fuel_type", ["gasoline", "diesel"])
    .not("price_rub", "is", null)
    .not("power_hp", "is", null);

  if (source) query = query.eq("primary_source", source);
  if (maxPowerHp) query = query.lte("power_hp", maxPowerHp);
  if (brand) query = query.eq("brand", brand);
  if (model) query = query.eq("model", model);
  if (fuelType) query = query.eq("fuel_type", fuelType);
  if (transmission) query = query.in("transmission", transmissionValues(transmission));
  if (minEngineCc) query = query.gte("engine_cc", minEngineCc);
  if (maxEngineCc) query = query.lte("engine_cc", maxEngineCc);
  if (minYear) query = query.gte("year", minYear);
  if (maxYear) query = query.lte("year", maxYear);
  if (maxMileageKm) query = query.lte("mileage_km", maxMileageKm);
  if (minPriceRub) query = query.gte("price_rub", minPriceRub);
  if (maxPriceRub) query = query.lte("price_rub", maxPriceRub);
  if (noAccidents) query = query.eq("accident_count", 0);
  if (passable) query = query.or(passableFilterExpression());
  if (sourceId) query = query.eq("source_id", sourceId);
  const order = {
    fresh: { column: "source_updated_at", ascending: false },
    price_asc: { column: "price_rub", ascending: true },
    price_desc: { column: "price_rub", ascending: false },
    mileage_asc: { column: "mileage_km", ascending: true },
    year_desc: { column: "year", ascending: false },
  }[sort];

  const { data, error } = await query
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[cars] Catalog query failed", error);
    throw error;
  }
  return (data ?? []) as CatalogCar[];
}

export async function getCatalogCount(filters: CatalogFilters = {}): Promise<number> {
  if (buildWithoutCatalog) return 0;
  const supabase = createSupabasePublic();
  let query = supabase
    .from("cars")
    .select("id", { count: "exact", head: true })
    .eq("is_available", true)
    .eq("primary_source", "encar")
    .in("fuel_type", ["gasoline", "diesel"])
    .not("price_rub", "is", null)
    .not("power_hp", "is", null);

  if (filters.source) query = query.eq("primary_source", filters.source);
  if (filters.maxPowerHp) query = query.lte("power_hp", filters.maxPowerHp);
  if (filters.brand) query = query.eq("brand", filters.brand);
  if (filters.model) query = query.eq("model", filters.model);
  if (filters.fuelType) query = query.eq("fuel_type", filters.fuelType);
  if (filters.transmission) query = query.in("transmission", transmissionValues(filters.transmission));
  if (filters.minEngineCc) query = query.gte("engine_cc", filters.minEngineCc);
  if (filters.maxEngineCc) query = query.lte("engine_cc", filters.maxEngineCc);
  if (filters.minYear) query = query.gte("year", filters.minYear);
  if (filters.maxYear) query = query.lte("year", filters.maxYear);
  if (filters.maxMileageKm) query = query.lte("mileage_km", filters.maxMileageKm);
  if (filters.minPriceRub) query = query.gte("price_rub", filters.minPriceRub);
  if (filters.maxPriceRub) query = query.lte("price_rub", filters.maxPriceRub);
  if (filters.noAccidents) query = query.eq("accident_count", 0);
  if (filters.passable) query = query.or(passableFilterExpression());
  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);

  const { count, error } = await query;
  if (error) {
    console.error("[cars] Catalog count query failed", error);
    throw error;
  }
  return count ?? 0;
}

async function fetchCatalogMetrics(): Promise<CatalogMetrics> {
  const [calculated, under160, clean] = await Promise.all([
    getCatalogCount(),
    getCatalogCount({ maxPowerHp: 160 }),
    getCatalogCount({ noAccidents: true }),
  ]);
  return { calculated, under160, clean };
}

const getCachedCatalogMetrics = unstable_cache(
  fetchCatalogMetrics,
  ["catalog-metrics-v2", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unknown"],
  {
  revalidate: 300,
  },
);

export async function getCatalogMetrics(): Promise<CatalogMetrics> {
  return getCachedCatalogMetrics();
}

async function fetchCatalogFacetCars(): Promise<CatalogFacetCar[]> {
  const supabase = createSupabasePublic();
  const pageSize = 1000;
  const facets: CatalogFacetCar[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("cars")
      .select("brand, model, fuel_type, transmission")
      .eq("is_available", true)
      .eq("primary_source", "encar")
      .in("fuel_type", ["gasoline", "diesel"])
      .not("price_rub", "is", null)
      .not("power_hp", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("[cars] Catalog facets query failed", error);
      throw error;
    }

    const batch = (data ?? []) as CatalogFacetCar[];
    facets.push(...batch);
    if (batch.length < pageSize) break;
  }

  return facets;
}

const getCachedCatalogFacetCars = unstable_cache(
  fetchCatalogFacetCars,
  ["catalog-filter-facets-v1"],
  { revalidate: 3600 },
);

export async function getCatalogFacetCars(): Promise<CatalogFacetCar[]> {
  if (buildWithoutCatalog) return [];
  return getCachedCatalogFacetCars();
}

export async function getSitemapCars(): Promise<SitemapCar[]> {
  if (buildWithoutCatalog) return [];
  const supabase = createSupabasePublic();
  const pageSize = 1000;
  const cars: SitemapCar[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("cars")
      .select("primary_source, source_id, source_updated_at")
      .eq("is_available", true)
      .eq("primary_source", "encar")
      .in("fuel_type", ["gasoline", "diesel"])
      .not("price_rub", "is", null)
      .not("power_hp", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("[cars] Sitemap query failed", error);
      throw error;
    }

    const batch = (data ?? []) as SitemapCar[];
    cars.push(...batch);
    if (batch.length < pageSize) break;
  }

  return cars;
}

async function fetchCarDetail(source: string, sourceId: string): Promise<CarDetail | null> {
  if (buildWithoutCatalog || source !== "encar") return null;

  const supabase = createSupabasePublic();
  const { data, error } = await supabase
    .from("cars")
    .select(
      "id, vehicle_type, primary_source, source_kind, source_id, source_url, source_updated_at, brand, model, badge, badge_detail, year, registration_month, mileage_km, price_krw, price_rub, engine_cc, power_hp, fuel_type, transmission, drive_type, color, owners_count, accident_count, insurance_payout_count, insurance_payout_total_krw, has_360_exterior, has_360_interior, has_heydealer_eye, has_obd_scan, has_underbody_photo, has_thermal_images, data_confidence, car_media(url, thumbnail_url, media_type, category, is_primary, sort_order), car_options(category, source_code, name_original, name_ru, value_original, value_ru, description_original, description_ru, is_present, sort_order), car_condition_reports(source, report_type, summary, items)",
    )
    .eq("primary_source", "encar")
    .eq("source_id", sourceId)
    .in("fuel_type", ["gasoline", "diesel"])
    .not("price_rub", "is", null)
    .not("power_hp", "is", null)
    .order("sort_order", { foreignTable: "car_media", ascending: true })
    .order("sort_order", { foreignTable: "car_options", ascending: true })
    .maybeSingle();

  if (error) {
    console.error("[cars] Car detail query failed", { source, sourceId, error });
    throw error;
  }
  if (!data) return null;

  // Most report blocks are rendered from normalized summary/items. Only these
  // report kinds need their raw JSON for the body map, Eye report and
  // insurance-event details. Keeping the raw payload out of the relation
  // prevents unrelated diagnostic blobs from being sent on every card view.
  const { data: rawReports, error: rawReportsError } = await supabase
    .from("car_condition_reports")
    .select("report_type, raw_payload")
    .eq("car_id", data.id)
    .in("report_type", ["carhistory", "encar_carhistory", "encar_inspection"]);

  if (rawReportsError) {
    console.error("[cars] Diagnostic payload query failed", { source, sourceId, rawReportsError });
    throw rawReportsError;
  }

  const rawPayloadByReportType = new Map(
    (rawReports ?? []).map((report) => [report.report_type, report.raw_payload]),
  );

  // The card uses only the current published calculation. Loading the entire
  // calculation history for every public visit wastes database egress.
  const { data: latestSnapshot, error: latestSnapshotError } = await supabase
    .from("calc_snapshots")
    .select(
      "total_rub, car_price_rub, duty_rub, fees_rub, util_rub, freight_rub, broker_rub, calculated_at, result",
    )
    .eq("car_id", data.id)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSnapshotError) {
    console.error("[cars] Latest calculation query failed", { source, sourceId, latestSnapshotError });
    throw latestSnapshotError;
  }

  return {
    ...data,
    car_condition_reports: (data.car_condition_reports ?? []).map((report) => ({
      ...report,
      raw_payload: rawPayloadByReportType.get(report.report_type) ?? null,
    })),
    calc_snapshots: latestSnapshot ? [latestSnapshot] : [],
  } as CarDetail;
}

export async function getCarDetail(source: string, sourceId: string): Promise<CarDetail | null> {
  return unstable_cache(
    () => fetchCarDetail(source, sourceId),
    ["car-detail-v3", source, sourceId],
    { revalidate: 300 },
  )();
}

export function getPrimaryPhoto(car: CatalogCar) {
  return getShowcasePhoto(car) ?? (
    car.car_media
      ?.filter((media) => media.media_type === "image")
      .sort((a, b) => a.sort_order - b.sort_order)[0]?.url ??
    null
  );
}

export function getShowcasePhoto(car: CatalogCar) {
  const candidates = (car.car_media ?? [])
    .filter((media) => media.media_type === "image")
    .map((media) => ({ media, score: showcasePhotoScore(media) }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        Number(right.media.is_primary) - Number(left.media.is_primary) ||
        right.score - left.score ||
        left.media.sort_order - right.media.sort_order,
    );

  return candidates[0]?.media.url ?? null;
}

export function hasShowcasePhoto(car: CatalogCar) {
  return Boolean(getShowcasePhoto(car));
}

function showcasePhotoScore(media: NonNullable<CatalogCar["car_media"]>[number]) {
  const category = media.category?.toLowerCase() ?? "";
  if (
    [
      "inner",
      "inside",
      "inside_image",
      "interior",
      "option",
      "condition",
      "scratch",
      "inspection_record",
      "underbody",
      "thermal",
      "thermal_reference",
      "exterior_360_thumbnail",
    ].some((blocked) => category === blocked || category.startsWith(`${blocked}_`))
  ) {
    return 0;
  }

  const fileCode = Number(media.url.match(/_(\d{3})(?:\.[a-z]+)(?:\?|$)/i)?.[1] ?? NaN);
  const primaryBonus = media.is_primary ? 1000 : 0;
  if (["outside", "outside_image", "exterior", "outer"].includes(category)) {
    const exteriorAngleBonus =
      fileCode === 2 ? 55 :
      fileCode === 3 ? 50 :
      fileCode === 4 ? 35 :
      fileCode === 1 ? 18 :
      Number.isFinite(fileCode) && fileCode <= 8 ? 20 - fileCode : 0;
    return 300 + exteriorAngleBonus + primaryBonus;
  }
  if (category === "thumbnail") return 280 + (fileCode === 1 ? 30 : 0) + primaryBonus;
  if (category === "photo" && fileCode === 1) return 260 + primaryBonus;
  if (category === "photo" && Number.isFinite(fileCode) && fileCode >= 2 && fileCode <= 8) {
    return 220 - fileCode + primaryBonus;
  }

  return 0;
}

function transmissionValues(value: string) {
  const groups: Record<string, string[]> = {
    automatic: ["automatic", "auto", "Автомат", "오토", "오토(A/T)"],
    manual: ["manual", "Механика", "수동", "수동(M/T)"],
    cvt: ["cvt"],
    dct: ["dct"],
  };

  return groups[value] ?? [value];
}

function passableFilterExpression(now = new Date()) {
  const latest = new Date(now.getFullYear(), now.getMonth() - 36, 1);
  const earliest = new Date(now.getFullYear(), now.getMonth() - 59, 1);
  const earliestYear = earliest.getFullYear();
  const latestYear = latest.getFullYear();
  const earliestMonth = earliest.getMonth() + 1;
  const latestMonth = latest.getMonth() + 1;

  return [
    `and(year.eq.${earliestYear},registration_month.gte.${earliestMonth})`,
    `and(year.gt.${earliestYear},year.lt.${latestYear})`,
    `and(year.eq.${latestYear},registration_month.lte.${latestMonth})`,
  ].join(",");
}
