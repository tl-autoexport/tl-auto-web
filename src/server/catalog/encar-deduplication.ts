import { normalizePlate } from "@/server/normalization/vehicles";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { createSupabasePublic } from "@/server/supabase/public";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EncarDeduplicationCar = {
  id: string;
  source_id: string;
  source_updated_at: string | null;
  updated_at?: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileage_km: number | null;
  price_krw: number | null;
  engine_cc: number | null;
  vehicle_no_masked: string | null;
  vin_masked: string | null;
  source_kind?: string | null;
  enrichment_status?: string | null;
  has_360_exterior?: boolean | null;
  has_360_interior?: boolean | null;
  has_heydealer_eye?: boolean | null;
  has_obd_scan?: boolean | null;
  has_underbody_photo?: boolean | null;
  has_thermal_images?: boolean | null;
  data_confidence?: number | null;
  data_warnings?: string[] | null;
  color?: string | null;
  transmission?: string | null;
  drive_type?: string | null;
  body_type?: string | null;
  power_hp?: number | null;
  power_source?: string | null;
  owners_count?: number | null;
  accident_count?: number | null;
  insurance_payout_count?: number | null;
  insurance_payout_total_krw?: number | null;
};

export type EncarDuplicateGroup = {
  matchType: "vin" | "plate";
  matchKey: string;
  keeper: EncarDeduplicationCar;
  duplicates: EncarDeduplicationCar[];
};

const CAR_SELECT = [
  "id", "source_id", "source_updated_at", "updated_at", "brand", "model",
  "year", "mileage_km", "price_krw", "engine_cc", "vehicle_no_masked",
  "vin_masked", "source_kind", "enrichment_status", "has_360_exterior",
  "has_360_interior", "has_heydealer_eye", "has_obd_scan",
  "has_underbody_photo", "has_thermal_images", "data_confidence",
  "data_warnings",
  "color", "transmission", "drive_type", "body_type", "power_hp",
  "power_source", "owners_count", "accident_count", "insurance_payout_count",
  "insurance_payout_total_krw",
].join(",");

export function findEncarDuplicateGroups(cars: EncarDeduplicationCar[]) {
  const groups: EncarDuplicateGroup[] = [];
  const claimedIds = new Set<string>();
  collectGroups(cars, "vin", claimedIds, groups);
  collectGroups(cars, "plate", claimedIds, groups);
  return groups;
}

export async function deduplicateActiveEncarCatalog(
  options: { dryRun?: boolean } = {},
) {
  const dryRun = options.dryRun ?? true;
  const supabase = dryRun ? createSupabasePublic() : createSupabaseAdmin();
  const cars = await loadActiveEncarCars(supabase);
  const groups = findEncarDuplicateGroups(cars);
  if (dryRun) return summarize(groups, 0, 0, true);

  let deactivated = 0;
  let transferredRows = 0;
  for (const group of groups) {
    for (const duplicate of group.duplicates) {
      transferredRows += await mergeDuplicateIntoKeeper(
        supabase,
        group.keeper,
        duplicate,
      );
      deactivated += 1;
    }
  }
  return summarize(groups, deactivated, transferredRows, false);
}

function collectGroups(
  cars: EncarDeduplicationCar[],
  matchType: "vin" | "plate",
  claimedIds: Set<string>,
  output: EncarDuplicateGroup[],
) {
  const byKey = new Map<string, EncarDeduplicationCar[]>();
  for (const car of cars) {
    if (claimedIds.has(car.id)) continue;
    const key = matchType === "vin" ? vinKey(car) : plateKey(car);
    if (!key) continue;
    const group = byKey.get(key) ?? [];
    group.push(car);
    byKey.set(key, group);
  }
  for (const [matchKey, candidates] of byKey) {
    if (candidates.length < 2) continue;
    const sorted = [...candidates].sort(compareKeeperPriority);
    const [keeper, ...duplicates] = sorted;
    output.push({ matchType, matchKey, keeper, duplicates });
    for (const car of sorted) claimedIds.add(car.id);
  }
}

function vinKey(car: EncarDeduplicationCar) {
  const vin = normalizeVin(car.vin_masked);
  const identity = basicIdentity(car);
  return vin && identity ? `${vin}|${identity}` : null;
}

function plateKey(car: EncarDeduplicationCar) {
  const plate = normalizePlate(car.vehicle_no_masked);
  const identity = basicIdentity(car);
  if (!plate || !identity || car.engine_cc === null || car.mileage_km === null || car.price_krw === null) return null;
  return [plate, identity, car.engine_cc, car.mileage_km, car.price_krw].join("|");
}

