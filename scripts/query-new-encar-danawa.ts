/**
 * Read-only Danawa ICE/LPG specification lookup for an Encar power plan.
 * It captures Danawa's model/year/lineup pages and only proposes a power when
 * displacement, fuel, year and known drive type are compatible. It never
 * writes to Supabase or changes a power reference.
 */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Group = {
  brand: string | null;
  model: string | null;
  generation: string | null;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  driveType: string | null;
  listingIds: string[];
  badgeExamples: string[];
  sourceExamples?: Array<Record<string, unknown>>;
};
type SearchHit = { modelId: string; label: string; url: string };
type Lineup = { modelYear: number; lineupId: string; label: string; url: string };
type SpecVariant = {
  trim: string | null;
  engineCc: number | null;
  powerPs: number | null;
  fuelType: string | null;
  driveType: string | null;
  transmission: string | null;
};
type ParsedLineup = { lineup: Lineup; modelTitle: string | null; variants: SpecVariant[]; error?: string };

const runIdExpected = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
const inputPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.DANAWA_POWER_OUTPUT ?? (runIdExpected
  ? `output/tl-auto-run-${runIdExpected}-danawa-power.json`
  : "output/tl-auto-new-encar-danawa-power.json");
const timeoutMs = Math.max(5000, Number(process.env.DANAWA_TIMEOUT_MS ?? 10000));
const delayMs = Math.max(250, Number(process.env.DANAWA_DELAY_MS ?? 500));
const yearWindow = Math.max(0, Math.min(2, Number(process.env.DANAWA_YEAR_WINDOW ?? 1)));
const ccTolerance = Math.max(0, Number(process.env.DANAWA_ENGINE_CC_TOLERANCE ?? 120));
const limit = Math.max(1, Number(process.env.DANAWA_LIMIT ?? 1000));

const BRAND_KO: Record<string, string[]> = {
  Hyundai: ["현대"], Kia: ["기아"], Genesis: ["제네시스"], Chevrolet: ["쉐보레", "한국GM"],
  KG_Mobility_Ssangyong: ["KG모빌리티", "쌍용"], KGM: ["KG모빌리티", "쌍용"],
  "Renault Korea": ["르노코리아", "르노삼성"], Audi: ["아우디"], BMW: ["BMW", "비엠더블유"],
  "Mercedes-Benz": ["벤츠", "메르세데스"], Volkswagen: ["폭스바겐"], MINI: ["미니"],
  Volvo: ["볼보"], Porsche: ["포르쉐"], Toyota: ["토요타"], Honda: ["혼다"],
  Ford: ["포드"], Jeep: ["지프"], Lexus: ["렉서스"], "Land Rover": ["랜드로버"],
};

