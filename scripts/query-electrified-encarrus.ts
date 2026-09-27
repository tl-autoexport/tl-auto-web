/** Read-only EncarRus AJAX catalog research for one electrified Encar run. */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

type Group = {
  brand: string | null; model: string | null; generation: string | null; year: number | null;
  engineCc: number | null; fuelType: string | null; driveType: string | null;
  listingIds: string[]; badgeExamples: string[];
};
type Generation = { id: number | string; name: string; count: number };
type Model = { id: number | string; name: string; url: string; count: number; generations: Generation[] };
type Card = {
  encarrusListingId: string; name: string; trim: string; year: number | null;
  engineText: string | null; engineCcApprox: number | null; fuelType: string | null;
  displayedPowerText: string | null; displayedPowerHp: number | null; powerBasis: string;
  driveText: string | null; url: string;
};

const inputPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-electrified-21a687ee-power-plan.json";
const outputPath = process.env.ENCARRUS_ELECTRIFIED_OUTPUT ?? "output/tl-auto-electrified-encarrus.json";
const delayMs = Math.max(900, Number(process.env.ENCARRUS_DELAY_MS ?? 1200));
const timeoutMs = Math.max(2000, Number(process.env.ENCARRUS_TIMEOUT_MS ?? 20000));
const maxPagesPerGeneration = Math.max(1, Math.min(20, Number(process.env.ENCARRUS_MAX_PAGES_PER_GENERATION ?? 4)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
  "x-requested-with": "XMLHttpRequest",
};

function clean(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}
function normalize(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
}
function yearFromLabel(label: string) {
  const years = [...label.matchAll(/20\d{2}/g)].map((m) => Number(m[0]));
  return years.length ? { from: Math.min(...years), to: Math.max(...years) } : null;
}
function modelNameFor(group: Group, models: Model[]): Model | null {
  const brand = normalize(group.brand);
  const model = normalize(group.model);
  const matches = models.filter((candidate) => {
    const name = normalize(candidate.name);
    const brandFits = !brand || name.includes(brand) || (brand === "mercedesbenz" && name.includes("mercedes"));
    const modelPart = brand && name.startsWith(brand) ? name.slice(brand.length) : name;
    const modelFits = model && modelPart === model;
    return brandFits && modelFits;
  });
  return matches.length === 1 ? matches[0] : null;
}

async function fetchJson(url: string, referer: string) {
  const response = await fetch(url, { headers: { ...headers, referer }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (/KillBot user verification|captcha|human verification/i.test(body.slice(0, 5000))) {
    throw new Error("EncarRus verification page returned; refusing to treat it as catalog data");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try { return JSON.parse(body) as Record<string, unknown>; }
  catch { throw new Error(`Expected JSON from ${new URL(url).pathname}`); }
}

async function fetchAllModels(): Promise<Model[]> {
  const base = "https://encarrus.ru/ajax/meili-models.php";
  const referer = "https://encarrus.ru/korea/";
  const first = await fetchJson(`${base}?_path=%2Fkorea%2F`, referer);
  const models = (first.models as Model[] | undefined) ?? [];
  const total = Number(first.models_total ?? models.length);
  let offset = models.length;
  while (offset < total) {
    await sleep(delayMs);
    const params = new URLSearchParams({ _path: "/korea/", _off: String(offset) });
    const page = await fetchJson(`${base}?${params}`, referer);
    const next = (page.models as Model[] | undefined) ?? [];
    if (!next.length) break;
    models.push(...next);
    offset += next.length;
  }
  return models;
}

function parseCards(html: string, modelUrl: string): Card[] {
  const starts = [...html.matchAll(/<div class="element--wrapper[^\"]*" id="card_(\d+)"/g)];
  const cards: Card[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index].index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    const cardHtml = html.slice(start, end);
    const id = starts[index][1];
    const name = clean(cardHtml.match(/class="c-name">([^<]*)</)?.[1] ?? "");
    const trim = clean(cardHtml.match(/class="c-trim">([^<]*)</)?.[1] ?? "");
    const props = new Map([...cardHtml.matchAll(/<span class="c-prop-k">([^<]+)<\/span>\s*<span class="c-prop-v">([^<]+)<\/span>/g)]
      .map((match) => [clean(match[1]), clean(match[2])]));
    const engineText = props.get("Двиг.") ?? null;
    const engineLiters = engineText?.match(/(\d+(?:[.,]\d+)?)/)?.[1];
    const engineCcApprox = engineLiters ? Math.round(Number(engineLiters.replace(",", ".")) * 1000) : null;
    const fuelType = engineText && /гибрид|hybrid/i.test(engineText) ? "hybrid"
      : engineText && /электр|электро|electric/i.test(engineText) ? "electric" : null;
    const displayedPowerText = props.get("Мощн.") ?? null;
    const power = displayedPowerText?.match(/(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?|hp|ps)/i)?.[1];
    const year = Number(trim.match(/\b(20\d{2})\b/)?.[1]) || null;
    cards.push({
      encarrusListingId: id, name, trim, year, engineText, engineCcApprox, fuelType,
      displayedPowerText, displayedPowerHp: power ? Number(power.replace(",", ".")) : null,
      powerBasis: fuelType === "electric" ? "displayed_rating_not_30min" : fuelType === "hybrid" ? "displayed_rating_basis_unspecified" : "combustion_or_unspecified",
      driveText: props.get("Привод") ?? null,
      url: `https://encarrus.ru${modelUrl}`,
    });
  }
  return cards;
}

function matchesGroup(card: Card, group: Group) {
  if (card.year !== group.year || card.fuelType !== group.fuelType) return false;
  if (group.fuelType === "hybrid" && group.engineCc && card.engineCcApprox && Math.abs(group.engineCc - card.engineCcApprox) > 180) return false;
  if (group.driveType && card.driveText) {
    const target = normalize(group.driveType), source = normalize(card.driveText);
    if (target.includes("4wd") && !/4wd|4x4|полный/.test(source)) return false;
    if (target.includes("2wd") && !/2wd|передний|задний/.test(source)) return false;
  }
  return true;
}

async function main() {
  const plan = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string; externalSearch?: { worklist?: Group[] } };
  const groups = plan.externalSearch?.worklist;
  if (!Array.isArray(groups)) throw new Error(`No externalSearch.worklist in ${inputPath}`);
  const models = await fetchAllModels();
  const modelForGroup = new Map<Group, Model | null>(groups.map((group) => [group, modelNameFor(group, models)]));
  const tasks = new Map<string, { model: Model; generationId: number | string | null; groups: Group[]; pageCount: number }>();
  const unmapped: Array<{ group: Group; reason: string }> = [];
  for (const group of groups) {
    const model = modelForGroup.get(group) ?? null;
    if (!model) { unmapped.push({ group, reason: "model name not uniquely mapped in EncarRus model index" }); continue; }
    const generations = (model.generations ?? []).filter((generation) => {
      if (!group.year) return false;
      const range = yearFromLabel(generation.name);
      return !!range && group.year >= range.from && group.year <= range.to;
    });
    const selected = generations.length ? generations : [null];
    for (const generation of selected) {
      const key = `${model.id}|${generation?.id ?? "all"}`;
      const task = tasks.get(key) ?? { model, generationId: generation?.id ?? null, groups: [], pageCount: 0 };
      task.groups.push(group);
      tasks.set(key, task);
    }
  }

  const matches = new Map<Group, Card[]>();
  const requestLog: Array<{ model: string; generationId: number | string | null; page: number; status: string; count?: number; error?: string }> = [];
  let completed = 0;
  for (const task of tasks.values()) {
    const modelUrl = task.model.url || "/korea/";
    const totalPages = maxPagesPerGeneration;
    for (let page = 1; page <= totalPages; page++) {
      const params = new URLSearchParams({ _path: modelUrl, model: String(task.model.id) });
      if (page > 1) params.set("PAGEN_3", String(page));
      if (task.generationId != null) params.set("generation", String(task.generationId));
      const url = `https://encarrus.ru/ajax/meili-list.php?${params}`;
      try {
        const payload = await fetchJson(url, `https://encarrus.ru${modelUrl}`);
        const cards = parseCards(String(payload.html ?? ""), modelUrl);
        requestLog.push({ model: task.model.name, generationId: task.generationId, page, status: "ok", count: cards.length });
        for (const group of task.groups) {
          const bucket = matches.get(group) ?? [];
          for (const card of cards) if (matchesGroup(card, group) && !bucket.some((old) => old.encarrusListingId === card.encarrusListingId)) bucket.push(card);
          matches.set(group, bucket);
        }
        task.pageCount++;
        const total = Number(payload.total_pages ?? 0);
        const allGroupsFound = task.groups.every((group) => (matches.get(group)?.length ?? 0) >= 3);
        if (allGroupsFound || page >= total || cards.length === 0) break;
      } catch (error) {
        requestLog.push({ model: task.model.name, generationId: task.generationId, page, status: "error", error: error instanceof Error ? error.message : String(error) });
        break;
      }
      await sleep(delayMs);
    }
    completed++;
    if (completed % 10 === 0) console.log(JSON.stringify({ event: "progress", modelGenerationTasks: completed, total: tasks.size }));
  }

  const results = groups.map((group) => {
    const model = modelForGroup.get(group) ?? null;
    const cards = matches.get(group) ?? [];
    const powers = [...new Set(cards.map((card) => card.displayedPowerHp).filter((power): power is number => power != null))];
    return {
      group, encarrusModel: model ? { id: model.id, name: model.name, url: `https://encarrus.ru${model.url}` } : null,
      scannedPages: tasksForGroup(group, tasks), matchedCards: cards,
      displayedPowerCandidatesHp: powers,
      result: cards.length ? "listing_candidates_found" : "no_matching_listing_in_scanned_pages",
      thirtyMinutePower: null,
      note: "EncarRus listing power is captured as displayed, not approved. It does not provide a verified EV 30-minute rating; hybrid displayed power basis is unspecified.",
    };
  });
  const summary = {
    generatedAt: new Date().toISOString(), runId: plan.runId, source: "EncarRus Meili AJAX catalog",
    readOnly: true, databaseWrites: 0, publications: 0, targetConfigurations: groups.length,
    modelIndexRows: models.length, mappedConfigurations: groups.length - unmapped.length, unmappedConfigurations: unmapped.length,
    modelGenerationTasks: tasks.size, ajaxRequests: requestLog.length,
    configurationsWithMatchingCards: results.filter((row) => row.matchedCards.length > 0).length,
    withDisplayedPower: results.filter((row) => row.matchedCards.some((card) => card.displayedPowerHp != null)).length,
    withThirtyMinutePower: 0,
    output: outputPath,
  };
  await mkdir("output", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ ...summary, input: inputPath, unmapped, requestLog, results }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

function tasksForGroup(group: Group, tasks: Map<string, { model: Model; generationId: number | string | null; groups: Group[] }>) {
  return [...tasks.values()].filter((task) => task.groups.includes(group)).map((task) => task.generationId);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
