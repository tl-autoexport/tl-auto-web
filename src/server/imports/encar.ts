import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { calculateRuVladivostok } from "@/server/calc/ru";
import { getCbrCalcRates, type CalcRateSnapshot } from "@/server/calc/rates";
import {
  normalizeBrand,
  normalizeColor,
  normalizeDrive,
  normalizeFuel,
  isElectrifiedConfiguration,
  normalizeModel,
  normalizePlate,
  resolveHybridPower,
  resolveEngineCc,
  resolvePower,
} from "@/server/normalization/vehicles";
import {
  translateInspectionLabel,
  translateInspectionStatus,
  translateOption,
  translateTransmission,
} from "@/server/normalization/display";
import { encarClient } from "@/server/imports/encar-client";

const ENCAR_BASE_URL = "https://api.encar.com/search/car/list/general";
const ENCAR_PAGE_SIZE = 50;
// Encar ships this application-level token in its public web bundle. The env
// override lets us rotate it without a code deployment if Encar changes it.
const ENCAR_HISTORY_ACCESS_TOKEN =
  process.env.ENCAR_HISTORY_ACCESS_TOKEN?.trim() ||
  "WqtHVjmpGX7lWsf63vwCGVPrF1BzYk";
const ENCAR_BODY_TYPE_MAP: Record<string, string> = {
  경차: "Микроавтомобиль",
  소형차: "Компактный автомобиль",
  준중형차: "Компактный автомобиль",
  중형차: "Среднеразмерный автомобиль",
  대형차: "Большой автомобиль",
  스포츠카: "Спорткар",
  SUV: "SUV",
  RV: "Минивэн",
  승합차: "Минивэн",
  화물차: "Коммерческий автомобиль",
};

function normalizeBodyType(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return (
    ENCAR_BODY_TYPE_MAP[normalized] ??
    (/[^\u0000-\u007f]/.test(normalized) ? null : normalized)
  );
}

type EncarListCar = {
  Id: number | string;
  Manufacturer?: string;
  Model?: string;
  Badge?: string;
  BadgeDetail?: string;
  Year?: number | string;
  Mileage?: number;
  Price?: number;
  FuelType?: string;
  Transmission?: string;
  Displacement?: number;
  HasAccident?: boolean;
  Condition?: string[];
  Photo?: string;
  Photos?: Array<{
    type?: string;
    location?: string;
    ordering?: number;
    updatedDate?: string;
  }>;
};

type EncarDetail = {
  displacement: number | null;
  fuelName: string | null;
  color: string | null;
  seats: number | null;
  bodyTypeKr: string | null;
  gradeEnglish: string | null;
  gradeDetailEnglish: string | null;
  manufacturerEnglish: string | null;
  modelEnglish: string | null;
  registeredAt: string | null;
  firstAdvertisedAt: string | null;
  modifiedAt: string | null;
  vehicleNo: string | null;
  vin: string | null;
  transmission: string | null;
  standardOptionCodes: string[];
  inspectionFormats: string[];
  photos: EncarPhoto[];
  raw: EncarDetailPayload;
};

type EncarPhoto = {
  url: string;
  category: "outer" | "inner" | "option" | "thumbnail" | "photo";
};

type EncarDetailPayload = {
  vehicleNo?: string;
  vin?: string;
  spec?: {
    displacement?: number;
    fuelName?: string;
    colorName?: string;
    seatCount?: number;
    bodyName?: string;
    vin?: string;
    transmissionName?: string;
  };
  manage?: {
    registDateTime?: string;
    firstAdvertisedDateTime?: string;
    modifyDateTime?: string;
  };
  category?: {
    gradeEnglishName?: string;
    gradeDetailEnglishName?: string;
    manufacturerEnglishName?: string;
    modelGroupEnglishName?: string;
  };
  options?: {
    standard?: string[];
    choice?: string[];
    etc?: string[];
    tuning?: string[];
  };
  condition?: {
    inspection?: { formats?: string[] };
    accident?: { recordView?: boolean; resumeView?: boolean };
  };
  photos?: Array<{
    code?: string;
    path?: string;
    type?: string;
    updateDateTime?: string;
    desc?: string | null;
  }>;
};

type EncarOptionDefinition = {
  optionCd?: string;
  optionName?: string;
  optionTypeCd?: string | null;
  sort?: number;
  description?: string | null;
  optionTitle?: string | null;
  groupOptionName?: string | null;
  subOptions?: EncarOptionDefinition[] | null;
};

type EncarOptionCatalog = {
  metas?: Array<{ key?: string | null; value?: string | null }>;
  options?: EncarOptionDefinition[];
};

type EncarInspectionNode = {
  type?: { code?: string | null; title?: string | null } | null;
  statusType?: { code?: string | null; title?: string | null } | null;
  description?: string | null;
  price?: number | null;
  children?: EncarInspectionNode[] | null;
};

type EncarInspection = {
  vehicleId?: number;
  formats?: string[];
  inspectionSource?: unknown;
  master?: {
    supplyNum?: string | null;
    accdient?: boolean;
    simpleRepair?: boolean;
    registrationDate?: string | null;
    detail?: Record<string, unknown>;
  };
  images?: Array<{ path?: string; type?: string; title?: string }>;
  outers?: Array<{
    type?: { code?: string | null; title?: string | null };
    statusTypes?: Array<{ code?: string | null; title?: string | null }>;
    attributes?: string[];
  }>;
  inners?: EncarInspectionNode[];
  etcs?: unknown[];
};

type EncarInspectionSummary = {
  vehicleId?: number;
  outers?: EncarInspection["outers"];
  outerSummarys?: Array<{
    statusType?: { code?: string | null; title?: string | null };
    count?: number;
  }>;
  inspName?: string | null;
};

type EncarHistoryAccident = {
  accidentDate?: string | null;
  accidentType?: string | null;
  repairCost?: number | null;
  partCost?: number | null;
  laborCost?: number | null;
  paintingCost?: number | null;
};

type EncarHistoryPayload = {
  releaseResponse?: {
    registerDate?: string | null;
    firstRegisterDate?: string | null;
    manufacturingDate?: string | null;
    newVehiclePrice?: number | null;
    releaseVehiclePrice?: number | null;
    fuel?: string | null;
    manufacturerNation?: string | null;
    manufacturingPurpose?: string | null;
  } | null;
  cautionResponse?: Record<string, unknown> | null;
  oneLineSentenceResponse?: Record<string, unknown> | null;
  accidentHistoryResponse?: EncarHistoryAccident[] | null;
  nonInsurancePeriodResponse?: Array<Record<string, unknown>> | null;
  ownerHistoryResponse?: Array<Record<string, unknown>> | null;
};

type EncarHistoryResult =
  | { status: "available"; payload: EncarHistoryPayload }
  | { status: "unavailable"; reason: string };

type EncarOptionRow = {
  category: string;
  source_code: string | null;
  name_original: string | null;
  name_ru: string | null;
  value_original: string | null;
  value_ru: string | null;
  price_krw: number | null;
  description_original: string | null;
  description_ru: string | null;
  is_present: boolean | null;
  sort_order: number;
};

type EncarConditionReport = {
  source: "encar";
  report_type: string;
  summary: Record<string, unknown>;
  items: unknown[];
  raw_payload: unknown;
};

function compactOptionRow(option: EncarOptionRow) {
  return {
    category: option.category,
    name_original: option.name_original,
    name_ru: option.name_ru,
    value_original: option.value_original,
    value_ru: option.value_ru,
    is_present: option.is_present,
    sort_order: option.sort_order,
  };
}

type ImportOptions = {
  target?: number;
  maxPages?: number;
  electricTarget?: number;
  electricPages?: number;
  hybridTarget?: number;
  hybridPages?: number;
  onlyNew?: boolean;
  fastMode?: boolean;
  dryRun?: boolean;
  replaceCatalog?: boolean;
  maxListingAgeDays?: number;
  brandMinimums?: Record<string, number>;
  modelMinimums?: Record<string, number>;
  priorityBrandPages?: Record<string, number>;
};