const MODEL_KO: Record<string, string[]> = {
  "Chevrolet|Trax": ["트랙스", "트랙스 크로스오버"],
  "Hyundai|Elantra": ["아반떼"], "Hyundai|Santa Fe": ["싼타페"], "Hyundai|Santafe": ["싼타페"],
  "Hyundai|Tucson": ["투싼"], "Hyundai|Sonata": ["쏘나타"], "Hyundai|Grandeur": ["그랜저"],
  "Hyundai|Palisade": ["팰리세이드"], "Hyundai|Staria": ["스타리아"], "Hyundai|Starex": ["그랜드 스타렉스"],
  "Hyundai|Kona": ["코나"], "Hyundai|Venue": ["베뉴"], "Hyundai|Avante": ["아반떼"],
  "Kia|Sorento": ["쏘렌토"], "Kia|Sportage": ["스포티지"], "Kia|Carnival": ["카니발"],
  "Kia|Canival": ["카니발"], "Kia|K5": ["K5"], "Kia|K7": ["K7"], "Kia|K8": ["K8"],
  "Kia|K9": ["K9"], "Kia|Ray": ["레이"], "Kia|Morning": ["모닝"], "Kia|Soul": ["쏘울"],
  "Genesis|GV70": ["GV70"], "Genesis|GV80": ["GV80"], "Genesis|G70": ["G70"],
  "Genesis|G80": ["G80"], "Genesis|G90": ["G90"],
  "KG_Mobility_Ssangyong|Tivoli": ["티볼리"], "KGM|Tivoli": ["티볼리"],
  "KG_Mobility_Ssangyong|Rexton": ["렉스턴"], "KG_Mobility_Ssangyong|Torres": ["토레스"],
  "KG_Mobility_Ssangyong|Korando": ["코란도"], "KG_Mobility_Ssangyong|Musso": ["무쏘"],
  "Renault Korea|XM3": ["XM3"], "Renault Korea|SM6": ["SM6"], "Renault Korea|QM6": ["QM6"],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (value: string) => value
  .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
const cleanHtml = (value: string) => decode(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ").trim();
const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

function brandAliases(group: Group): string[] {
  const aliases = BRAND_KO[group.brand ?? ""] ?? [];
  return [...aliases, ...(group.brand ? [group.brand.replace(/_/g, " ")] : [])].map(norm).filter(Boolean);
}

function modelQueries(group: Group): string[] {
  const source = (group.sourceExamples ?? []).flatMap((example) => [example.detailModel, example.detailModelGroup])
    .map((value) => String(value ?? "").trim()).filter(Boolean);
  const cleaned = source.map((value) => value
    .replace(/\([^)]*\)/g, " ").replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/^(?:더\s*뉴|올\s*뉴|뉴|디\s*올\s*뉴)\s*/i, "").replace(/\s+/g, " ").trim());
  const local = MODEL_KO[`${group.brand}|${group.model}`] ?? [];
  const values = [...source, ...cleaned, ...local, group.model ?? ""];
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 2))];
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; TL-Auto Danawa specification reader/1.0)",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7", accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (response.status === 403 || response.status === 429) throw new Error(`Danawa rate/protection response HTTP ${response.status}; stopped without bypass`);
  if (!response.ok) throw new Error(`Danawa HTTP ${response.status}`);
  if (/자동입력 방지|비정상적인 접근|보안문자|captcha/i.test(body.slice(0, 12000))) throw new Error("Danawa returned a verification page; stopped without bypass");
  return body;
}

