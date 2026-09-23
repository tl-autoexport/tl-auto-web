/**
 * Read-only AutoHome lookup for the unmatched configurations in the latest
 * new-Encar power plan. Output is a candidate dataset for the existing matcher;
 * this script does not write to Supabase or approve any evidence.
 */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const inputPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.AUTOHOME_NEW_ENCAR_OUTPUT ?? "output/tl-auto-new-encar-autohome.json";
const delayMs = Math.max(0, Number(process.env.AUTOHOME_DELAY_MS ?? 900));
const requestTimeoutMs = Math.max(1000, Number(process.env.AUTOHOME_TIMEOUT_MS ?? 15000));
const maxYear = new Date().getFullYear();

type PlanGroup = {
  brand: string | null;
  model: string | null;
  generation: string | null;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  driveType: string | null;
  listingIds: string[];
  badgeExamples: string[];
  sourceExamples?: unknown[];
};
type Spec = {
  name: string;
  year: number | string | null;
  engineGroup: string;
  powerHp: number | string | null;
  drive: string | null;
  fuel: string | null;
  transmission: string | null;
  specId: string | null;
};
type Payload = {
  result?: {
    specinfo?: {
      yearlist?: Array<{ yearname?: string; yearvalue?: number | string }>;
      speclist?: Array<{ yearspeclist?: Array<{ year?: number | string; name?: string; speclist?: Array<Record<string, unknown>> }> }>;
    };
  };
};

// IDs are AutoHome public series IDs. Mappings for the new-Encar worklist are
// conservative: do not map a renamed or closely-related model to another line.
const SERIES: Record<string, number> = {
  "Audi|A6": 18,
  "BMW|3 Series": 66,
  "BMW|5 Series": 65,
  "BMW|X3": 4658,
  "BMW|X5": 159,
  "BMW|X1": 2561,
  "BMW|X2": 3386,
  "Genesis|GV70": 5475,
  "Hyundai|Palisade": 5003,
  // Additional checked mappings from the existing AutoHome adapter/HARs.
  "BMW|1 Series": 4171,
  "BMW|2 Series": 3941,
  "MINI|Cooper": 209,
  "MINI|Countryman": 750,
  "MINI|Clubman": 749,
  "Audi|Q2": 3287,
  "Audi|Q3": 2951,
  "Audi|A4": 19,
  "Audi|A3": 3170,
  "Volkswagen|Golf": 871,
  "Volkswagen|Jetta": 16,
  "Chevrolet|Trax": 3335,
  "Chevrolet|Equinox": 4235,
  "Chevrolet|Malibu": 2313,
  "Land Rover|Discovery": 802,
  "Land Rover|Discovery Sport": 5536,
  "Land Rover|Range Rover Evoque": 3521,
  "Renault Korea|XM3": 5747,
  "Renault Korea|SM6": 4068,
  "Renault Korea|Captur": 5350,
  "KGM|TIBOLI": 4811,
  "Kia|Sorento": 281,
  "Kia|K5": 2246,
  "Kia|Canival": 284,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchJson(url: string): Promise<Payload> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`AutoHome HTTP ${response.status}`);
  return await response.json() as Payload;
}
const numericYear = (value: unknown) => {
  const match = String(value ?? "").match(/\d{4}/);
  const year = match ? Number(match[0]) : Number(value);
  return Number.isInteger(year) && year >= 2010 && year <= maxYear + 1 ? year : null;
};
const seriesKey = (group: PlanGroup) => `${group.brand}|${group.model}`;

function flatten(payload: Payload): Spec[] {
  const specs: Spec[] = [];
  for (const yearGroup of payload.result?.specinfo?.speclist ?? []) {
    for (const group of yearGroup.yearspeclist ?? []) {
      for (const raw of group.speclist ?? []) {
        specs.push({
          name: String(raw.name ?? ""),
          year: (raw.year as number | string | null | undefined) ?? group.year ?? null,
          engineGroup: String(group.name ?? ""),
          powerHp: (raw.mali as number | string | null | undefined) ?? null,
          drive: (raw.drivemodename as string | null | undefined) ?? null,
          fuel: (raw.fueltypedetail as string | null | undefined) ?? null,
          transmission: (raw.transmission as string | null | undefined) ?? null,
          specId: raw.id == null ? null : String(raw.id),
        });
      }
    }
  }
  return specs;
}

async function fetchYearList(seriesId: number): Promise<number[]> {
  const url = `https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=${seriesId}&tagid=1&tagname=&cityid=110100`;
  const payload = await fetchJson(url);
  return [...new Set((payload.result?.specinfo?.yearlist ?? [])
    .map((entry) => numericYear(entry.yearname ?? entry.yearvalue))
    .filter((year): year is number => year != null))].sort((a, b) => a - b);
}

async function fetchSpecs(seriesId: number, year: number): Promise<Spec[]> {
  const url = `https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=${seriesId}&tagid=${year}&tagname=${encodeURIComponent(`${year}款`)}&cityid=110100`;
  return flatten(await fetchJson(url));
}