function basicIdentity(car: EncarDeduplicationCar) {
  const brand = canonicalText(car.brand);
  const model = canonicalText(car.model);
  return brand && model && car.year ? `${brand}|${model}|${car.year}` : null;
}

function normalizeVin(value: string | null) {
  const normalized = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 11 && !/[IOQ]/.test(normalized) ? normalized : null;
}

function canonicalText(value: string | null) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "").trim();
}

function compareKeeperPriority(left: EncarDeduplicationCar, right: EncarDeduplicationCar) {
  const dateDifference = timestamp(right) - timestamp(left);
  if (dateDifference !== 0) return dateDifference;
  const sourceDifference = numericSourceId(right) - numericSourceId(left);
  if (sourceDifference !== 0) return sourceDifference;
  return completenessScore(right) - completenessScore(left);
}

function timestamp(car: EncarDeduplicationCar) {
  const parsed = Date.parse(car.source_updated_at ?? car.updated_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericSourceId(car: EncarDeduplicationCar) {
  const parsed = Number.parseInt(car.source_id, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function completenessScore(car: EncarDeduplicationCar) {
  return [car.vehicle_no_masked, car.vin_masked, car.brand, car.model, car.year,
    car.mileage_km, car.price_krw, car.engine_cc, car.has_360_exterior,
    car.has_360_interior, car.has_heydealer_eye, car.has_obd_scan,
    car.has_underbody_photo, car.has_thermal_images].filter(Boolean).length;
}

async function loadActiveEncarCars(supabase: SupabaseClient) {
  const cars: EncarDeduplicationCar[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("cars").select(CAR_SELECT)
      .eq("primary_source", "encar").eq("is_available", true)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as EncarDeduplicationCar[];
    cars.push(...batch);
    if (batch.length < pageSize) break;
  }
  return cars;
}

async function mergeDuplicateIntoKeeper(
  supabase: SupabaseClient,
  keeper: EncarDeduplicationCar,
  duplicate: EncarDeduplicationCar,
) {
  let transferredRows = 0;
  transferredRows += await transferUniqueRows(supabase, "car_media", keeper.id, duplicate.id,
    (row) => [row.source, row.media_type, row.category, row.url].join("|"),
    { is_primary: false });
  transferredRows += await transferUniqueRows(supabase, "car_options", keeper.id, duplicate.id,
    (row) => [row.source, row.source_code, row.category, row.name_original, row.name_ru,
      row.value_original, row.value_ru, row.is_present].join("|"));
  transferredRows += await transferRicherReports(supabase, keeper.id, duplicate.id);
  transferredRows += await moveAllRows(supabase, "calc_snapshots", keeper.id, duplicate.id);

  const hasHeyDealerData = Boolean(keeper.has_heydealer_eye || duplicate.has_heydealer_eye);
  const keeperPatch = {
    source_kind: hasHeyDealerData || keeper.source_kind === "encar+heydealer" || duplicate.source_kind === "encar+heydealer" ? "encar+heydealer" : "encar",
    enrichment_status: hasHeyDealerData || keeper.enrichment_status === "heydealer_matched" || duplicate.enrichment_status === "heydealer_matched" ? "heydealer_matched" : keeper.enrichment_status,
    has_360_exterior: Boolean(keeper.has_360_exterior || duplicate.has_360_exterior),
    has_360_interior: Boolean(keeper.has_360_interior || duplicate.has_360_interior),
    has_heydealer_eye: hasHeyDealerData,
    has_obd_scan: Boolean(keeper.has_obd_scan || duplicate.has_obd_scan),
    has_underbody_photo: Boolean(keeper.has_underbody_photo || duplicate.has_underbody_photo),
    has_thermal_images: Boolean(keeper.has_thermal_images || duplicate.has_thermal_images),
    data_confidence: Math.max(Number(keeper.data_confidence ?? 0), Number(duplicate.data_confidence ?? 0)),
    data_warnings: [...new Set([...(keeper.data_warnings ?? []), ...(duplicate.data_warnings ?? [])])],
    color: keeper.color ?? duplicate.color,
    transmission: keeper.transmission ?? duplicate.transmission,
    drive_type: keeper.drive_type ?? duplicate.drive_type,
    body_type: keeper.body_type ?? duplicate.body_type,
    power_hp: keeper.power_hp ?? duplicate.power_hp,
    power_source: keeper.power_source ?? duplicate.power_source,
    owners_count: keeper.owners_count ?? duplicate.owners_count,
    accident_count: keeper.accident_count ?? duplicate.accident_count,
    insurance_payout_count: keeper.insurance_payout_count ?? duplicate.insurance_payout_count,
    insurance_payout_total_krw: keeper.insurance_payout_total_krw ?? duplicate.insurance_payout_total_krw,
  };
  const { error: keeperError } = await supabase.from("cars").update(keeperPatch).eq("id", keeper.id);
  if (keeperError) throw keeperError;
  Object.assign(keeper, keeperPatch);

  const { error: duplicateError } = await supabase.from("cars").update({
    is_available: false,
    sale_status: "duplicate_relisted",
    enrichment_status: "merged_duplicate",
  }).eq("id", duplicate.id);
  if (duplicateError) throw duplicateError;
  return transferredRows;
}

type ChildRow = Record<string, unknown> & { id: string };

async function transferUniqueRows(
  supabase: SupabaseClient, table: string,
  keeperId: string, duplicateId: string, keyOf: (row: ChildRow) => string,
  movePatch: Record<string, unknown> = {},
) {
  const [keeperResult, duplicateResult] = await Promise.all([
    supabase.from(table).select("*").eq("car_id", keeperId),
    supabase.from(table).select("*").eq("car_id", duplicateId),
  ]);
  if (keeperResult.error) throw keeperResult.error;
  if (duplicateResult.error) throw duplicateResult.error;
  const keys = new Set(((keeperResult.data ?? []) as ChildRow[]).map(keyOf));
  let transferred = 0;
  for (const row of (duplicateResult.data ?? []) as ChildRow[]) {
    if (keys.has(keyOf(row))) {
      const { error } = await supabase.from(table).delete().eq("id", row.id);
      if (error) throw error;
      continue;
    }
    const { error } = await supabase.from(table).update({ car_id: keeperId, ...movePatch }).eq("id", row.id);
    if (error) throw error;
    keys.add(keyOf(row));
    transferred += 1;
  }
  return transferred;
}

async function transferRicherReports(
  supabase: SupabaseClient, keeperId: string, duplicateId: string,
) {
  const [keeperResult, duplicateResult] = await Promise.all([
    supabase.from("car_condition_reports").select("*").eq("car_id", keeperId),
    supabase.from("car_condition_reports").select("*").eq("car_id", duplicateId),
  ]);
  if (keeperResult.error) throw keeperResult.error;
  if (duplicateResult.error) throw duplicateResult.error;
  const keepers = new Map<string, ChildRow>();
  for (const row of (keeperResult.data ?? []) as ChildRow[]) keepers.set(`${row.source}|${row.report_type}`, row);
  let transferred = 0;
  for (const row of (duplicateResult.data ?? []) as ChildRow[]) {
    const key = `${row.source}|${row.report_type}`;
    const current = keepers.get(key);
    if (!current) {
      const { error } = await supabase.from("car_condition_reports").update({ car_id: keeperId }).eq("id", row.id);
      if (error) throw error;
      keepers.set(key, row);
      transferred += 1;
      continue;
    }
    const useDuplicate = JSON.stringify(row).length > JSON.stringify(current).length;
    const { error: deleteError } = await supabase.from("car_condition_reports").delete().eq("id", useDuplicate ? current.id : row.id);
    if (deleteError) throw deleteError;
    if (useDuplicate) {
      const { error: moveError } = await supabase.from("car_condition_reports").update({ car_id: keeperId }).eq("id", row.id);
      if (moveError) throw moveError;
      keepers.set(key, row);
      transferred += 1;
    }
  }
  return transferred;
}

async function moveAllRows(
  supabase: SupabaseClient, table: string,
  keeperId: string, duplicateId: string,
) {
  const { data, error } = await supabase.from(table).update({ car_id: keeperId })
    .eq("car_id", duplicateId).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

function summarize(groups: EncarDuplicateGroup[], deactivated: number, transferredRows: number, dryRun: boolean) {
  return {
    dryRun,
    groups: groups.length,
    candidates: groups.reduce((total, group) => total + group.duplicates.length, 0),
    byMatchType: {
      vin: groups.filter((group) => group.matchType === "vin").length,
      plate: groups.filter((group) => group.matchType === "plate").length,
    },
    deactivated,
    transferredRows,
    sample: groups.slice(0, 10).map((group) => ({
      matchType: group.matchType,
      keeperSourceId: group.keeper.source_id,
      duplicateSourceIds: group.duplicates.map((car) => car.source_id),
    })),
  };
}