function parseSearchHits(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const anchorPattern = /<a\b([^>]*href\s*=\s*(["'])([^"']*\bModel=(\d+)[^"']*)\2[^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decode(match[3]);
    if (!/Work=model/i.test(href)) continue;
    const label = cleanHtml(match[5]);
    if (!label) continue;
    const url = new URL(href, "https://auto.danawa.com").toString();
    if (!hits.some((hit) => hit.modelId === match[4])) hits.push({ modelId: match[4], label, url });
  }
  return hits;
}

function brandFits(group: Group, label: string): boolean {
  const labelKey = norm(label);
  const aliases = brandAliases(group);
  if (!aliases.length) return false;
  return aliases.some((alias) => labelKey.includes(alias) || alias.includes(labelKey));
}

function parseLineups(html: string, modelId: string): { title: string | null; lineups: Lineup[] } {
  const titleMatch = html.match(/<h2\s+class=['"]name['"][^>]*>([\s\S]*?)<\/h2>/i);
  const title = titleMatch ? cleanHtml(titleMatch[1]) : null;
  const headers = [...html.matchAll(/<h4\s+class=['"]title['"][^>]*>\s*((?:19|20)\d{2})년형\s*<\/h4>/gi)];
  const lineups: Lineup[] = [];
  for (let index = 0; index < headers.length; index++) {
    const start = headers[index].index! + headers[index][0].length;
    const end = headers[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const pattern = /<input\b[^>]*data-model=['"](\d+)['"][^>]*data-lineup=['"](\d+)['"][^>]*>/gi;
    for (const input of block.matchAll(pattern)) {
      if (input[1] !== modelId) continue;
      const tail = block.slice(input.index!);
      const next = tail.slice(input[0].length).search(/<input\b[^>]*data-lineup=/i);
      const choice = next < 0 ? tail : tail.slice(0, input[0].length + next);
      const labelMatch = choice.match(/<label\b[^>]*>\s*([\s\S]*?)\s*<\/label>/i);
      const label = labelMatch ? cleanHtml(labelMatch[1]) : "";
      if (!label) continue;
      const url = `https://auto.danawa.com/auto/?Work=model&Model=${modelId}&Tab=spec&Lineup=${input[2]}`;
      lineups.push({ modelYear: Number(headers[index][1]), lineupId: input[2], label, url });
    }
  }
  return { title, lineups };
}

function parsePower(value: string): number | null {
  // Danawa writes engine output and its rpm range as `381/5,800~6,100 ps/rpm`.
  // The output is the number before `/`; reading the final number before `ps`
  // would mistake the rev limiter for horsepower.
  const text = value.trim();
  const match = text.match(/^([\d,]+(?:\.\d+)?)\s*\/\s*[\d,]+(?:\s*[~～-]\s*[\d,]+)?\s*(?:ps|hp|마력)(?:\s*\/\s*rpm)?$/i) ??
    text.match(/([\d,]+(?:\.\d+)?)\s*(?:ps|hp|마력)/i);
  if (!match) return null;
  const power = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(power) && power > 0 ? power : null;
}
function parseCc(value: string): number | null {
  const cc = value.match(/([\d,]+)\s*cc/i);
  if (cc) return Number(cc[1].replace(/,/g, ""));
  const liters = value.match(/([\d]+(?:\.\d+)?)\s*л/i);
  return liters ? Math.round(Number(liters[1]) * 1000) : null;
}
function fuelType(value: string): string | null {
  if (/경유|디젤|diesel/i.test(value)) return "diesel";
  if (/휘발유|가솔린|gasoline|petrol/i.test(value)) return "gasoline";
  if (/lpg|엘피지|액화석유가스/i.test(value)) return "lpg";
  return null;
}
function driveType(value: string): string | null {
  if (/4wd|4륜|awd|4x4/i.test(value)) return "4WD";
  if (/전륜|후륜|ff|fr|fwd|rwd|2wd/i.test(value)) return "2WD";
  return null;
}
function rowCells(html: string, index: number): string[] {
  const row = html.match(new RegExp(`<tr\\b[^>]*id=['"]compareRight_${index}['"][^>]*>([\\s\\S]*?)<\\/tr>`, "i"))?.[1];
  if (!row) return [];
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanHtml(cell[1]));
}
function parseSpecVariants(html: string): SpecVariant[] {
  const cc = rowCells(html, 2), power = rowCells(html, 3), fuel = rowCells(html, 1);
  const drive = rowCells(html, 17), transmission = rowCells(html, 18);
  const trim = [...html.matchAll(/<span\s+class=['"]trim['"][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((cell) => cleanHtml(cell[1]));
  const max = Math.max(cc.length, power.length, fuel.length, drive.length, transmission.length);
  const variants: SpecVariant[] = [];
  for (let index = 0; index < max; index++) {
    const ccText = cc[index] ?? "";
    const powerText = power[index] ?? "";
    variants.push({
      trim: trim[index] ?? null,
      engineCc: parseCc(ccText),
      powerPs: parsePower(powerText),
      fuelType: fuelType(fuel[index] ?? ""),
      driveType: driveType(drive[index] ?? ""),
      transmission: transmission[index] ?? null,
    });
  }
  return variants.filter((variant) => variant.powerPs != null || variant.engineCc != null);
}

function lineupEngineCc(label: string): number | null {
  const match = label.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:t|터보)?(?:\s|$)/i);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}
function lineupFuel(label: string): string | null { return fuelType(label); }
function lineupDrive(label: string): string | null { return driveType(label); }
function lineupCouldFit(group: Group, lineup: Lineup): boolean {
  if (group.year != null && Math.abs(lineup.modelYear - group.year) > yearWindow) return false;
  const labelCc = lineupEngineCc(lineup.label);
  if (group.engineCc != null && labelCc != null && Math.abs(labelCc - group.engineCc) > ccTolerance) return false;
  const labelFuel = lineupFuel(lineup.label);
  if (group.fuelType && labelFuel && labelFuel !== group.fuelType) return false;
  const labelDrive = lineupDrive(lineup.label);
  if (group.driveType && labelDrive && labelDrive !== group.driveType) return false;
  return true;
}
function variantFits(group: Group, lineup: Lineup, variant: SpecVariant) {
  if (group.year != null && Math.abs(lineup.modelYear - group.year) > yearWindow) return false;
  if (group.engineCc != null && (variant.engineCc == null || Math.abs(variant.engineCc - group.engineCc) > ccTolerance)) return false;
  if (group.fuelType && variant.fuelType !== group.fuelType) return false;
  if (group.driveType && variant.driveType && variant.driveType !== group.driveType) return false;
  return variant.powerPs != null;
}

async function main() {
  const plan = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string; externalSearch?: { worklist?: Group[] } };
  if (runIdExpected && plan.runId !== runIdExpected) throw new Error(`Power plan runId mismatch: expected ${runIdExpected}, got ${plan.runId}`);
  const worklist = plan.externalSearch?.worklist;
  if (!Array.isArray(worklist)) throw new Error(`No externalSearch.worklist in ${inputPath}`);
  const groups = worklist.slice(0, limit);
  const searchCache = new Map<string, SearchHit[]>();
  const modelPageCache = new Map<string, { title: string | null; lineups: Lineup[] }>();
  const lineupCache = new Map<string, ParsedLineup>();
  const errors: Array<Record<string, unknown>> = [];
  let requests = 0;
  let requestAttempts = 0;

  const requestText = async (stage: string, url: string) => {
    const attempt = ++requestAttempts;
    const startedAt = Date.now();
    console.log(JSON.stringify({ event: "request_start", stage, attempt, url }));
    try {
      const html = await fetchText(url);
      requests++;
      console.log(JSON.stringify({ event: "request_done", stage, attempt, elapsedMs: Date.now() - startedAt, bytes: Buffer.byteLength(html) }));
      return html;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "request_error", stage, attempt, elapsedMs: Date.now() - startedAt, error: message }));
      throw error;
    }
  };

  const searchHits = async (query: string) => {
    const key = query.toLowerCase();
    const cached = searchCache.get(key);
    if (cached) return cached;
    await sleep(delayMs);
    const url = `https://auto.danawa.com/search/?q=${encodeURIComponent(query)}`;
    try {
      const html = await requestText("search", url);
      const hits = parseSearchHits(html);
      searchCache.set(key, hits);
      return hits;
    } catch (error) {
      // Remember failed queries too; otherwise every configuration sharing
      // this model name repeats the same slow or unavailable Danawa request.
      searchCache.set(key, []);
      throw error;
    }
  };
  const modelPage = async (hit: SearchHit) => {
    const cached = modelPageCache.get(hit.modelId);
    if (cached) return cached;
    await sleep(delayMs);
    const html = await requestText("model_page", `https://auto.danawa.com/auto/?Work=model&Model=${hit.modelId}&Tab=spec`);
    const parsed = parseLineups(html, hit.modelId);
    modelPageCache.set(hit.modelId, parsed);
    return parsed;
  };
  const lineupPage = async (lineup: Lineup) => {
    const cached = lineupCache.get(lineup.lineupId);
    if (cached) return cached;
    await sleep(delayMs);
    try {
      const html = await requestText("lineup_page", lineup.url);
      const parsed = parseLineups(html, lineup.url.match(/Model=(\d+)/)?.[1] ?? "");
      const result = { lineup, modelTitle: parsed.title, variants: parseSpecVariants(html) };
      lineupCache.set(lineup.lineupId, result);
      return result;
    } catch (error) {
      const result = { lineup, modelTitle: null, variants: [], error: error instanceof Error ? error.message : String(error) };
      lineupCache.set(lineup.lineupId, result);
      errors.push({ source: "Danawa lineup", lineupId: lineup.lineupId, error: result.error });
      if (/rate\/protection|verification/i.test(result.error ?? "")) throw error;
      return result;
    }
  };

  const modelNames = new Map<string, SearchHit[]>();
  const uniqueModels = [...new Set(groups.map((group) => `${group.brand}|${group.model}`))];
  console.log(JSON.stringify({ event: "search_stage_start", configurations: groups.length, distinctModels: uniqueModels.length }));
  let searchedModels = 0;
  for (const modelKey of uniqueModels) {
    const [brandName, modelName] = modelKey.split("|");
    const group = groups.find((candidate) => `${candidate.brand}|${candidate.model}` === modelKey)!;
    const brand = brandAliases(group);
    const hits = new Map<string, SearchHit>();
    for (const query of modelQueries(group)) {
      try {
        for (const hit of await searchHits(query)) {
          if (brand.some((alias) => norm(hit.label).includes(alias))) hits.set(hit.modelId, hit);
        }
      } catch (error) {
        errors.push({ source: "Danawa search", query, error: error instanceof Error ? error.message : String(error) });
        if (/rate\/protection|verification/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
    }
    modelNames.set(modelKey, [...hits.values()]);
    searchedModels++;
    console.log(JSON.stringify({ event: "search_model_progress", completed: searchedModels, total: uniqueModels.length, brand: brandName, model: modelName, queries: modelQueries(group).length, hits: hits.size, requests, requestAttempts }));
  }

  const allHits = new Map<string, SearchHit>();
  for (const hits of modelNames.values()) for (const hit of hits) allHits.set(hit.modelId, hit);
  const pages = new Map<string, { hit: SearchHit; title: string | null; lineups: Lineup[] }>();
  let modelNo = 0;
  console.log(JSON.stringify({ event: "model_stage_start", total: allHits.size }));
  for (const hit of allHits.values()) {
    try {
      const page = await modelPage(hit);
      pages.set(hit.modelId, { hit, ...page });
    } catch (error) {
      errors.push({ source: "Danawa model page", modelId: hit.modelId, error: error instanceof Error ? error.message : String(error) });
      if (/rate\/protection|verification/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
    modelNo++;
    console.log(JSON.stringify({ event: "model_progress", completed: modelNo, total: allHits.size, requests, requestAttempts }));
  }

  const results: Array<Record<string, unknown>> = [];
  let completed = 0;
  console.log(JSON.stringify({ event: "configuration_stage_start", total: groups.length }));
  for (const group of groups) {
    const hits = modelNames.get(`${group.brand}|${group.model}`) ?? [];
    const matchingPages = hits.flatMap((hit) => {
      const page = pages.get(hit.modelId);
      if (!page) return [];
      const expectedSourceModels = modelQueries(group).map(norm).filter(Boolean);
      const titleKey = norm(page.title);
      const modelNameFits = expectedSourceModels.some((name) => titleKey.includes(name) || name.includes(titleKey)) ||
        titleKey.includes(norm(group.model)) || norm(group.model).includes(titleKey);
      if (!modelNameFits) return [];
      const lineups = page.lineups.filter((lineup) => lineupCouldFit(group, lineup));
      return lineups.map((lineup) => ({ hit, page, lineup }));
    });
    const uniqueLineups = [...new Map(matchingPages.map((item) => [item.lineup.lineupId, item])).values()];
    const sourceCandidates: Array<Record<string, unknown>> = [];
    for (const item of uniqueLineups) {
      const parsed = await lineupPage(item.lineup);
      for (const variant of parsed.variants) {
        if (!variantFits(group, item.lineup, variant)) continue;
        sourceCandidates.push({
          modelTitle: parsed.modelTitle,
          modelUrl: `https://auto.danawa.com/auto/?Work=model&Model=${item.hit.modelId}&Tab=spec`,
          sourceUrl: item.lineup.url,
          danawaModelId: item.hit.modelId,
          lineupId: item.lineup.lineupId,
          modelYear: item.lineup.modelYear,
          lineupLabel: item.lineup.label,
          ...variant,
          yearDelta: group.year == null ? null : item.lineup.modelYear - group.year,
        });
      }
    }
    const powers = [...new Set(sourceCandidates.map((candidate) => Number(candidate.powerPs)))];
    const classification = !hits.length ? "unmapped_model"
      : !uniqueLineups.length ? "no_compatible_year_or_lineup"
      : !sourceCandidates.length ? "no_matching_specification"
      : powers.length === 1 ? "preliminary_candidate" : "review_multiple_powers";
    results.push({
      group,
      danawaModelPages: hits.map((hit) => ({ modelId: hit.modelId, label: hit.label, url: hit.url, title: pages.get(hit.modelId)?.title ?? null })),
      compatibleLineups: uniqueLineups.map(({ lineup }) => lineup),
      sourceCandidates,
      powerCandidatesPs: powers,
      suggestedPowerPs: powers.length === 1 ? powers[0] : null,
      classification,
      listingCount: group.listingIds.length,
    });
    completed++;
    console.log(JSON.stringify({ event: "configuration_progress", completed, total: groups.length, requests, requestAttempts }));
  }

  const classifications = Object.fromEntries([
    "preliminary_candidate", "review_multiple_powers", "unmapped_model", "no_compatible_year_or_lineup", "no_matching_specification",
  ].map((status) => [status, results.filter((row) => row.classification === status).length]));
  const classificationListings = Object.fromEntries(Object.entries(classifications).map(([status]) => [status,
    results.filter((row) => row.classification === status).reduce((count, row) => count + Number(row.listingCount), 0)]));
  const report = {
    generatedAt: new Date().toISOString(), runId: plan.runId, source: "Danawa public model/year/lineup specification pages",
    readOnly: true, databaseWrites: 0, publicCatalogChanged: false,
    targetConfigurations: groups.length, targetListings: groups.reduce((sum, group) => sum + group.listingIds.length, 0),
    requests, requestAttempts, classifications, classificationListings, yearWindow, engineCcTolerance: ccTolerance,
    errors, output: outputPath, results,
  };
  await mkdir("output", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