async function fetchDisplacements(referenceSpecId: string): Promise<Map<string, number>> {
  const response = await fetch(`https://car.autohome.com.cn/config/spec/${encodeURIComponent(referenceSpecId)}.html`, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`AutoHome config HTTP ${response.status}`);
  const html = await response.text();
  const bySpecId = new Map<string, number>();
  const displacementRows = /"displaytype":0,"id":\d+,"name":"[^\"]*\(mL\)[^\"]*","valueitems":\[([\s\S]*?)\]\}/g;
  for (const section of html.matchAll(displacementRows)) {
    const values = /"specid":(\d+),"sublist":\[\],"value":"(\d+)"/g;
    for (const [, specId, cc] of section[1].matchAll(values)) {
      const displacement = Number(cc);
      if (displacement > 0) bySpecId.set(specId, displacement);
    }
  }
  return bySpecId;
}

async function main() {
  const plan = JSON.parse(await readFile(inputPath, "utf8")) as {
    runId: string;
    externalSearch: { worklist: PlanGroup[] };
  };
  const grouped = new Map<string, { seriesId: number; groups: PlanGroup[] }>();
  const unmapped: PlanGroup[] = [];
  for (const group of plan.externalSearch.worklist) {
    const id = SERIES[seriesKey(group)];
    if (!id) {
      unmapped.push(group);
      continue;
    }
    const entry = grouped.get(seriesKey(group)) ?? { seriesId: id, groups: [] };
    entry.groups.push(group);
    grouped.set(seriesKey(group), entry);
  }

  const series: Array<{ key: string; seriesId: number; groups: Array<Record<string, unknown>>; specs: Spec[]; requests: Array<Record<string, unknown>> }> = [];
  for (const [key, entry] of grouped) {
    const candidateYears = entry.groups.map((group) => group.year).filter((year): year is number => year != null);
    let availableYears: number[] = [];
    const requests: Array<Record<string, unknown>> = [];
    try {
      availableYears = await fetchYearList(entry.seriesId);
      requests.push({ kind: "year-list", ok: true, years: availableYears });
    } catch (error) {
      requests.push({ kind: "year-list", ok: false, error: String(error) });
    }
    const neededYears = new Set(candidateYears.flatMap((year) => [year - 2, year - 1, year, year + 1, year + 2]));
    const years = [...new Set([
      ...candidateYears,
      ...availableYears.filter((year) => neededYears.has(year)),
    ])]
      .filter((year) => year >= 2010 && year <= maxYear + 1)
      .sort((a, b) => a - b);
    const specs: Spec[] = [];
    for (const year of years) {
      try {
        const found = await fetchSpecs(entry.seriesId, year);
        specs.push(...found);
        requests.push({ kind: "specs", year, ok: true, count: found.length });
      } catch (error) {
        requests.push({ kind: "specs", year, ok: false, error: String(error) });
      }
      await sleep(delayMs);
    }
    let displacements = new Map<string, number>();
    const referenceSpecId = specs.find((spec) => spec.specId)?.specId;
    if (referenceSpecId) {
      try {
        displacements = await fetchDisplacements(referenceSpecId);
        requests.push({ kind: "displacements", referenceSpecId, ok: true, specCount: displacements.size });
      } catch (error) {
        requests.push({ kind: "displacements", referenceSpecId, ok: false, error: String(error) });
      }
    } else {
      requests.push({ kind: "displacements", ok: false, error: "No specification ID available" });
    }
    const uniqueSpecs = [...new Map(specs.map((spec) => {
      const displacement = spec.specId ? displacements.get(spec.specId) : null;
      return [spec.specId ?? `${spec.year}|${spec.name}`, {
        ...spec,
          engineGroup: displacement ? `${displacement}cc` : spec.engineGroup,
        fuel: spec.fuel,
      }];
    })).values()];
    series.push({
      key,
      seriesId: entry.seriesId,
      groups: entry.groups.map((group) => ({
        manufacturer: group.brand,
        model: group.model,
        generation: group.generation,
        model_year: group.year,
        engine_cc: group.engineCc,
        fuel_type: group.fuelType,
        drive_type: group.driveType,
        trim: group.badgeExamples.join(" / ") || null,
        cards: group.listingIds.length,
        source_listing_ids: group.listingIds,
        source_examples: group.sourceExamples ?? [],
      })),
      specs: uniqueSpecs,
      requests,
    });
    console.log(`${key}: ${uniqueSpecs.length} AutoHome specs across ${years.length} years`);
  }

  await mkdir("output", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    runId: plan.runId,
    readOnly: true,
    databaseWrites: 0,
    policy: "AutoHome candidate data only; all power matches require review and approved evidence",
    mappedConfigurations: [...grouped.values()].reduce((count, item) => count + item.groups.length, 0),
    unmappedConfigurations: unmapped.length,
    series,
    unmapped,
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    runId: plan.runId,
    readOnly: true,
    databaseWrites: 0,
    mappedConfigurations: [...grouped.values()].reduce((count, item) => count + item.groups.length, 0),
    unmappedConfigurations: unmapped.length,
    seriesRequested: series.length,
    seriesWithSpecs: series.filter((item) => item.specs.length > 0).length,
    candidateSpecs: series.reduce((sum, item) => sum + item.specs.length, 0),
    output: outputPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
