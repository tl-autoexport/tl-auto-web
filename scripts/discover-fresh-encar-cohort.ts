import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetch, ProxyAgent } from "undici";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";
import { normalizeBrand, normalizeFuel, normalizeModel } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const proxy = process.env.ENCAR_PROXY_URL?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!proxy || !supabaseUrl || !serviceKey) throw new Error("ENCAR_PROXY_URL and Supabase service credentials are required");

const target = Math.max(1, Math.min(500, Number(process.env.ENCAR_FRESH_TARGET ?? 500)));
const pages = Math.max(1, Math.min(400, Number(process.env.ENCAR_FRESH_PAGES ?? 120)));
const maxListingAgeDays = Math.max(1, Math.min(365, Number(process.env.ENCAR_FRESH_MAX_AGE_DAYS ?? 30)));
const minVehicleYear = Math.max(1900, Math.min(2100, Number(process.env.ENCAR_FRESH_MIN_VEHICLE_YEAR ?? 2020)));
const outputPath = process.env.ENCAR_FRESH_OUTPUT ?? "output/encar-fresh-candidates.json";
const checkpointPath = process.env.ENCAR_FRESH_CHECKPOINT ?? "output/encar-fresh-checkpoint.json";
const requestDelayMs = Math.max(0, Math.min(5_000, Number(process.env.ENCAR_FRESH_REQUEST_DELAY_MS ?? 250)));
const fuels = new Set(["gasoline", "diesel", "lpg"]);
const agent = new ProxyAgent(proxy);
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pageSize = 50;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const parseEncarTimestamp = (value: string) => Date.parse(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value}+09:00` : value,
);

type Listing = { Id: number | string; Manufacturer?: string; Model?: string; Year?: number | string; FuelType?: string };
type Candidate = { source: "encar"; sourceListingId: string; sourceUrl: string; brand: string | null; model: string | null; year: number | null; fuelType: string; firstAdvertisedAt: string; listedAt: string | null; advertisementType: "NORMAL"; priorityModel: string | null; priorityModelRank: number | null };
type Checkpoint = { version: 1; policy: string; listings: Listing[]; listPage: number; checkedIds: string[]; results: Candidate[]; errors: number };
type PriorityDocument = { groups?: Array<{ manufacturer?: string; requestedModel?: string; sourceCount?: number }> };

const canonicalKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const vehicleYear = (value: unknown) => Number(String(value ?? "").slice(0, 4)) || null;

async function saveCheckpoint(value: Checkpoint) {
  await mkdir("output", { recursive: true });
  const temp = `${checkpointPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`);
  await rename(temp, checkpointPath);
}

async function readCheckpoint(policy: string): Promise<Checkpoint | null> {
  try {
    const value = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
    if (value.version !== 1 || value.policy !== policy)
      throw new Error("Existing Encar freshness checkpoint does not match current settings; set ENCAR_FRESH_CHECKPOINT to a new path");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const priorityDocument = JSON.parse(await readFile("docs/chestny-required-models-audit.json", "utf8")) as PriorityDocument;
  const priorityGroups = (priorityDocument.groups ?? [])
    .map((group) => ({
      brand: normalizeBrand(group.manufacturer),
      model: normalizeModel(group.requestedModel),
      sourceCount: Number(group.sourceCount ?? 0),
    }))
    .filter((group): group is { brand: string; model: string; sourceCount: number } => Boolean(group.brand && group.model))
    .sort((a, b) => b.sourceCount - a.sourceCount || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  const priorityRank = new Map(priorityGroups.map((group, index) => [`${canonicalKey(group.brand)}|${canonicalKey(group.model)}`, index + 1]));
  const policy = JSON.stringify({ target, pages, maxListingAgeDays, minVehicleYear, requestDelayMs, sourceTimestampTimezone: "Asia/Seoul", priorityModels: priorityGroups.map(({ brand, model }) => `${brand}:${model}`) });
  const checkpoint = await readCheckpoint(policy);
  const candidates = new Map<string, Listing>((checkpoint?.listings ?? []).map((row) => [String(row.Id), row]));
  const fuelCounts: Record<string, number> = { gasoline: 0, diesel: 0, lpg: 0, other: 0 };
  const bounds = `(And.Hidden.N._.Year.range(${minVehicleYear}01..210012)._.Mileage.range(0..999999)._.Price.range(0..100000).)`;
  const state: Checkpoint = checkpoint ?? { version: 1, policy, listings: [], listPage: 0, checkedIds: [], results: [], errors: 0 };
  for (let page = state.listPage; page < pages; page += 1) {
    const q = encodeURIComponent(bounds);
    const sr = encodeURIComponent(`|ModifiedDate|${page * pageSize}|${pageSize}`);
    const response = await fetch(`https://api.encar.com/search/car/list/general?count=true&q=${q}&sr=${sr}`, {
      headers: ENCAR_HEADERS, dispatcher: agent, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Encar list HTTP ${response.status} at page ${page + 1}`);
    const body = await response.json() as { SearchResults?: Listing[] };
    const rows = body.SearchResults ?? [];
    for (const row of rows) {
      const fuel = normalizeFuel(row.FuelType) ?? "other";
      fuelCounts[fuel in fuelCounts ? fuel : "other"] += 1;
      if (fuels.has(fuel) && (vehicleYear(row.Year) ?? 0) >= minVehicleYear) candidates.set(String(row.Id), row);
    }
    console.log(JSON.stringify({ event: "list_progress", page: page + 1, pages, rows: rows.length, uniqueEligible: candidates.size, fuelCounts }));
    state.listings = [...candidates.values()];
    state.listPage = page + 1;
    await saveCheckpoint(state);
    if (rows.length < pageSize) break;
    await delay(250);
  }

  const ids = [...candidates.keys()];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [cars, queue] = await Promise.all([
      db.from("cars").select("source_id").eq("primary_source", "encar").in("source_id", part),
      db.from("encar_enrichment_queue").select("source_listing_id").eq("source", "encar").in("source_listing_id", part),
    ]);
    if (cars.error || queue.error) throw new Error(cars.error?.message ?? queue.error?.message);
    for (const row of cars.data ?? []) known.add(String(row.source_id));
    for (const row of queue.data ?? []) known.add(String(row.source_listing_id));
  }
  const unseen = ids.filter((id) => !known.has(id));
  const completed = new Set(state.checkedIds);
  const pending = unseen.filter((id) => !completed.has(id));
  const detailResults = state.results;
  let cursor = 0;
  let completedSinceSave = 0;
  async function worker() {
    while (cursor < pending.length) {
      const id = pending[cursor++];
      const listing = candidates.get(id)!;
      let failed = false;
      try {
        const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${id}`, {
          headers: ENCAR_HEADERS, dispatcher: agent, signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) failed = true;
        else {
          const detail = obj(await response.json());
          const manage = obj(detail.manage);
          const advert = obj(detail.advertisement);
          const firstAdvertisedAt = String(manage.firstAdvertisedDateTime ?? "");
          const advertised = parseEncarTimestamp(firstAdvertisedAt);
          const listingFuel = normalizeFuel(listing.FuelType);
          const detailFuel = normalizeFuel(obj(detail.spec).fuelName ?? listing.FuelType);
          const year = vehicleYear(listing.Year);
          if (advert.advertisementType === "NORMAL" && firstAdvertisedAt && Number.isFinite(advertised) && advertised <= Date.now() && Date.now() - advertised <= maxListingAgeDays * 86_400_000 &&
              year !== null && year >= minVehicleYear &&
              fuels.has(detailFuel ?? "") && detailFuel === listingFuel && manage.dummy !== true && advert.salesStatus !== "CONTRACT") {
            const brand = normalizeBrand(listing.Manufacturer);
            const model = normalizeModel(listing.Model);
            const rank = priorityRank.get(`${canonicalKey(brand)}|${canonicalKey(model)}`) ?? null;
            detailResults.push({
              source: "encar", sourceListingId: id, sourceUrl: `https://fem.encar.com/cars/detail/${id}`,
              brand, model, year,
              fuelType: detailFuel!, firstAdvertisedAt, listedAt: String(manage.registDateTime ?? "") || null,
              advertisementType: "NORMAL",
              priorityModel: rank === null ? null : `${brand} ${model}`,
              priorityModelRank: rank,
            });
          }
        }
      } catch { failed = true; }
      finally {
        if (failed) state.errors += 1;
        state.checkedIds.push(id);
        completedSinceSave += 1;
        if (completedSinceSave >= 10) {
          state.results = detailResults;
          await saveCheckpoint(state);
          completedSinceSave = 0;
        }
        if (state.checkedIds.length % 10 === 0 || state.checkedIds.length === unseen.length)
          console.log(JSON.stringify({ event: "detail_progress", checked: state.checkedIds.length, total: unseen.length, validFresh: detailResults.length, errors: state.errors }));
        if (requestDelayMs) await delay(requestDelayMs);
      }
    }
  }
  await worker();
  state.results = detailResults;
  await saveCheckpoint(state);
  const prioritySorted = [...detailResults].sort((a, b) =>
    (a.priorityModelRank ?? Number.MAX_SAFE_INTEGER) - (b.priorityModelRank ?? Number.MAX_SAFE_INTEGER) ||
    parseEncarTimestamp(b.firstAdvertisedAt) - parseEncarTimestamp(a.firstAdvertisedAt),
  );
  const selected: Candidate[] = [];
  const selectedByModel: Record<string, number> = {};
  const selectedIds = new Set<string>();
  for (const row of prioritySorted) {
    if (row.priorityModelRank === null) continue;
    const modelKey = row.priorityModel ?? "";
    if ((selectedByModel[modelKey] ?? 0) >= 50) continue;
    selected.push(row);
    selectedIds.add(row.sourceListingId);
    selectedByModel[modelKey] = (selectedByModel[modelKey] ?? 0) + 1;
    if (selected.length >= target) break;
  }
  if (selected.length < target) {
    const fallback = [...detailResults]
      .filter((row) => !selectedIds.has(row.sourceListingId))
      .sort((a, b) => parseEncarTimestamp(b.firstAdvertisedAt) - parseEncarTimestamp(a.firstAdvertisedAt));
    selected.push(...fallback.slice(0, target - selected.length));
  }
  const counts = selected.reduce<Record<string, number>>((result, row) => { result[row.fuelType] = (result[row.fuelType] ?? 0) + 1; return result; }, {});
  const selectedPriorityModels = selected.reduce<Record<string, number>>((result, row) => {
    const key = row.priorityModel ?? "other";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const report = {
    generatedAt: new Date().toISOString(), mode: "read_only_discovery", target, selectedCount: selected.length,
    maxListingAgeDays, minVehicleYear, prioritySource: "docs/chestny-required-models-audit.json, ranked by sourceCount",
    priorityModelCount: priorityGroups.length, priorityModelPerModelCap: 50,
    selectedPriorityListings: selected.filter((row) => row.priorityModelRank !== null).length,
    selectedFallbackListings: selected.length - selected.filter((row) => row.priorityModelRank !== null).length, selectedPriorityModels,
    listSort: "ModifiedDate", sourcePublicationDate: "detail.manage.firstAdvertisedDateTime", sourceTimestampTimezone: "Asia/Seoul for timezone-naive values",
    listPagesRequested: pages, listCandidateIds: ids.length, alreadyInCatalogOrQueue: known.size,
    unseenChecked: state.checkedIds.length, recentActiveCandidateCount: detailResults.length, detailErrors: state.errors,
    selectedFuelCounts: counts, candidates: selected,
    limitation: selected.length < target ? "More list pages may be required; no staging run was created." : null,
  };
  await mkdir("output", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, candidates: undefined, outputPath }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => agent.close());
