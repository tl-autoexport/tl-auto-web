/** Read-only Encar list discovery for a curated 30+ year vehicle pilot. */
import { writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { importEncar } from "../src/server/imports/encar";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const pool = Number(process.env.TL_AUTO_CLASSIC_DISCOVERY_POOL ?? 1200);
const pages = Number(process.env.TL_AUTO_CLASSIC_DISCOVERY_MAX_PAGES ?? 220);
const output = process.env.TL_AUTO_CLASSIC_DISCOVERY_OUTPUT ??
  "output/tl-auto-classic-30plus-discovery.json";
const minYear = Number(process.env.TL_AUTO_CLASSIC_MIN_YEAR ?? 196001);
const maxYear = Number(process.env.TL_AUTO_CLASSIC_MAX_YEAR ?? 199608);
const maxListingAgeDays = Number(process.env.TL_AUTO_CLASSIC_MAX_LISTING_AGE_DAYS ?? 365);
const requestDelayMs = Number(process.env.TL_AUTO_CLASSIC_REQUEST_DELAY_MS ?? 900);
// Encar price values are in 10,000 KRW units. Classic listings can exceed the
// normal importer mileage ceiling and price band, so discovery uses broad bounds.
const minMileage = Number(process.env.TL_AUTO_CLASSIC_MIN_MILEAGE ?? 0);
const maxMileage = Number(process.env.TL_AUTO_CLASSIC_MAX_MILEAGE ?? 999999);
const minPrice = Number(process.env.TL_AUTO_CLASSIC_MIN_PRICE ?? 0);
const maxPrice = Number(process.env.TL_AUTO_CLASSIC_MAX_PRICE ?? 100000);
const brands = (process.env.TL_AUTO_CLASSIC_BRANDS ??
  "Mercedes-Benz,BMW,Volkswagen,Audi,Porsche,Lexus,Volvo,Maserati,Land Rover,재규어,벤틀리,롤스로이스,페라리,람보르기니,애스턴마틴")
  .split(",").map((value) => value.trim()).filter(Boolean);

async function main() {
  if (!Number.isInteger(pool) || pool < 1 || pool > 5000) throw new Error("Discovery pool must be 1..5000");
  if (!Number.isInteger(pages) || pages < 1 || pages > 500) throw new Error("Discovery max pages must be 1..500");
  if (!Number.isInteger(minYear) || !Number.isInteger(maxYear) || minYear < 190001 || maxYear > 210012 || minYear > maxYear)
    throw new Error("Classic discovery year bounds must be valid YYYYMM values with min <= max");
  if (!Number.isInteger(maxListingAgeDays) || maxListingAgeDays < 1 || maxListingAgeDays > 3650)
    throw new Error("Classic discovery max listing age must be 1..3650 days");
  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 60_000)
    throw new Error("Classic discovery request delay must be 0..60000 ms");
  if (![minMileage, maxMileage, minPrice, maxPrice].every(Number.isInteger) ||
      minMileage < 0 || maxMileage < minMileage || minPrice < 0 || maxPrice < minPrice)
    throw new Error("Classic discovery mileage/price bounds must be non-negative integers with min <= max");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new Error("Supabase URL and service key are required for read-only duplicate exclusion");
  process.env.ENCAR_LIST_REQUEST_DELAY_MS = String(requestDelayMs);

  const result = await importEncar({
    target: pool,
    maxPages: pages,
    minYear,
    maxYear,
    minMileage,
    maxMileage,
    minPrice,
    maxPrice,
    maxListingAgeDays,
    onlyNew: true,
    dryRun: true,
    fastMode: true,
    electricTarget: 0,
    electricPages: 0,
    hybridTarget: 0,
    hybridPages: 0,
    allowedBrands: brands,
    discoveryOnly: true,
  }) as {
    readOnly: boolean; discoveryOnly: boolean; databaseWrites: number; detailRequests: number;
    candidates: number; uniqueCandidates: number; existingCandidates: number; listPageErrors: unknown[];
    freshCandidates: number;
    candidateDrafts: Array<Record<string, unknown> & { sourceListingId: string; brand: string | null; model: string | null; year: number | null; fuelType: string | null }>;
  };
  if (!result.readOnly || !result.discoveryOnly || result.databaseWrites !== 0 || result.detailRequests !== 0)
    throw new Error("Discovery safety contract failed; no report written");

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids = [...new Set(result.candidateDrafts.map((row) => row.sourceListingId))];
  const queued = new Set<string>();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await db.from("encar_enrichment_queue")
      .select("source_listing_id").in("source_listing_id", ids.slice(start, start + 200));
    if (error) throw new Error(`Could not exclude historical Encar queue IDs: ${error.message}`);
    for (const row of data ?? []) queued.add(String(row.source_listing_id));
  }
  const fresh = result.candidateDrafts.filter((row) => !queued.has(row.sourceListingId));
  const groups = new Map<string, { brand: string; model: string; year: number; fuelType: string; count: number }>();
  for (const row of fresh) {
    const brand = row.brand ?? "unknown", model = row.model ?? "unknown";
    const year = Number(row.year) || 0, fuelType = row.fuelType ?? "unknown";
    const key = [brand, model, year, fuelType].join("|");
    const group = groups.get(key) ?? { brand, model, year, fuelType, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    policy: { manufactureYearMin: minYear,
      manufactureYearMonthMax: maxYear,
      brands, listingUpdatedWithinDays: null,
      freshnessFilter: "disabled for discovery; Encar Hidden.N list results are treated as active",
      minMileage, maxMileage, minPrice, maxPrice,
      priceUnit: "10,000 KRW",
      requestDelayMs,
      excludeExistingCatalogAndAnyPriorQueue: true },
    readOnly: true, databaseWrites: 0, EncarDetailRequests: 0,
    discovery: { listCandidates: result.candidates, uniqueCandidates: result.uniqueCandidates,
      freshCandidates: result.freshCandidates, returnedPool: result.candidateDrafts.length,
      alreadyQueuedExcluded: queued.size, neverQueued: fresh.length, configurations: groups.size,
      listPageErrors: result.listPageErrors.length },
    listPageErrors: result.listPageErrors,
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model)),
    candidates: fresh,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ ...report, groups: report.groups.slice(0, 40), candidates: undefined, output }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
