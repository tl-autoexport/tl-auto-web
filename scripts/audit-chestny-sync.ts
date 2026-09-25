/**
 * Read-only reconciliation between TL Auto cards and the live Chestny database.
 *
 * Two different joins, deliberately kept apart:
 *   * TL card  <-> Chestny row      by `source_listing_id` (the identity key);
 *   * TL card  <-> Encar listing    by the Encar listing id, which must be stored
 *                                   as its own identifier, never inferred.
 *
 * This audit answers, without contacting Encar:
 *   * which source statuses and `is_public` values the active TL cards have;
 *   * whether `is_public=false` really coincides with the Encar-side gaps (the
 *     earlier hypothesis, which must be measured, not assumed);
 *   * which Chestny fields disagree with TL (VIN, mileage, engine, transmission,
 *     drive, colour, model year), after light normalization;
 *   * what the shared Chestny tables offer for storing the Encar identifier.
 *
 * It never writes to either database and never calls Encar.
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const chestnyUrl = process.env.CHESTNY_SUPABASE_URL?.replace(/\/$/, "");
const chestnyKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!chestnyUrl || !chestnyKey) throw new Error("Chestny credentials are required");

type Row = Record<string, unknown>;
type TlCar = {
  id: string; source_id: string; brand: string | null; model: string | null; year: number | null;
  engine_cc: number | null; transmission: string | null; drive_type: string | null; color: string | null;
  mileage_km: number | null; vin_masked: string | null; no_plate_hash: boolean;
  no_options: boolean; no_encar_photo: boolean; no_meaningful_report: boolean; no_history: boolean;
};

const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-zа-я0-9]+/gi, "");

/**
 * Content, not presence. Chestny stores `report_status = 'ready'` together with an
 * empty options list, and an empty array satisfies a naive `Boolean(...)` check, so
 * every block is judged by whether it actually carries data.
 */
function hasContent(value: unknown, depth = 0): boolean {
  if (value == null || depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasContent(item, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasContent(item, depth + 1));
  }
  return false;
}

/** Coarse shape label, so "empty" and "missing" are never conflated with "filled". */
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return value.length === 0 ? "empty_array" : `array[${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 0 ? "empty_object" : `object{${keys.length}}`;
  }
  if (typeof value === "string") return value.trim() ? "string" : "empty_string";
  return typeof value;
}

async function chestnyPage(table: string, select: string, filter: string, offset: number, size: number): Promise<Row[]> {
  const url = `${chestnyUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filter}&limit=${size}&offset=${offset}`;
  const response = await fetch(url, {
    headers: { apikey: chestnyKey!, Authorization: `Bearer ${chestnyKey}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Chestny ${table} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows as Row[] : [];
}

async function chestnyIn(table: string, select: string, column: string, ids: string[], pageSize = 1000): Promise<Row[]> {
  const out: Row[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const filter = `${column}=in.(${chunk.map((id) => `"${id}"`).join(",")})`;
    for (let offset = 0; ; offset += pageSize) {
      const page = await chestnyPage(table, select, filter, offset, pageSize);
      out.push(...page);
      if (page.length < pageSize) break;
    }
  }
  return out;
}

