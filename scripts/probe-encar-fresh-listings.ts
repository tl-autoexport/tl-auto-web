import { config } from "dotenv";
import { fetch, ProxyAgent } from "undici";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";
import { normalizeFuel } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const proxy = process.env.ENCAR_PROXY_URL?.trim();
if (!proxy) throw new Error("ENCAR_PROXY_URL is required; direct Encar requests are disabled");
const agent = new ProxyAgent(proxy);
const pageSize = 50;
const pageCount = Math.max(1, Math.min(5, Number(process.env.ENCAR_PROBE_PAGES ?? 2)));
const bounds = {
  minYear: process.env.ENCAR_MIN_YEAR ?? "190001",
  maxYear: process.env.ENCAR_MAX_YEAR ?? "210012",
  minMileage: process.env.ENCAR_MIN_MILEAGE ?? "0",
  maxMileage: process.env.ENCAR_MAX_MILEAGE ?? "999999",
  minPrice: process.env.ENCAR_MIN_PRICE ?? "0",
  maxPrice: process.env.ENCAR_MAX_PRICE ?? "100000",
};
const fuelFilters: Record<string, string> = {
  gasoline: "가솔린",
  diesel: "디젤",
  lpg: "LPG",
};
const queryFor = (fuel: string) => encodeURIComponent(`(And.Hidden.N._.FuelType.${fuelFilters[fuel]}._.Year.range(${bounds.minYear}..${bounds.maxYear})._.Mileage.range(${bounds.minMileage}..${bounds.maxMileage})._.Price.range(${bounds.minPrice}..${bounds.maxPrice}).)`);
type Listing = { Id: number | string; Manufacturer?: string; Model?: string; Year?: string | number; FuelType?: string; Photos?: Array<{ updatedDate?: string }> };

async function main() {
  const grouped: Record<string, unknown> = {};
  for (const fuel of ["gasoline", "diesel", "lpg"]) {
    const rows: Listing[] = [];
    for (let page = 0; page < pageCount; page += 1) {
      const sort = encodeURIComponent(`|ModifiedDate|${page * pageSize}|${pageSize}`);
      const url = `https://api.encar.com/search/car/list/general?count=true&q=${queryFor(fuel)}&sr=${sort}`;
      const response = await fetch(url, { headers: ENCAR_HEADERS, dispatcher: agent, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Encar ${fuel} list HTTP ${response.status}`);
      const body = await response.json() as { SearchResults?: Listing[] };
      const batch = body.SearchResults ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
    grouped[fuel] = {
      rowsRead: rows.length,
      normalizedFuelCounts: rows.reduce<Record<string, number>>((counts, row) => {
        const type = normalizeFuel(row.FuelType) ?? "unknown";
        counts[type] = (counts[type] ?? 0) + 1;
        return counts;
      }, {}),
      newestSamples: rows.slice(0, 8).map((row) => ({
        id: String(row.Id), brand: row.Manufacturer ?? null, model: row.Model ?? null,
        year: row.Year ?? null, sourceFuel: row.FuelType ?? null,
        listedPhotoUpdatedAt: row.Photos?.[0]?.updatedDate ?? null,
      })),
    };
  }
  console.log(JSON.stringify({ readOnly: true, proxyUsed: true, sortCursor: "ModifiedDate", freshnessLimitation: "Publication timestamp requires detail.manage.firstAdvertisedDateTime; this probe only validates per-fuel list filters and samples.", pagesPerFuel: pageCount, perFuel: grouped }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => agent.close());
