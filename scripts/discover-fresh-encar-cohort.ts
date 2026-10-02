import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetch, ProxyAgent } from "undici";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";
import { normalizeFuel } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const proxy = process.env.ENCAR_PROXY_URL?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!proxy || !supabaseUrl || !serviceKey) throw new Error("ENCAR_PROXY_URL and Supabase service credentials are required");

const target = Math.max(1, Math.min(500, Number(process.env.ENCAR_FRESH_TARGET ?? 500)));
const pages = Math.max(1, Math.min(400, Number(process.env.ENCAR_FRESH_PAGES ?? 120)));
const detailConcurrency = 1;
const maxListingAgeDays = Math.max(1, Math.min(365, Number(process.env.ENCAR_FRESH_MAX_AGE_DAYS ?? 30)));
const outputPath = process.env.ENCAR_FRESH_OUTPUT ?? "output/encar-fresh-candidates.json";
const checkpointPath = process.env.ENCAR_FRESH_CHECKPOINT ?? "output/encar-fresh-checkpoint.json";
const requestDelayMs = Math.max(0, Math.min(5_000, Number(process.env.ENCAR_FRESH_REQUEST_DELAY_MS ?? 250)));
const fuels = new Set(["gasoline", "diesel", "lpg"]);
const agent = new ProxyAgent(proxy);
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pageSize = 50;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

type Listing = { Id: number | string; Manufacturer?: string; Model?: string; Year?: number | string; FuelType?: string };
type Candidate = { source: "encar"; sourceListingId: string; sourceUrl: string; brand: string | null; model: string | null; year: number | null; fuelType: string; firstAdvertisedAt: string; listedAt: string | null };
type Checkpoint = { version: 1; policy: string; listings: Listing[]; listPage: number; checkedIds: string[]; results: Candidate[]; errors: number };

async function saveCheckpoint(value: Checkpoint) {
  await mkdir("output", { recursive: true });
  const temp = `${checkpointPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`);
  await rename(temp, checkpointPath);
}

async function readCheckpoint(): Promise<Checkpoint | null> {
  try {
    const value = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
    if (value.version !== 1 || value.policy !== JSON.stringify({ target, pages, maxListingAgeDays, requestDelayMs }))
      throw new Error("Existing Encar freshness checkpoint does not match current settings; set ENCAR_FRESH_CHECKPOINT to a new path");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const checkpoint = await readCheckpoint();
  const candidates = new Map<string, Listing>((checkpoint?.listings ?? []).map((row) => [String(row.Id), row]));
  const fuelCounts: Record<string, number> = { gasoline: 0, diesel: 0, lpg: 0, other: 0 };
  const bounds = `(And.Hidden.N._.Year.range(190001..210012)._.Mileage.range(0..999999)._.Price.range(0..100000).)`;
  const state: Checkpoint = checkpoint ?? { version: 1, policy: JSON.stringify({ target, pages, maxListingAgeDays, requestDelayMs }), listings: [], listPage: 0, checkedIds: [], results: [], errors: 0 };
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
      if (fuels.has(fuel)) candidates.set(String(row.Id), row);
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
          const advertised = Date.parse(firstAdvertisedAt);
          const listingFuel = normalizeFuel(listing.FuelType);
          const detailFuel = normalizeFuel(obj(detail.spec).fuelName ?? listing.FuelType);
          if (firstAdvertisedAt && Number.isFinite(advertised) && Date.now() - advertised <= maxListingAgeDays * 86_400_000 &&
              fuels.has(detailFuel ?? "") && detailFuel === listingFuel && manage.dummy !== true && advert.salesStatus !== "CONTRACT") {
            detailResults.push({
              source: "encar", sourceListingId: id, sourceUrl: `https://fem.encar.com/cars/detail/${id}`,
              brand: listing.Manufacturer ?? null, model: listing.Model ?? null,
              year: Number(String(listing.Year ?? "").slice(0, 4)) || null,
              fuelType: detailFuel!, firstAdvertisedAt, listedAt: String(manage.registDateTime ?? "") || null,
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
  detailResults.sort((a, b) => Date.parse(b.firstAdvertisedAt) - Date.parse(a.firstAdvertisedAt));
  const selected = detailResults.slice(0, target);
  const counts = selected.reduce<Record<string, number>>((result, row) => { result[row.fuelType] = (result[row.fuelType] ?? 0) + 1; return result; }, {});
  const report = {
    generatedAt: new Date().toISOString(), mode: "read_only_discovery", target, selectedCount: selected.length,
    maxListingAgeDays, listSort: "ModifiedDate", sourcePublicationDate: "detail.manage.firstAdvertisedDateTime",
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