function bump(map: Record<string, number>, key: string) { map[key] = (map[key] ?? 0) + 1; }

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const tlCars = (await db.query<TlCar>(`
      select c.id, c.source_id, c.brand, c.model, c.year, c.engine_cc, c.transmission, c.drive_type, c.color,
             c.mileage_km, c.vin_masked,
             (c.vehicle_no_hash is null) as no_plate_hash,
             (not exists (select 1 from public.car_options o where o.car_id = c.id)) as no_options,
             (not exists (select 1 from public.car_media m where m.car_id = c.id and m.source = 'encar')) as no_encar_photo,
             (not exists (select 1 from public.car_condition_reports r
                          where r.car_id = c.id and r.items is not null and r.items <> '[]'::jsonb)) as no_meaningful_report,
             (c.accident_count is null and c.insurance_payout_count is null) as no_history
      from public.cars c
      where c.is_available and c.primary_source = 'chestny_prigon'
      order by c.source_id`)).rows;
    await db.query("rollback");

    const ids = tlCars.map((car) => car.source_id);
    const vehicles = await chestnyIn("vehicles",
      "source_listing_id,status,is_public,vin_masked,mileage_km,engine_cc,transmission,drive_type,exterior_color,model_year,removed_at,revalidation_miss_count,last_checked_at",
      "source_listing_id", ids);
    const catalog = await chestnyIn("catalog_vehicles",
      "source_listing_id,image_urls,report_status,report_options,inspection_summary,accident_summary,report_fetched_at",
      "source_listing_id", ids);

    const bySourceId = new Map(vehicles.map((row) => [String(row.source_listing_id), row]));
    const catalogBySourceId = new Map(catalog.map((row) => [String(row.source_listing_id), row]));
    const identifierTypes: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await chestnyPage("vehicle_source_identifiers", "identifier_type", "select=identifier_type", offset, 1000);
      identifierTypes.push(...page);
      if (page.length < 1000) break;
    }

    const groups: Record<string, { cars: number; noOptions: number; noEncarPhoto: number; noReport: number; noPlateHash: number; chestnyWithImages: number; chestnyWithReport: number; chestnyWithOptions: number }> = {};
    const mismatches = { vinMissingInChestny: 0, vinDiffers: 0, vinCompared: 0, mileageDiffers: 0, engineDiffers: 0, transmissionDiffers: 0, driveDiffers: 0, colorDiffers: 0, modelYearDiffers: 0, notFoundInChestny: 0 };
    const removed: Row[] = [];
    const shapes: Record<string, Record<string, number>> = { reportOptions: {}, inspectionSummary: {}, accidentSummary: {}, reportStatus: {} };
    const gapPotential = {
      noOptions: { candidates: 0, viaReportOptions: 0, viaStandardOptionCodes: 0, noOptionDataAnywhere: 0 },
      noReport: { candidates: 0, withChecks: 0, withBodyFindings: 0, withStructuredContent: 0, summaryOnlyNoStructure: 0 },
      noHistory: { candidates: 0, availableFlagTrue: 0, withCountersOrEvents: 0 },
      noEncarPhoto: { candidates: 0, chestnyGalleryAvailable: 0 },
    };
    let readyWithEmptyOptions = 0;
    const isPublicStats: Record<string, { cars: number; withImages: number; withReport: number; withVin: number }> = {};

    for (const car of tlCars) {
      const vehicle = bySourceId.get(car.source_id);
      const meta = catalogBySourceId.get(car.source_id);
      const status = vehicle ? String(vehicle.status ?? "<null>") : "not_in_chestny";
      const isPublic = vehicle ? String(vehicle.is_public ?? "<null>") : "<no row>";
      const groupKey = `${status} / is_public=${isPublic}`;
      const group = groups[groupKey] ?? (groups[groupKey] = { cars: 0, noOptions: 0, noEncarPhoto: 0, noReport: 0, noPlateHash: 0, chestnyWithImages: 0, chestnyWithReport: 0, chestnyWithOptions: 0 });
      group.cars++;
      if (car.no_options) group.noOptions++;
      if (car.no_encar_photo) group.noEncarPhoto++;
      if (car.no_meaningful_report) group.noReport++;
      if (car.no_plate_hash) group.noPlateHash++;

      const images = Array.isArray(meta?.image_urls) ? (meta!.image_urls as unknown[]).length : 0;
      const hasOptions = hasContent(meta?.report_options);
      const hasInspection = hasContent(meta?.inspection_summary) || hasContent(meta?.accident_summary);
      const hasReport = hasInspection;
      if (images > 0) group.chestnyWithImages++;
      if (hasReport) group.chestnyWithReport++;
      if (hasOptions) group.chestnyWithOptions++;

      const publicStat = isPublicStats[isPublic] ?? (isPublicStats[isPublic] = { cars: 0, withImages: 0, withReport: 0, withVin: 0 });
      publicStat.cars++;
      if (images > 0) publicStat.withImages++;
      if (hasReport) publicStat.withReport++;
      if (vehicle?.vin_masked) publicStat.withVin++;

      // How much of the reported gap is actually transferable, block by block.
      // Chestny carries two independent option sources and a full accident/insurance
      // summary, so each is measured separately instead of trusting one field.
      const summary = (meta?.inspection_summary ?? {}) as Record<string, unknown>;
      const accident = (meta?.accident_summary ?? {}) as Record<string, unknown>;
      const codes = Array.isArray(summary.standardOptionCodes) ? summary.standardOptionCodes.length : 0;
      const checks = Array.isArray(summary.checks) ? summary.checks.length : 0;
      const findings = Array.isArray(summary.bodyFindings) ? summary.bodyFindings.length : 0;
      const events = Array.isArray(accident.insuranceEvents) ? accident.insuranceEvents.length : 0;
      const counters = ["accidentCount", "loanCount", "theftCount", "totalLossCount", "ownAccidentCount",
        "ownerChangeCount", "floodPartLossCount", "floodTotalLossCount", "otherAccidentCount"]
        .reduce((sum, keyValue) => sum + Number(accident[keyValue] ?? 0), 0);
      if (isPublic === "true") {
        if (car.no_options) {
          gapPotential.noOptions.candidates++;
          if (hasOptions) gapPotential.noOptions.viaReportOptions++;
          if (codes > 0) gapPotential.noOptions.viaStandardOptionCodes++;
          if (!hasOptions && codes === 0) gapPotential.noOptions.noOptionDataAnywhere++;
        }
        if (car.no_meaningful_report) {
          gapPotential.noReport.candidates++;
          if (checks > 0) gapPotential.noReport.withChecks++;
          if (findings > 0) gapPotential.noReport.withBodyFindings++;
          if (checks > 0 || findings > 0) gapPotential.noReport.withStructuredContent++;
          if (checks === 0 && findings === 0) gapPotential.noReport.summaryOnlyNoStructure++;
        }
        if (car.no_history) {
          gapPotential.noHistory.candidates++;
          if (accident.available === true) gapPotential.noHistory.availableFlagTrue++;
          if (counters > 0 || events > 0) gapPotential.noHistory.withCountersOrEvents++;
        }
        if (car.no_encar_photo) {
          gapPotential.noEncarPhoto.candidates++;
          if (images > 0) gapPotential.noEncarPhoto.chestnyGalleryAvailable++;
        }
      }
      bump(shapes.reportOptions, shapeOf(meta?.report_options));
      bump(shapes.inspectionSummary, shapeOf(meta?.inspection_summary));
      bump(shapes.accidentSummary, shapeOf(meta?.accident_summary));
      bump(shapes.reportStatus, shapeOf(meta?.report_status));
      if (String(meta?.report_status ?? "") === "ready" && !hasOptions) readyWithEmptyOptions++;

      if (!vehicle) { mismatches.notFoundInChestny++; continue; }
      if (String(vehicle.removed_at ?? "")) removed.push({ sourceId: car.source_id, brand: car.brand, model: car.model, status, isPublic, removedAt: vehicle.removed_at, misses: vehicle.revalidation_miss_count, lastChecked: vehicle.last_checked_at });
      if (vehicle.vin_masked) {
        mismatches.vinCompared++;
        if (car.vin_masked && norm(car.vin_masked) !== norm(vehicle.vin_masked)) mismatches.vinDiffers++;
      } else mismatches.vinMissingInChestny++;
      if (car.mileage_km != null && vehicle.mileage_km != null && Number(car.mileage_km) !== Number(vehicle.mileage_km)) mismatches.mileageDiffers++;
      if (car.engine_cc != null && vehicle.engine_cc != null && Number(car.engine_cc) !== Number(vehicle.engine_cc)) mismatches.engineDiffers++;
      if (car.transmission && vehicle.transmission && norm(car.transmission) !== norm(vehicle.transmission)) mismatches.transmissionDiffers++;
      if (car.drive_type && vehicle.drive_type && norm(car.drive_type) !== norm(vehicle.drive_type)) mismatches.driveDiffers++;
      if (car.color && vehicle.exterior_color && norm(car.color) !== norm(vehicle.exterior_color)) mismatches.colorDiffers++;
      if (car.year != null && vehicle.model_year != null && Number(car.year) !== Number(vehicle.model_year)) mismatches.modelYearDiffers++;
    }

    const identifierHistogram: Record<string, number> = {};
    for (const row of identifierTypes) bump(identifierHistogram, String(row.identifier_type ?? "<null>"));

    console.log(JSON.stringify({
      readOnly: true,
      chestnyWrites: 0,
      tlWrites: 0,
      encarRequests: 0,
      tlActiveChestnyCars: tlCars.length,
      chestnyRowsFetched: vehicles.length,
      groups,
      publicFlagSignal: isPublicStats,
      chestnyBlockShapes: shapes,
      gapPotentialPublicCards: { ...gapPotential, reportStatusReadyButOptionsEmpty: readyWithEmptyOptions },
      fieldMismatches: mismatches,
      removedCards: removed,
      chestnyIdentifierTypes: identifierHistogram,
    }, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