type EncarFilterBounds = {
  minYear: number;
  maxYear: number;
  maxMileage: number;
  minPrice: number;
  maxPrice: number;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isFreshListing(value: string | null | undefined, maxAgeDays: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    timestamp >= Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildFilter(
  manufacturer?: string,
  fuelType?: "electric" | "hybrid",
  bounds: EncarFilterBounds = getEncarFilterBounds(),
) {
  const manufacturerFilter = manufacturer
    ? `_.Manufacturer.${manufacturer}.`
    : "";
  const fuelFilter =
    fuelType === "electric"
      ? "_.FuelType.전기."
      : fuelType === "hybrid"
        ? "_.FuelType.가솔린+전기."
        : "";
  return `(And.Hidden.N.${manufacturerFilter}${fuelFilter}_.Year.range(${bounds.minYear}..${bounds.maxYear})._.Mileage.range(..${bounds.maxMileage})._.Price.range(${bounds.minPrice}..${bounds.maxPrice}).)`;
}

function nonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getEncarFilterBounds(): EncarFilterBounds {
  return {
    minYear: nonNegativeInt(process.env.ENCAR_MIN_YEAR, 202100),
    maxYear: nonNegativeInt(process.env.ENCAR_MAX_YEAR, 202700),
    maxMileage: nonNegativeInt(process.env.ENCAR_MAX_MILEAGE, 120000),
    minPrice: nonNegativeInt(process.env.ENCAR_MIN_PRICE, 700),
    maxPrice: nonNegativeInt(process.env.ENCAR_MAX_PRICE, 15000),
  };
}

function buildListUrl(
  offset: number,
  manufacturer?: string,
  fuelType?: "electric" | "hybrid",
) {
  const query = encodeURIComponent(buildFilter(manufacturer, fuelType));
  const sort = encodeURIComponent(`|ModifiedDate|${offset}|${ENCAR_PAGE_SIZE}`);
  return `${ENCAR_BASE_URL}?count=true&q=${query}&sr=${sort}`;
}

function buildPhotos(car: EncarListCar): EncarPhoto[] {
  if (Array.isArray(car.Photos) && car.Photos.length > 0) {
    return [...car.Photos]
      .filter((photo) => photo.location)
      .sort((a, b) => {
        if (a.type === "001") return -1;
        if (b.type === "001") return 1;
        return (a.ordering ?? 0) - (b.ordering ?? 0);
      })
      .map((photo) => ({
        url: `https://ci.encar.com${photo.location}`,
        category: "outer" as const,
      }));
  }

  if (car.Photo) {
    return [
      { url: `https://ci.encar.com${car.Photo}001.jpg`, category: "outer" },
    ];
  }
  return [];
}

function inferEngineCcFromBadge(
  listCar: EncarListCar,
  detail: EncarDetail | null,
) {
  if (detail?.displacement) return detail.displacement;
  if (listCar.Displacement) return listCar.Displacement;

  const badge = [listCar.Badge, listCar.BadgeDetail].filter(Boolean).join(" ");
  const ccMatch = badge.match(/(\d{3,4})\s*(?:cc|㎤|시시)/i);
  if (ccMatch) return Number(ccMatch[1]);

  const litreMatch = badge.match(
    /(?:^|\s)(\d(?:[.,]\d{1,2})?)(?=\s*(?:T|터보|하이브리드|HEV|AWD|FWD|2WD|4WD|$))/i,
  );
  if (!litreMatch) return null;
  const litres = Number(litreMatch[1].replace(",", "."));
  return litres >= 0.6 && litres <= 8 ? Math.round(litres * 1000) : null;
}

function normalizeEncarPhotos(
  photos: NonNullable<EncarDetailPayload["photos"]>,
): EncarPhoto[] {
  const normalized = photos
    .filter((photo): photo is typeof photo & { path: string } =>
      Boolean(photo.path),
    )
    .map((photo) => ({
      url: photo.path.startsWith("http")
        ? photo.path
        : `https://ci.encar.com${photo.path}`,
      category: normalizeEncarPhotoCategory(photo.type),
    }))
    .sort((left, right) => encarPhotoRank(left) - encarPhotoRank(right));

  const seen = new Set<string>();
  return normalized.filter((photo) => {
    if (seen.has(photo.url)) return false;
    seen.add(photo.url);
    return true;
  });
}

function normalizeEncarPhotoCategory(
  value: string | undefined,
): EncarPhoto["category"] {
  const category = value?.toLowerCase();
  if (category === "outer") return "outer";
  if (category === "inner") return "inner";
  if (category === "option") return "option";
  if (category === "thumbnail") return "thumbnail";
  return "photo";
}

function encarPhotoRank(photo: EncarPhoto) {
  const code = Number(
    photo.url.match(/_(\d{3})(?:\.[a-z]+)(?:\?|$)/i)?.[1] ?? 999,
  );
  if (photo.category === "outer") return code === 1 ? 0 : 10 + code;
  if (photo.category === "thumbnail") return code === 1 ? 1 : 60 + code;
  if (photo.category === "inner") return 200 + code;
  if (photo.category === "option") return 400 + code;
  return 600 + code;
}

function normalizeYear(value: EncarListCar["Year"]) {
  const raw = String(value ?? "");
  return {
    year: Number(raw.slice(0, 4)) || null,
    month: Number(raw.slice(4, 6)) || null,
  };
}

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await encarClient.request<T>(url, {}, 1);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function fetchEncarHistory(
  vehicleNo: string,
): Promise<EncarHistoryResult> {
  const url = new URL("https://api.encar.com/v1/vehicle/resume");
  url.searchParams.set("vehicleNo", vehicleNo);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await encarClient.response(url.toString(), {
        headers: { Authorization: `Bearer ${ENCAR_HISTORY_ACCESS_TOKEN}` },
      }, 1);
      if (response.status === 400 || response.status === 404) {
        await response.arrayBuffer();
        return {
          status: "unavailable",
          reason: `encar_history_http_${response.status}`,
        };
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Encar history HTTP ${response.status}: ${text.slice(0, 180)}`,
        );
      }
      const payload = (await response.json()) as EncarHistoryPayload;
      return { status: "available", payload };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function fetchDetail(vehicleId: string): Promise<EncarDetail> {
  const url = `https://api.encar.com/v1/readside/vehicle/${vehicleId}`;
  const data = await fetchJson<EncarDetailPayload>(url);
  const spec = data.spec ?? {};

  return {
    displacement: spec.displacement ?? null,
    fuelName: spec.fuelName ?? null,
    color: normalizeColor(spec.colorName),
    seats: spec.seatCount ?? null,
    bodyTypeKr: spec.bodyName ?? null,
    gradeEnglish: data.category?.gradeEnglishName ?? null,
    gradeDetailEnglish: data.category?.gradeDetailEnglishName ?? null,
    manufacturerEnglish: data.category?.manufacturerEnglishName ?? null,
    modelEnglish: data.category?.modelGroupEnglishName ?? null,
    registeredAt: data.manage?.registDateTime ?? null,
    firstAdvertisedAt: data.manage?.firstAdvertisedDateTime ?? null,
    modifiedAt: data.manage?.modifyDateTime ?? null,
    vehicleNo: data.vehicleNo ?? null,
    vin: spec.vin ?? data.vin ?? null,
    transmission: spec.transmissionName ?? null,
    standardOptionCodes: data.options?.standard ?? [],
    inspectionFormats: data.condition?.inspection?.formats ?? [],
    photos: normalizeEncarPhotos(data.photos ?? []),
    raw: data,
  };
}

let listFixturePromise: Promise<EncarListCar[] | null> | null = null;

async function readListFixture() {
  const fixturePath = process.env.ENCAR_LIST_FIXTURE_FILE?.trim();
  if (!fixturePath) return null;
  if (!listFixturePromise) {
    listFixturePromise = readFile(fixturePath, "utf8").then((raw) => {
      const parsed = JSON.parse(raw) as
        | EncarListCar[]
        | { SearchResults?: EncarListCar[] };
      return Array.isArray(parsed) ? parsed : parsed.SearchResults ?? [];
    });
  }
  return listFixturePromise;
}

async function fetchStandardOptionCatalog() {
  return fetchJson<EncarOptionCatalog>(
    "https://api.encar.com/v1/readside/vehicles/car/options/standard",
  );
}

const OPTION_CATEGORY_RU: Record<string, string> = {
  "01": "Экстерьер и интерьер",
  "02": "Безопасность",
  "03": "Комфорт и мультимедиа",
  "04": "Сиденья",
};

function selectedOptionNames(
  option: EncarOptionDefinition,
  selectedCodes: Set<string>,
) {
  const selectedSubOptions = (option.subOptions ?? []).filter(
    (subOption) => subOption.optionCd && selectedCodes.has(subOption.optionCd),
  );
  const names = selectedSubOptions
    .map((subOption) => subOption.groupOptionName ?? subOption.optionName)
    .filter((name): name is string => Boolean(name));
  return {
    original: names.join(", ") || null,
    ru:
      names
        .map((name) => translateOption(name))
        .filter(Boolean)
        .join(", ") || null,
  };
}

function mapStandardOptions(
  catalog: EncarOptionCatalog,
  installedCodes: string[],
): EncarOptionRow[] {
  const selectedCodes = new Set(installedCodes);
  return (catalog.options ?? []).map((option, index) => {
    const sourceCode = option.optionCd ?? null;
    const selectedSubOption = selectedOptionNames(option, selectedCodes);
    const present = Boolean(
      (sourceCode && selectedCodes.has(sourceCode)) ||
      (option.subOptions ?? []).some(
        (subOption) =>
          subOption.optionCd && selectedCodes.has(subOption.optionCd),
      ),
    );
    const originalName =
      option.optionTitle ?? option.groupOptionName ?? option.optionName ?? null;

    return {
      category:
        OPTION_CATEGORY_RU[String(option.optionTypeCd ?? "")] ?? "Другое",
      source_code: sourceCode,
      name_original: originalName,
      name_ru: translateOption(originalName),
      value_original: selectedSubOption.original,
      value_ru: selectedSubOption.ru,
      price_krw: null,
      description_original: option.description ?? null,
      description_ru: null,
      is_present: installedCodes.length ? present : null,
      sort_order: option.sort ?? index,
    };
  });
}

async function fetchChoiceOptions(
  vehicleId: string,
): Promise<EncarOptionRow[]> {
  const url = `https://api.encar.com/v1/readside/vehicles/car/${vehicleId}/options/choice`;
  try {
    const data =
      await fetchJson<Array<{ optionName?: string; price?: number }>>(url, 1);
    return Array.isArray(data)
      ? data.map((option, index) => ({
          category: "Дополнительные опции",
          source_code: null,
          name_original: option.optionName ?? null,
          name_ru: translateOption(option.optionName),
          value_original: null,
          value_ru: null,
          price_krw: option.price ?? null,
          description_original: null,
          description_ru: null,
          is_present: true,
          sort_order: 1000 + index,
        }))
      : [];
  } catch {
    return [];
  }
}

async function fetchInspection(vehicleId: string) {
  const baseUrl = `https://api.encar.com/v1/readside/inspection/vehicle/${vehicleId}`;
  const [inspection, summary] = await Promise.all([
    fetchJson<EncarInspection>(baseUrl, 1),
    fetchJson<EncarInspectionSummary>(`${baseUrl}/summary`, 1).catch(
      () => null,
    ),
  ]);
  return { inspection, summary };
}

async function fetchDiagnosis(vehicleId: string) {
  const baseUrl = `https://api.encar.com/v1/readside/diagnosis/vehicle/${vehicleId}`;
  const [diagnosis, sellingPoint] = await Promise.all([
    fetchJson<unknown>(baseUrl, 1).catch(() => null),
    fetchJson<unknown>(`${baseUrl}/sellingpoint`, 1).catch(() => null),
  ]);
  return diagnosis ? { diagnosis, sellingPoint } : null;
}

function normalizeInspectionNode(
  node: EncarInspectionNode,
): Record<string, unknown> {
  return {
    code: node.type?.code ?? null,
    label_original: node.type?.title ?? null,
    label_ru: translateInspectionLabel(node.type?.title),
    status_code: node.statusType?.code ?? null,
    status_original: node.statusType?.title ?? null,
    status_ru: translateInspectionStatus(node.statusType?.title),
    description_original: node.description ?? null,
    price: node.price ?? null,
    children: (node.children ?? []).map(normalizeInspectionNode),
  };
}

function buildInspectionReport(
  inspection: EncarInspection,
  summary: EncarInspectionSummary | null,
): EncarConditionReport {
  const detail = inspection.master?.detail ?? {};
  return {
    source: "encar",
    report_type: "encar_inspection",
    summary: {
      formats: inspection.formats ?? [],
      has_structured_report: (inspection.formats ?? []).includes("TABLE"),
      inspection_date: inspection.master?.registrationDate ?? null,
      supply_number: inspection.master?.supplyNum ?? null,
      accident: inspection.master?.accdient ?? null,
      simple_repair: inspection.master?.simpleRepair ?? null,
      inspector_name: summary?.inspName ?? detail.inspName ?? null,
      body_findings_count: inspection.outers?.length ?? 0,
      body_findings: summary?.outerSummarys ?? [],
    },
    items: (inspection.inners ?? []).map(normalizeInspectionNode),
    raw_payload: {
      inspection: { outers: inspection.outers ?? [] },
    },
  };
}

function inspectionMedia(inspection: EncarInspection) {
  return (inspection.images ?? [])
    .filter((image) => image.path)
    .map((image, index) => ({
      url: image.path?.startsWith("http")
        ? image.path
        : `https://ci.encar.com${image.path}`,
      category: "encar_inspection_document",
      sort_order: 2000 + index,
      title: image.title ?? null,
    }));
}

function buildDiagnosisReport(
  diagnosis: NonNullable<Awaited<ReturnType<typeof fetchDiagnosis>>>,
): EncarConditionReport {
  return {
    source: "encar",
    report_type: "encar_diagnosis",
    summary: {
      available: true,
      has_selling_point: Boolean(diagnosis.sellingPoint),
    },
    items: [],
    raw_payload: {},
  };
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeHistoryAccident(event: EncarHistoryAccident) {
  return {
    accidentDate: nullableText(event.accidentDate),
    accidentType: nullableText(event.accidentType),
    repairCost: nullableNumber(event.repairCost) ?? 0,
    partCost: nullableNumber(event.partCost) ?? 0,
    laborCost: nullableNumber(event.laborCost) ?? 0,
    paintingCost: nullableNumber(event.paintingCost) ?? 0,
  };
}

function sanitizeNonInsurancePeriod(value: Record<string, unknown>) {
  return {
    startDate:
      nullableText(value.startDate) ??
      nullableText(value.beginDate) ??
      nullableText(value.fromDate),
    endDate: nullableText(value.endDate) ?? nullableText(value.toDate),
  };
}

function sanitizeOwnerHistory(value: Record<string, unknown>) {
  return {
    acquisitionDate: nullableText(value.acquisitionDate),
    endDate: nullableText(value.endDate),
    registrationDate: nullableText(value.registrationDate),
    transferType: nullableText(value.transferType),
    ownerType: nullableText(value.ownerType),
    mileage: nullableNumber(value.mileage),
  };
}

function buildEncarHistoryReport(
  payload: EncarHistoryPayload,
): EncarConditionReport {
  const accidents = (payload.accidentHistoryResponse ?? []).map(
    sanitizeHistoryAccident,
  );
  const nonInsurancePeriods = (payload.nonInsurancePeriodResponse ?? []).map(
    sanitizeNonInsurancePeriod,
  );
  const ownerHistory = (payload.ownerHistoryResponse ?? []).map(
    sanitizeOwnerHistory,
  );
  const payoutTotalKrw = accidents.reduce(
    (sum, event) => sum + event.repairCost,
    0,
  );
  return {
    source: "encar",
    report_type: "encar_carhistory",
    summary: {
      available: true,
      accident_count: accidents.length,
      insurance_payout_count: accidents.length,
      insurance_payout_total_krw: payoutTotalKrw,
      non_insurance_period_count: nonInsurancePeriods.length,
      owner_history_count: ownerHistory.length,
    },
    items: accidents,
    raw_payload: {
      accidentHistoryResponse: accidents,
    },
  };
}

async function fetchEnrichment(
  vehicleId: string,
  detail: EncarDetail | null,
  optionCatalog: EncarOptionCatalog,
  hasInspection: boolean,
) {
  let inspectionError: string | null = null;
  const [choiceOptions, inspectionResult, diagnosis] = await Promise.all([
    fetchChoiceOptions(vehicleId),
    hasInspection || detail?.inspectionFormats.length
      ? fetchInspection(vehicleId).catch((error) => {
          inspectionError =
            error instanceof Error ? error.message : String(error);
          return null;
        })
      : Promise.resolve(null),
    fetchDiagnosis(vehicleId),
  ]);
  const standardOptions = mapStandardOptions(
    optionCatalog,
    detail?.standardOptionCodes ?? [],
  );
  const reports: EncarConditionReport[] = [];
  const reportMedia = inspectionResult
    ? inspectionMedia(inspectionResult.inspection)
    : [];

  if (inspectionResult) {
    reports.push(
      buildInspectionReport(
        inspectionResult.inspection,
        inspectionResult.summary,
      ),
    );
  }
  if (diagnosis) reports.push(buildDiagnosisReport(diagnosis));

  return {
    options: [...standardOptions, ...choiceOptions],
    reports,
    reportMedia,
    verification: {
      standardOptionsTotal: standardOptions.length,
      standardOptionsPresent: standardOptions.filter(
        (option) => option.is_present === true,
      ).length,
      choiceOptions: choiceOptions.length,
      inspectionFormats: detail?.inspectionFormats ?? [],
      inspectionAvailable: Boolean(inspectionResult),
      inspectionError,
      inspectionItems: inspectionResult?.inspection.inners?.length ?? 0,
      inspectionImages: reportMedia.length,
      bodyFindings: inspectionResult?.inspection.outers?.length ?? 0,
      diagnosisAvailable: Boolean(diagnosis),
    },
  };
}

async function fetchListPage(
  offset: number,
  manufacturer?: string,
  fuelType?: "electric" | "hybrid",
) {
  const fixture = await readListFixture();
  if (fixture) {
    return fixture
      .filter((item) => !manufacturer || item.Manufacturer === manufacturer)
      .filter(
        (item) =>
          !fuelType || normalizeFuel(item.FuelType) === fuelType,
      )
      .slice(offset, offset + ENCAR_PAGE_SIZE);
  }
  const data = await fetchJson<{ SearchResults?: EncarListCar[] }>(
    buildListUrl(offset, manufacturer, fuelType),
    6,
  );
  return data.SearchResults ?? [];
}

async function mapCar(
  listCar: EncarListCar,
  optionCatalog: EncarOptionCatalog,
  rateSnapshot: CalcRateSnapshot,
  onReject?: (reason: string) => void,
  fastMode = false,
) {
  const sourceId = String(listCar.Id);
  const detail = fastMode ? null : await fetchDetail(sourceId).catch(() => null);
  // List responses may contain only a four-image preview. Always enrich the
  // photo set during fast imports so new catalog cards do not persist that
  // truncated preview as their complete gallery.
  const photoDetail = fastMode
    ? await fetchDetail(sourceId).catch(() => null)
    : detail;
  if (!fastMode) await sleep(120);
  const photos = photoDetail?.photos.length ? photoDetail.photos : buildPhotos(listCar);
  const brand = normalizeBrand(
    detail?.manufacturerEnglish ?? listCar.Manufacturer,
  );
  const model = normalizeModel(detail?.modelEnglish ?? listCar.Model);
  const { year, month } = normalizeYear(listCar.Year);
  const fuelType = normalizeFuel(detail?.fuelName ?? listCar.FuelType);
  const isPureElectric = fuelType === "electric";
  const isHybrid = fuelType === "hybrid";
  const listedEngineCc = isPureElectric
    ? null
    : inferEngineCcFromBadge(listCar, detail);
  const engineCc = isPureElectric
    ? null
    : resolveEngineCc({
        brand,
        model,
        badge: listCar.Badge,
        badgeDetail: detail?.gradeEnglish ?? listCar.BadgeDetail,
        fuelType,
        engineCc: listedEngineCc,
        year,
      });
  if (
    !isPureElectric &&
    !isHybrid &&
    isElectrifiedConfiguration({
      brand,
      model,
      badge: listCar.Badge,
      badgeDetail: detail?.gradeEnglish ?? listCar.BadgeDetail,
      fuelType,
    })
  ) {
    onReject?.(`fuel:${fuelType ?? "unknown"}`);
    return null;
  }
  const driveType = normalizeDrive(
    [listCar.Badge, listCar.BadgeDetail].filter(Boolean).join(" "),
  );
  const powerInput = {
    brand,
    model,
    badge: listCar.Badge,
    badgeDetail: detail?.gradeEnglish ?? listCar.BadgeDetail,
    fuelType,
    driveType,
    engineCc,
    year,
  };
  const hybridPower = isHybrid ? resolveHybridPower(powerInput) : null;
  const power = hybridPower ?? resolvePower(powerInput);
  if (isHybrid && !hybridPower) {
    onReject?.(
      `hybrid_specs:${brand ?? "unknown"}:${model ?? "unknown"}:${detail?.gradeEnglish ?? listCar.Badge ?? "unknown"}:${engineCc ?? "unknown"}`,
    );
    return null;
  }
  if (!isPureElectric && !power) {
    onReject?.(
      `power:${brand ?? "unknown"}:${model ?? "unknown"}:${detail?.gradeEnglish ?? listCar.Badge ?? "unknown"}:${engineCc ?? "unknown"}`,
    );
    return null;
  }
  // Keep the displacement-based fallback used by Autoexport when Encar does
  // not expose a verified trim power; the warning below preserves provenance.
  const powerHp = power?.powerHp ?? null;
  const [enrichment, historyResult] = await Promise.all([
    fastMode
      ? Promise.resolve({
          options: [] as EncarOptionRow[],
          reports: [] as EncarConditionReport[],
          reportMedia: [],
        })
      : fetchEnrichment(
          sourceId,
          detail,
          optionCatalog,
          Boolean(listCar.Condition?.includes("Inspection")),
        ),
    fastMode
      ? Promise.resolve<EncarHistoryResult>({
          status: "unavailable",
          reason: "bulk_fast_import",
        })
      : detail?.vehicleNo
        ? fetchEncarHistory(detail.vehicleNo)
        : Promise.resolve<EncarHistoryResult>({
            status: "unavailable",
            reason: "vehicle_number_missing",
          }),
  ]);
  const { options, reports, reportMedia } = enrichment;
  const historyReport =
    historyResult.status === "available"
      ? buildEncarHistoryReport(historyResult.payload)
      : null;
  if (historyReport) reports.push(historyReport);
  const historySummary = historyReport?.summary as
    | {
        accident_count: number;
        insurance_payout_count: number;
        insurance_payout_total_krw: number;
      }
    | undefined;
  const priceKrw = Number(listCar.Price ?? 0) * 10000;
  const sourceUpdatedAt =
    detail?.modifiedAt ?? listCar.Photos?.[0]?.updatedDate ?? detail?.registeredAt ?? null;
  const calc =
    !isPureElectric && year && engineCc && powerHp && priceKrw
      ? calculateRuVladivostok({
          priceKrw,
          year,
          month: month ?? 6,
          engineCc,
          powerHp,
          hybridDvsPowerHp: hybridPower?.powerHp,
          hybridElectricPowerKw: hybridPower?.electricPowerKw,
          hybridDvsAboveElectric30Min:
            hybridPower?.dvsAboveElectric30Min,
          hybridSequential: hybridPower?.sequential,
          fuelType: fuelType ?? undefined,
          rates: rateSnapshot.rates,
          ratesAsOf: rateSnapshot.asOf,
          ratesSource: rateSnapshot.source,
          rateDetails: rateSnapshot.rateDetails,
        })
      : null;
  if (
    (!isPureElectric && !calc) ||
    !photos.some(
      (photo) => photo.category === "outer" || photo.category === "thumbnail",
    )
  ) {
    onReject?.(!calc ? "calculation" : "exterior_media");
    return null;
  }
  const snapshotPayload = {
    list: listCar,
    detail: detail?.raw ?? null,
    optionsCount: options.length,
    reportTypes: reports.map((report) => report.report_type),
    fetchedAt: new Date().toISOString(),
  };

  return {
    car: {
      vehicle_type: "car",
      vehicle_specs: {
        seats: detail?.seats ?? null,
        ...(listedEngineCc == null && engineCc
          ? { engine_cc_source: "verified_model_fallback" }
          : {}),
        ...(isPureElectric
          ? { calculation_status: "pending_official_ev_tariff" }
          : {}),
        ...(hybridPower
          ? {
              hybrid_calculation: {
                dvs_power_hp: hybridPower.powerHp,
                electric_power_kw: hybridPower.electricPowerKw,
                dvs_above_electric_30min:
                  hybridPower.dvsAboveElectric30Min,
                sequential: hybridPower.sequential,
                source: hybridPower.source,
              },
            }
          : {}),
      },
      primary_source: "encar",
      source_kind: "encar",
      source_id: sourceId,
      source_url: `https://fem.encar.com/cars/detail/${sourceId}`,
      enrichment_status: "source_only",
      is_available: true,
      sale_status: null,
      published_at: detail?.firstAdvertisedAt ?? null,
      source_updated_at: sourceUpdatedAt,
      last_seen_at: new Date().toISOString(),
      brand,
      model,
      generation: null,
      grade: detail?.gradeEnglish ?? null,
      trim: detail?.gradeDetailEnglish ?? null,
      badge: detail?.gradeEnglish ?? null,
      badge_detail: detail?.gradeEnglish ?? listCar.BadgeDetail ?? null,
      year,
      registration_year: year,
      registration_month: month,
      registration_date: null,
      mileage_km: listCar.Mileage ?? null,
      price_krw: priceKrw || null,
      price_rub: calc ? Math.round(calc.totalRub) : null,
      engine_cc: engineCc,
      power_hp: powerHp,
      power_source: power?.source ?? null,
      fuel_type: fuelType,
      hybrid_dvs_power_hp: hybridPower?.powerHp ?? null,
      hybrid_electric_power_kw: hybridPower?.electricPowerKw ?? null,
      hybrid_dvs_above_electric_30min:
        hybridPower?.dvsAboveElectric30Min ?? null,
      hybrid_sequential: hybridPower?.sequential ?? null,
      transmission: translateTransmission(
        detail?.transmission ?? listCar.Transmission,
      ),
      drive_type: driveType,
      body_type: normalizeBodyType(detail?.bodyTypeKr),
      color: detail?.color ?? null,
      seller_region: null,
      vehicle_no_masked: normalizePlate(detail?.vehicleNo) || null,
      vin_masked: detail?.vin ?? null,
      owners_count: null,
      accident_count: historySummary?.accident_count ?? null,
      insurance_payout_count: historySummary?.insurance_payout_count ?? null,
      insurance_payout_total_krw:
        historySummary?.insurance_payout_total_krw ?? null,
      has_360_exterior: false,
      has_360_interior: false,
      has_heydealer_eye: false,
      has_obd_scan: false,
      has_underbody_photo: false,
      has_thermal_images: false,
      data_confidence:
        detail && (powerHp || isPureElectric) && historyReport
          ? 0.86
          : detail && powerHp && power?.source !== "engine_fallback"
            ? 0.76
            : power?.source === "engine_fallback"
              ? 0.62
            : 0.58,
      data_warnings: [
        ...(!powerHp ? ["power_missing"] : []),
        ...(power?.source === "engine_fallback"
          ? ["power_normalized_from_engine"]
          : []),
        ...(listedEngineCc == null && engineCc
          ? ["engine_cc_normalized_from_verified_model"]
          : []),
        ...(isPureElectric ? ["ev_calculation_pending"] : []),
        ...(isHybrid ? ["hybrid_calculation_verified"] : []),
        ...(!isPureElectric && !calc ? ["calc_deferred"] : []),
        ...(historyResult.status === "unavailable"
          ? [historyResult.reason]
          : []),
      ],
    },
    photos,
    reportMedia,
    options,
    reports,
    calc,
    snapshot: {
      source: "encar",
      source_id: sourceId,
      source_url: `https://fem.encar.com/cars/detail/${sourceId}`,
      payload: snapshotPayload,
      payload_hash: hashPayload(snapshotPayload),
      parser_version: "encar-electric-safe-2026-08-24",
      status: "ok",
    },
  };
}

export async function importEncar(options: ImportOptions = {}) {
  const target = options.target ?? positiveInt(process.env.ENCAR_TARGET, 20);
  const maxPages =
    options.maxPages ?? positiveInt(process.env.ENCAR_MAX_PAGES, 2);
  const electricTarget = Math.min(
    target,
    options.electricTarget ?? positiveInt(process.env.ENCAR_ELECTRIC_TARGET, 4),
  );
  const electricPages =
    options.electricPages ?? positiveInt(process.env.ENCAR_ELECTRIC_PAGES, 3);
  const hybridTarget = Math.min(
    target,
    options.hybridTarget ?? positiveInt(process.env.ENCAR_HYBRID_TARGET, 6),
  );
  const hybridPages =
    options.hybridPages ?? positiveInt(process.env.ENCAR_HYBRID_PAGES, 3);
  const onlyNew =
    options.onlyNew ?? process.env.ENCAR_ONLY_NEW === "true";
  const fastMode =
    options.fastMode ?? process.env.ENCAR_FAST_MODE === "true";
  const dryRun = options.dryRun ?? process.env.ENCAR_DRY_RUN !== "false";
  const replaceCatalog =
    options.replaceCatalog ?? process.env.ENCAR_REPLACE_CATALOG === "true";
  const maxListingAgeDays =
    options.maxListingAgeDays ??
    positiveInt(process.env.CATALOG_MAX_LISTING_AGE_DAYS, 30);
  const brandMinimums: Record<string, number> = {};
  for (const [brand, configuredMinimum] of Object.entries(
    options.brandMinimums ?? {},
  )) {
    const normalizedBrand = normalizeBrand(brand);
    const minimum = Math.max(0, Math.floor(configuredMinimum));
    if (normalizedBrand && minimum > 0)
      brandMinimums[normalizedBrand] = minimum;
  }
  const requiredBrandCars = Object.values(brandMinimums).reduce(
    (sum, minimum) => sum + minimum,
    0,
  );
  if (requiredBrandCars > target) {
    throw new Error(
      `Encar brand minimums (${requiredBrandCars}) exceed target (${target})`,
    );
  }
  const modelMinimums: Record<string, number> = {};
  for (const [identity, configuredMinimum] of Object.entries(
    options.modelMinimums ?? {},
  )) {
    const [rawBrand, rawModel] = identity.split(":", 2);
    const brand = normalizeBrand(rawBrand);
    const model = normalizeModel(rawModel);
    const minimum = Math.max(0, Math.floor(configuredMinimum));
    if (brand && model && minimum > 0)
      modelMinimums[`${brand}:${model}`] = minimum;
  }
  const requiredModelCars = Object.values(modelMinimums).reduce(
    (sum, minimum) => sum + minimum,
    0,
  );
  if (requiredModelCars > target) {
    throw new Error(
      `Encar model minimums (${requiredModelCars}) exceed target (${target})`,
    );
  }
  const rateSnapshot = await getCbrCalcRates();
  const mapped: NonNullable<Awaited<ReturnType<typeof mapCar>>>[] = [];
  const optionCatalog = fastMode
    ? { options: [] as EncarOptionDefinition[] }
    : await fetchStandardOptionCatalog();
  const identities = new Set<string>();

  const candidates: EncarListCar[] = [];
  const listPageErrors: Array<{
    page: number;
    brand?: string;
    message: string;
  }> = [];
  const priorityBrandPages = options.priorityBrandPages ?? {};
  const encarManufacturerByBrand: Record<string, string> = {
    "Mercedes-Benz": "벤츠",
    BMW: "BMW",
    Audi: "아우디",
  };
  for (const [rawBrand, configuredPages] of Object.entries(
    priorityBrandPages,
  )) {
    const brand = normalizeBrand(rawBrand);
    const manufacturer = brand ? encarManufacturerByBrand[brand] : null;
    const pages = Math.max(0, Math.floor(configuredPages));
    if (!brand || !manufacturer || pages === 0) continue;
    for (let page = 0; page < pages; page += 1) {
      try {
        const list = await fetchListPage(
          page * ENCAR_PAGE_SIZE,
          manufacturer,
        );
        if (!list.length) break;
        candidates.push(...list);
      } catch (error) {
        listPageErrors.push({
          page: page + 1,
          brand,
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }
  for (let page = 0; page < maxPages; page += 1) {
    let list: EncarListCar[];
    try {
      list = await fetchListPage(page * ENCAR_PAGE_SIZE);
    } catch (error) {
      listPageErrors.push({
        page: page + 1,
        message: error instanceof Error ? error.message : String(error),
      });
      if (candidates.length === 0) throw error;
      break;
    }
    if (!list.length) break;
    candidates.push(...list);
  }
  for (let page = 0; page < electricPages; page += 1) {
    try {
      const list = await fetchListPage(
        page * ENCAR_PAGE_SIZE,
        undefined,
        "electric",
      );
      if (!list.length) break;
      candidates.push(...list);
    } catch (error) {
      listPageErrors.push({
        page: page + 1,
        brand: "electric",
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  for (let page = 0; page < hybridPages; page += 1) {
    try {
      const list = await fetchListPage(
        page * ENCAR_PAGE_SIZE,
        undefined,
        "hybrid",
      );
      if (!list.length) break;
      candidates.push(...list);
    } catch (error) {
      listPageErrors.push({
        page: page + 1,
        brand: "hybrid",
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  const uniqueCandidates = [
    ...new Map(candidates.map((item) => [String(item.Id), item])).values(),
  ];
  const existingSourceIds = new Set<string>();
  if (onlyNew && uniqueCandidates.length) {
    const supabase = createSupabaseAdmin();
    const candidateIds = uniqueCandidates.map((item) => String(item.Id));
    for (let index = 0; index < candidateIds.length; index += 200) {
      const chunk = candidateIds.slice(index, index + 200);
      const { data, error } = await supabase
        .from("cars")
        .select("source_id")
        .eq("primary_source", "encar")
        .in("source_id", chunk);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.source_id) existingSourceIds.add(String(row.source_id));
      }
    }
  }

  const freshCandidates = uniqueCandidates
    .filter((item) => !onlyNew || !existingSourceIds.has(String(item.Id)))
    .filter((item) =>
      isFreshListing(item.Photos?.[0]?.updatedDate, maxListingAgeDays),
    )
    .filter((item) => {
      const fuel = normalizeFuel(item.FuelType);
      return (
        fuel === "gasoline" ||
        fuel === "diesel" ||
        fuel === "electric" ||
        fuel === "hybrid"
      );
    })
    .sort((left, right) => Number(right.Id) - Number(left.Id));

  const attemptedSourceIds = new Set<string>();
  const mappedBrandCounts: Record<string, number> = {};
  const mappedModelCounts: Record<string, number> = {};
  const quotaRejections: Array<{
    sourceId: string;
    brand: string;
    reason: string;
  }> = [];
  const tryMapCandidate = async (item: EncarListCar) => {
    const sourceId = String(item.Id);
    if (attemptedSourceIds.has(sourceId) || mapped.length >= target) return;
    attemptedSourceIds.add(sourceId);
    if (attemptedSourceIds.size % 25 === 0) {
      console.log(
        `[encar] checked=${attemptedSourceIds.size} accepted=${mapped.length} target=${target}`,
      );
    }
    const candidateBrand = normalizeBrand(item.Manufacturer);
    const mappedCar = await mapCar(
      item,
      optionCatalog,
      rateSnapshot,
      (reason) => {
        if (candidateBrand) {
          quotaRejections.push({ sourceId, brand: candidateBrand, reason });
        }
      },
      fastMode,
    );
    if (mappedCar) {
      const identity =
        mappedCar.car.vin_masked ||
        mappedCar.car.vehicle_no_masked ||
        mappedCar.car.source_id;
      if (!identities.has(identity)) {
        identities.add(identity);
        mapped.push(mappedCar);
        const mappedBrand = mappedCar.car.brand;
        const mappedModel = mappedCar.car.model;
        if (mappedBrand)
          mappedBrandCounts[mappedBrand] =
            (mappedBrandCounts[mappedBrand] ?? 0) + 1;
        if (mappedBrand && mappedModel) {
          const identityKey = `${mappedBrand}:${mappedModel}`;
          mappedModelCounts[identityKey] =
            (mappedModelCounts[identityKey] ?? 0) + 1;
        }
      }
    }
    if (!fastMode) await sleep(180);
  };

  const electricCandidates = freshCandidates
    .filter((item) => normalizeFuel(item.FuelType) === "electric")
    .sort((left, right) => {
      const preferred = new Set(["Hyundai", "Kia", "Genesis"]);
      return Number(preferred.has(normalizeBrand(right.Manufacturer) ?? "")) -
        Number(preferred.has(normalizeBrand(left.Manufacturer) ?? ""));
    });
  for (const item of electricCandidates) {
    const electricCount = mapped.filter(
      (entry) => entry.car.fuel_type === "electric",
    ).length;
    if (electricCount >= electricTarget || mapped.length >= target) break;
    await tryMapCandidate(item);
  }

  const hybridCandidates = freshCandidates
    .filter((item) => normalizeFuel(item.FuelType) === "hybrid")
    .sort((left, right) => {
      const preferred = new Set(["Hyundai", "Kia"]);
      return Number(preferred.has(normalizeBrand(right.Manufacturer) ?? "")) -
        Number(preferred.has(normalizeBrand(left.Manufacturer) ?? ""));
    });
  for (const item of hybridCandidates) {
    const hybridCount = mapped.filter(
      (entry) => entry.car.fuel_type === "hybrid",
    ).length;
    if (hybridCount >= hybridTarget || mapped.length >= target) break;
    await tryMapCandidate(item);
  }

  for (const [requiredIdentity, minimum] of Object.entries(modelMinimums)) {
    const [requiredBrand, requiredModel] = requiredIdentity.split(":", 2);
    const modelCandidates = freshCandidates.filter(
      (item) =>
        normalizeBrand(item.Manufacturer) === requiredBrand &&
        normalizeModel(item.Model) === requiredModel,
    );
    for (const item of modelCandidates) {
      if ((mappedModelCounts[requiredIdentity] ?? 0) >= minimum) break;
      await tryMapCandidate(item);
    }
  }

  for (const [requiredBrand, minimum] of Object.entries(brandMinimums)) {
    const brandCandidates = freshCandidates.filter(
      (item) => normalizeBrand(item.Manufacturer) === requiredBrand,
    );
    for (const item of brandCandidates) {
      if ((mappedBrandCounts[requiredBrand] ?? 0) >= minimum) break;
      await tryMapCandidate(item);
    }
  }

  const combustionCandidates = freshCandidates.filter((item) => {
    const fuel = normalizeFuel(item.FuelType);
    return fuel === "gasoline" || fuel === "diesel";
  });
  for (const item of combustionCandidates) {
    if (mapped.length >= target) break;
    await tryMapCandidate(item);
  }
  const brandMinimumsSatisfied = Object.entries(brandMinimums).every(
    ([brand, minimum]) => (mappedBrandCounts[brand] ?? 0) >= minimum,
  );
  const modelMinimumsSatisfied = Object.entries(modelMinimums).every(
    ([identity, minimum]) => (mappedModelCounts[identity] ?? 0) >= minimum,
  );
  const quotaRejectionCounts = quotaRejections.reduce<Record<string, number>>(
    (counts, rejection) => {
      const key = rejection.reason.split(":", 1)[0] || rejection.reason;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    },
    {},
  );

  if (dryRun) {
    return {
      dryRun,
      candidates: candidates.length,
      uniqueCandidates: uniqueCandidates.length,
      onlyNew,
      existingCandidates: existingSourceIds.size,
      listPageErrors,
      freshCandidates: freshCandidates.length,
      electricTarget,
      electricSeen: mapped.filter((item) => item.car.fuel_type === "electric").length,
      hybridTarget,
      hybridSeen: mapped.filter((item) => item.car.fuel_type === "hybrid").length,
      seen: mapped.length,
      written: 0,
      brandMinimums,
      brandCounts: mappedBrandCounts,
      brandMinimumsSatisfied,
      modelMinimums,
      modelCounts: mappedModelCounts,
      modelMinimumsSatisfied,
      quotaRejectionCount: quotaRejections.length,
      quotaRejectionCounts,
      quotaRejections: quotaRejections.slice(0, 10),
      sample: mapped.slice(0, 3).map((item) => ({
        car: item.car,
        optionCount: item.options.length,
        presentOptionCount: item.options.filter(
          (option) => option.is_present === true,
        ).length,
        reportTypes: item.reports.map((report) => report.report_type),
      })),
    };
  }

  const supabase = createSupabaseAdmin();
  const { data: run, error: runError } = await supabase
    .from("source_import_runs")
    .insert({
      source: "encar",
      job_name: "encar_mvp_import",
      status: "running",
      meta: {
        target,
        maxPages,
        electricTarget,
        electricPages,
        hybridTarget,
        hybridPages,
      onlyNew,
      fastMode,
      replaceCatalog,
        brandMinimums,
        modelMinimums,
        priorityBrandPages,
      },
    })
    .select("id")
    .single();
  if (runError) throw runError;

  let written = 0;
  let deactivated = 0;
  const errors: Array<{ sourceId: string; error: unknown }> = [];

  // Fast bulk imports contain only fresh rows, without enrichment/options or
  // reports.  Keep the full write sequence for normal imports, but allow a
  // small bounded concurrency for bulk inserts so a 500-item refresh does not
  // spend several minutes doing independent network round trips in series.
  let writeCursor = 0;
  const writeWorker = async () => {
    while (writeCursor < mapped.length) {
      const item = mapped[writeCursor];
      writeCursor += 1;
      if (!item) continue;
      try {
      const { data: savedCar, error: carError } = await supabase
        .from("cars")
        .upsert(item.car, { onConflict: "primary_source,source_id" })
        .select("id")
        .single();
      if (carError) throw carError;
      const carId = savedCar.id as string;

      assertSupabaseResult(
        await supabase.from("source_snapshots").insert(item.snapshot),
      );
      assertSupabaseResult(
        await supabase
          .from("car_media")
          .delete()
          .eq("car_id", carId)
          .eq("source", "encar"),
      );
      if (item.photos.length || item.reportMedia.length) {
        assertSupabaseResult(
          await supabase.from("car_media").insert([
            ...item.photos.map((photo, index) => ({
              car_id: carId,
              source: "encar",
              media_type: "image",
              category: photo.category,
              url: photo.url,
              sort_order: index,
              is_primary: index === 0,
            })),
            ...item.reportMedia.map((media) => ({
              car_id: carId,
              source: "encar",
              media_type: "image",
              category: media.category,
              url: media.url,
              sort_order: media.sort_order,
              is_primary: false,
            })),
          ]),
        );
      }

      assertSupabaseResult(
        await supabase
          .from("car_options")
          .delete()
          .eq("car_id", carId)
          .eq("source", "encar"),
      );
      if (item.options.length) {
        assertSupabaseResult(
          await supabase.from("car_options").insert(
            item.options.map((option) => ({
              car_id: carId,
              source: "encar",
              ...compactOptionRow(option),
            })),
          ),
        );
      }

      assertSupabaseResult(
        await supabase
          .from("car_condition_reports")
          .delete()
          .eq("car_id", carId)
          .eq("source", "encar"),
      );
      if (item.reports.length) {
        assertSupabaseResult(
          await supabase.from("car_condition_reports").insert(
            item.reports.map((report) => ({
              car_id: carId,
              ...report,
            })),
          ),
        );
      }

      if (item.calc) {
        assertSupabaseResult(
          await supabase
            .from("leads")
            .update({ calc_snapshot_id: null })
            .eq("car_id", carId),
        );
        assertSupabaseResult(
          await supabase.from("calc_snapshots").delete().eq("car_id", carId),
        );
        assertSupabaseResult(
          await supabase.from("calc_snapshots").insert({
            car_id: carId,
            calc_version: item.calc.calcVersion,
            inputs: item.car,
            rates: { ...item.calc.rates, details: item.calc.rateDetails },
            result: item.calc,
            car_price_rub: Math.round(item.calc.carPriceRub),
            duty_rub: Math.round(item.calc.dutyRub),
            fees_rub: Math.round(item.calc.feesRub),
            util_rub: Math.round(item.calc.utilRub),
            freight_rub: Math.round(item.calc.freightRub),
            broker_rub: Math.round(item.calc.brokerRub),
            total_rub: Math.round(item.calc.totalRub),
          }),
        );
      }

      written += 1;
      } catch (error) {
        errors.push({ sourceId: item.car.source_id, error });
      }
    }
  };
  const writeConcurrency = fastMode && onlyNew ? 8 : 1;
  await Promise.all(
    Array.from({ length: Math.min(writeConcurrency, mapped.length) }, () =>
      writeWorker(),
    ),
  );

  if (
    replaceCatalog &&
    process.env.ENCAR_AUTHORITATIVE_REPLACE === "true" &&
    brandMinimumsSatisfied &&
    modelMinimumsSatisfied &&
    errors.length === 0 &&
    written === mapped.length &&
    mapped.length >= target
  ) {
    const activeSourceIds = new Set(mapped.map((item) => item.car.source_id));
    const { data: currentCars, error: currentCarsError } = await supabase
      .from("cars")
      .select("id, source_id")
      .eq("primary_source", "encar")
      .eq("is_available", true);
    if (currentCarsError) {
      errors.push({ sourceId: "catalog-replacement", error: currentCarsError });
    } else {
      const staleIds = (currentCars ?? [])
        .filter((car) => !activeSourceIds.has(String(car.source_id)))
        .map((car) => car.id as string);
      if (staleIds.length) {
        const staleSourceIds = (currentCars ?? [])
          .filter((car) => staleIds.includes(car.id as string))
          .map((car) => String(car.source_id));
        let relationsPurged = true;
        try {
          await purgeRetiredEncarRelations(supabase, staleIds, staleSourceIds);
        } catch (error) {
          errors.push({ sourceId: "catalog-replacement", error });
          relationsPurged = false;
        }
        if (relationsPurged) {
          const { error: retireError } = await supabase
            .from("cars")
            .update({ is_available: false })
            .in("id", staleIds);
          if (retireError) {
            errors.push({ sourceId: "catalog-replacement", error: retireError });
          }
          else deactivated = staleIds.length;
        }
      }
    }
  }

  await supabase
    .from("source_import_runs")
    .update({
      status: errors.length ? "finished_with_errors" : "finished",
      finished_at: new Date().toISOString(),
      cars_seen: mapped.length,
      cars_created: written,
      errors_count: errors.length,
      error_sample: errors.slice(0, 3),
    })
    .eq("id", run.id);

  return {
    dryRun,
    candidates: candidates.length,
    uniqueCandidates: uniqueCandidates.length,
    onlyNew,
    existingCandidates: existingSourceIds.size,
    listPageErrors,
    freshCandidates: freshCandidates.length,
    electricTarget,
    electricSeen: mapped.filter((item) => item.car.fuel_type === "electric").length,
    hybridTarget,
    hybridSeen: mapped.filter((item) => item.car.fuel_type === "hybrid").length,
    seen: mapped.length,
    written,
    deactivated,
    errors: errors.length,
    brandMinimums,
    brandCounts: mappedBrandCounts,
    brandMinimumsSatisfied,
    modelMinimums,
    modelCounts: mappedModelCounts,
    modelMinimumsSatisfied,
    quotaRejectionCount: quotaRejections.length,
    quotaRejectionCounts,
    quotaRejections: quotaRejections.slice(0, 10),
  };
}

function assertSupabaseResult(result: { error: unknown }) {
  if (result.error) throw result.error;
}

async function purgeRetiredEncarRelations(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  carIds: string[],
  sourceIds: string[],
) {
  assertSupabaseResult(
    await supabase
      .from("leads")
      .update({ calc_snapshot_id: null })
      .in("car_id", carIds),
  );
  for (const table of [
    "car_media",
    "car_options",
    "car_condition_reports",
    "calc_snapshots",
  ] as const) {
    assertSupabaseResult(await supabase.from(table).delete().in("car_id", carIds));
  }
  if (sourceIds.length) {
    assertSupabaseResult(
      await supabase
        .from("source_snapshots")
        .delete()
        .eq("source", "encar")
        .in("source_id", sourceIds),
    );
  }
}

export async function inspectEncarVehicles(vehicleIds: string[]) {
  const optionCatalog = await fetchStandardOptionCatalog();
  const results = [];

  for (const vehicleId of vehicleIds) {
    try {
      const detail = await fetchDetail(vehicleId);
      const enrichment = await fetchEnrichment(
        vehicleId,
        detail,
        optionCatalog,
        true,
      );
      results.push({ vehicleId, ok: true, ...enrichment.verification });
    } catch (error) {
      results.push({
        vehicleId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(180);
  }

  return results;
}

export async function refreshEncarHistories(
  options: {
    dryRun?: boolean;
    concurrency?: number;
  } = {},
) {
  const dryRun = options.dryRun ?? true;
  const concurrency = Math.min(
    8,
    Math.max(1, Math.floor(options.concurrency ?? 4)),
  );
  const supabase = createSupabaseAdmin();
  const { data: cars, error: carsError } = await supabase
    .from("cars")
    .select("id, source_id, vehicle_no_masked, brand, model, data_warnings")
    .eq("primary_source", "encar")
    .eq("is_available", true);
  if (carsError) throw carsError;

  let cursor = 0;
  let available = 0;
  let unavailable = 0;
  let withAccidents = 0;
  let insuranceEvents = 0;
  let payoutTotalKrw = 0;
  let written = 0;
  const errors: Array<{ sourceId: string; error: string }> = [];
  const samples: Array<Record<string, unknown>> = [];

  const worker = async () => {
    while (cursor < (cars?.length ?? 0)) {
      const car = cars?.[cursor];
      cursor += 1;
      if (!car) return;

      try {
        const historyResult = car.vehicle_no_masked
          ? await fetchEncarHistory(String(car.vehicle_no_masked))
          : ({
              status: "unavailable",
              reason: "vehicle_number_missing",
            } satisfies EncarHistoryResult);
        const currentWarnings = Array.isArray(car.data_warnings)
          ? car.data_warnings.filter(
              (warning): warning is string =>
                typeof warning === "string" &&
                !warning.startsWith("encar_history_http_") &&
                warning !== "vehicle_number_missing",
            )
          : [];

        if (historyResult.status === "unavailable") {
          unavailable += 1;
          samples.push({
            sourceId: car.source_id,
            brand: car.brand,
            model: car.model,
            status: "unavailable",
            reason: historyResult.reason,
          });
          if (!dryRun) {
            assertSupabaseResult(
              await supabase
                .from("cars")
                .update({
                  accident_count: null,
                  insurance_payout_count: null,
                  insurance_payout_total_krw: null,
                  data_warnings: [...currentWarnings, historyResult.reason],
                })
                .eq("id", car.id),
            );
            assertSupabaseResult(
              await supabase
                .from("car_condition_reports")
                .delete()
                .eq("car_id", car.id)
                .eq("source", "encar")
                .eq("report_type", "encar_carhistory"),
            );
            written += 1;
          }
          continue;
        }

        available += 1;
        const report = buildEncarHistoryReport(historyResult.payload);
        const summary = report.summary as {
          accident_count: number;
          insurance_payout_count: number;
          insurance_payout_total_krw: number;
        };
        insuranceEvents += summary.insurance_payout_count;
        payoutTotalKrw += summary.insurance_payout_total_krw;
        if (summary.accident_count > 0) withAccidents += 1;
        samples.push({
          sourceId: car.source_id,
          brand: car.brand,
          model: car.model,
          status: "available",
          accidentCount: summary.accident_count,
          payoutTotalKrw: summary.insurance_payout_total_krw,
        });

        if (!dryRun) {
          assertSupabaseResult(
            await supabase
              .from("cars")
              .update({
                accident_count: summary.accident_count,
                insurance_payout_count: summary.insurance_payout_count,
                insurance_payout_total_krw: summary.insurance_payout_total_krw,
                data_warnings: currentWarnings,
              })
              .eq("id", car.id),
          );
          assertSupabaseResult(
            await supabase.from("car_condition_reports").upsert(
              {
                car_id: car.id,
                ...report,
              },
              { onConflict: "car_id,source,report_type" },
            ),
          );
          written += 1;
        }
      } catch (error) {
        errors.push({
          sourceId: String(car.source_id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(80);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    dryRun,
    seen: cars?.length ?? 0,
    available,
    unavailable,
    withAccidents,
    insuranceEvents,
    payoutTotalKrw,
    written,
    errors,
    samples,
  };
}

export async function refreshEncarPhotos() {
  const supabase = createSupabaseAdmin();
  const { data: cars, error: carsError } = await supabase
    .from("cars")
    .select("id, source_id")
    .eq("primary_source", "encar")
    .eq("is_available", true);
  if (carsError) throw carsError;

  let updated = 0;
  const errors: Array<{ sourceId: string; error: string }> = [];

  for (const car of cars ?? []) {
    const sourceId = String(car.source_id);
    try {
      const detail = await fetchDetail(sourceId);
      if (!detail.photos.length)
        throw new Error("Encar detail returned no photos");

      const deleteResult = await supabase
        .from("car_media")
        .delete()
        .eq("car_id", car.id)
        .eq("source", "encar")
        .eq("media_type", "image")
        .in("category", ["exterior", "photo"]);
      assertSupabaseResult(deleteResult);

      const insertResult = await supabase.from("car_media").insert(
        detail.photos.map((photo, index) => ({
          car_id: car.id,
          source: "encar",
          media_type: "image",
          category: photo.category,
          url: photo.url,
          sort_order: index,
          is_primary: index === 0,
        })),
      );
      assertSupabaseResult(insertResult);
      updated += 1;
    } catch (error) {
      errors.push({
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(120);
  }

  return { seen: cars?.length ?? 0, updated, errors };
}
