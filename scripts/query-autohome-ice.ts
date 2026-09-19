import { Client } from "pg";
import { config } from "dotenv";
import fs from "node:fs/promises";

config({ path: ".env.local", override: true, quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const output = process.env.AUTOHOME_OUTPUT ?? "/tmp/tl-auto-autohome-ice.json";
const delayMs = Number(process.env.AUTOHOME_DELAY_MS ?? 1800);

type Group = {
  manufacturer: string; model: string; generation: string | null; trim: string | null;
  model_year: number | null; engine_cc: number | null; fuel_type: string | null;
  drive_type: string | null; cards: number;
};

// AutoHome's public series IDs, sourced from the checked-in HAR captures supplied
// by the project owner. We never query Encar here.
const SERIES: Record<string, number> = {
  "Mercedes-Benz|C-Class": 588, "Mercedes-Benz|A-Class": 4764, "Mercedes-Benz|GLB-Class": 5348,
  "BMW|1-Series": 4171, "BMW|2-Series": 3941, "BMW|X1": 2561, "BMW|X2 (F39)": 3386,
  "MINI|Cooper": 209, "MINI|Countryman": 750, "MINI|Clubman": 749,
  "Audi|Q2": 3287, "Audi|Q3": 2951, "Audi|A4": 19, "Audi|A3": 3170,
  "Volkswagen|Golf": 871, "Volkswagen|Jetta": 16,
  "Chevrolet|Trax": 3335, "Chevrolet|Equinox": 4235, "Chevrolet|Malibu": 2313,
  "Land Rover|Discovery": 802, "Land Rover|Discovery Sport": 5536, "Land Rover|Range Rover Evoque": 3521,
  "Renault Korea|XM3": 5747, "Renault Korea|SM6": 4068, "Renault Korea|Captur": 5350,
  "KGM|TIBOLI": 4811, "Kia|Sorento": 281, "Kia|K5": 2246, "Kia|Canival": 284,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The AutoHome specification payload is external and untyped. The shapes below
// describe only the fields this script reads, so no `any` is needed.
type AutoHomeRawSpec = { name?: string; year?: number | string | null; mali?: number | string | null; drivemodename?: string | null; fueltypedetail?: string | null; transmission?: string | null; id?: number | string | null };
type SpeclistGroup = { year?: number | string | null; name?: string | null; speclist?: AutoHomeRawSpec[] };
type SpeclistYear = { yearspeclist?: SpeclistGroup[] };
type YearListEntry = { yearname?: string; yearvalue?: number | string | null };
type AutoHomePayload = { result?: { specinfo?: { speclist?: SpeclistYear[]; yearlist?: YearListEntry[] } } };
type FlatSpec = { seriesYear: unknown; name: unknown; year: unknown; engineGroup: unknown; powerHp: unknown; drive: unknown; fuel: unknown; transmission: unknown; specId: unknown };
type RequestLog = { year: number; ok: boolean; count?: number; error?: string; elapsedMs: number };
type SeriesResult = { key: string; seriesId: number; groups: Group[]; specs: FlatSpec[]; requests: RequestLog[]; ok: boolean };

function flattenSpecs(payload: AutoHomePayload) {
  const out: FlatSpec[] = [];
  for (const year of payload?.result?.specinfo?.speclist ?? []) {
    for (const group of year?.yearspeclist ?? []) {
      for (const spec of group?.speclist ?? []) {
        out.push({
          seriesYear: group.year,
          name: spec.name,
          year: spec.year,
          engineGroup: group.name,
          powerHp: spec.mali ?? null,
          drive: spec.drivemodename ?? null,
          fuel: spec.fueltypedetail ?? null,
          transmission: spec.transmission ?? null,
          specId: spec.id,
        });
      }
    }
  }
  return out;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows } = await db.query<Group>(`
    select s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type,
           count(*)::int as cards
    from public.chestny_catalog_staging s
    join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id
      and q.run_id=$1 and q.status='succeeded'
    where s.source_status='active' and s.promotion_status='auto_candidate'
      and s.fuel_type in ('가솔린','디젤')
    group by s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type
    order by cards desc`, [runId]);
  await db.end();

  const series = new Map<string, { seriesId: number; groups: Group[] }>();
  const missing: Group[] = [];
  for (const g of rows) {
    const id = SERIES[`${g.manufacturer}|${g.model}`];
    if (!id) missing.push(g);
    else {
      const key = `${g.manufacturer}|${g.model}|${id}`;
      const entry = series.get(key) ?? { seriesId: id, groups: [] };
      entry.groups.push(g); series.set(key, entry);
    }
  }

  const results: SeriesResult[] = [];
  for (const [key, item] of series) {
    const candidateYears = [...new Set(item.groups.map((g) => g.model_year).filter((y): y is number => Number.isFinite(y)))];
    const availableYears = new Set<number>();
    try {
      const base = await fetch(`https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=${item.seriesId}&tagid=1&tagname=&cityid=110100`, { headers: { accept: "application/json" } });
      const basePayload = JSON.parse(await base.text());
      for (const y of basePayload?.result?.specinfo?.yearlist ?? []) {
        const value = Number(y.yearname?.match(/\d{4}/)?.[0] ?? y.yearvalue);
        if (value >= 2016 && value <= 2026) availableYears.add(value);
      }
    } catch { /* individual series is handled by the year requests below */ }
    const years = [...new Set([...candidateYears, ...availableYears].filter((y) => y >= 2016 && y <= 2026))].sort();
    const specs: FlatSpec[] = [];
    const requests: RequestLog[] = [];
    for (const year of years) {
      const url = `https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=${item.seriesId}&tagid=${year}&tagname=${encodeURIComponent(`${year}款`)}&cityid=110100`;
      const started = Date.now();
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = JSON.parse(text);
        const yearSpecs = flattenSpecs(payload);
        specs.push(...yearSpecs);
        requests.push({ year, ok: true, count: yearSpecs.length, elapsedMs: Date.now() - started });
      } catch (error) {
        requests.push({ year, ok: false, error: String(error), elapsedMs: Date.now() - started });
      }
      await sleep(delayMs);
    }
    const uniqueSpecs = [...new Map(specs.map((s) => [s.specId, s])).values()];
    results.push({ key, seriesId: item.seriesId, groups: item.groups, specs: uniqueSpecs, requests, ok: requests.some((r) => r.ok) });
    console.log(`OK ${key}: ${uniqueSpecs.length} historical specs across ${years.length} years, ${item.groups.reduce((n, g) => n + g.cards, 0)} cards`);
  }

  await fs.writeFile(output, JSON.stringify({ runId, requestedCards: rows.reduce((n, g) => n + g.cards, 0), uniqueGroups: rows.length, series: results, missing }, null, 2));
  console.log(JSON.stringify({ requestedCards: rows.reduce((n, g) => n + g.cards, 0), uniqueGroups: rows.length, seriesRequested: results.length, seriesSucceeded: results.filter((r) => r.ok).length, missingGroups: missing.length, output }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
