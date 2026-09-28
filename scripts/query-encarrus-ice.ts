/** Read-only EncarRus catalogue search for gasoline/diesel power configurations. */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEncarrusProductPower } from "../src/server/catalog/encarrus-power";
import { encarrusIceMatch, encarrusIceModelNameMatches, parseEncarrusIceCards, type EncarrusIceCard } from "../src/server/catalog/encarrus-ice";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

type Group = {
  brand: string | null; model: string | null; generation: string | null; year: number | null;
  engineCc: number | null; fuelType: string | null; driveType: string | null;
  listingIds: string[]; badgeExamples: string[];
  sourceExamples?: Array<{
    snapshotBrand?: string | null; snapshotModel?: string | null; detailManufacturer?: string | null;
    detailModel?: string | null; detailModelGroup?: string | null;
  }>;
};
type Generation = { id: number | string; name: string; count: number };
type Model = { id: number | string; name: string; url: string; count: number; generations: Generation[] };

const inputPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.ENCARRUS_ICE_OUTPUT ?? "output/tl-auto-encarrus-ice-power.json";
const delayMs = Math.max(1500, Number(process.env.ENCARRUS_ICE_DELAY_MS ?? 2000));
const timeoutMs = Math.max(3000, Number(process.env.ENCARRUS_ICE_TIMEOUT_MS ?? 20000));
const maxPages = Math.max(1, Math.min(20, Number(process.env.ENCARRUS_ICE_MAX_PAGES_PER_GENERATION ?? 4)));
const detailSamples = Math.max(0, Math.min(2, Number(process.env.ENCARRUS_ICE_DETAIL_SAMPLES_PER_CONFIGURATION ?? 0)));
const limit = Math.max(1, Number(process.env.ENCARRUS_ICE_LIMIT ?? 1000));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "application/json, text/plain, */*", "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
  "x-requested-with": "XMLHttpRequest",
};

function yearRange(label: string) {
  const values = [...label.matchAll(/(?:19|20)\d{2}/g)].map((match) => Number(match[0]));
  return values.length ? { from: Math.min(...values), to: Math.max(...values) } : null;
}
function modelFor(group: Group, models: Model[]): Model | null {
  const matches = models.filter((item) => {
    return encarrusIceModelNameMatches(group, item.name);
  });
  return matches.length === 1 ? matches[0] : null;
}
function isVerification(body: string) {
  return /KillBot user verification|captcha|human verification/i.test(body.slice(0, 5000));
}
async function request(url: string, referer: string, asJson: boolean): Promise<string | Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { ...headers, referer, accept: asJson ? headers.accept : "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (isVerification(body) || response.status === 403 || response.status === 429)
    throw new Error(`EncarRus protection/limit response (HTTP ${response.status}); stopped without bypass`);
  if (!response.ok) throw new Error(`EncarRus HTTP ${response.status}`);
  if (!asJson) return body;
  try { return JSON.parse(body) as Record<string, unknown>; }
  catch { throw new Error(`Expected JSON from ${new URL(url).pathname}`); }
}
async function fetchModels(): Promise<Model[]> {
  const base = "https://encarrus.ru/ajax/meili-models.php";
  const referer = "https://encarrus.ru/korea/";
  const first = await request(`${base}?_path=%2Fkorea%2F`, referer, true) as Record<string, unknown>;
  const models = (first.models as Model[] | undefined) ?? [];
  const total = Number(first.models_total ?? models.length);
  for (let offset = models.length; offset < total;) {
    await sleep(delayMs);
    const query = new URLSearchParams({ _path: "/korea/", _off: String(offset) });
    const page = await request(`${base}?${query}`, referer, true) as Record<string, unknown>;
    const next = (page.models as Model[] | undefined) ?? [];
    if (!next.length) break;
    models.push(...next); offset += next.length;
  }
  return models;
}
function groupKey(group: Group) { return `${group.brand}|${group.model}|${group.generation}|${group.year}|${group.engineCc}|${group.fuelType}|${group.driveType}`; }

async function main() {
  const plan = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string; externalSearch?: { worklist?: Group[] } };
  const sourceGroups = plan.externalSearch?.worklist;
  if (!Array.isArray(sourceGroups)) throw new Error(`No externalSearch.worklist in ${inputPath}`);
  const badFuel = sourceGroups.filter((group) => !["gasoline", "diesel"].includes(String(group.fuelType)));
  if (badFuel.length) throw new Error(`Expected gasoline/diesel-only plan; found ${badFuel.length} rows with other/unknown fuel`);
  const groups = sourceGroups.slice(0, limit);
  const models = await fetchModels();
  const grouped = new Map<string, { model: Model; groups: Group[] }>();
  const unmapped: Array<{ group: Group; reason: string }> = [];
  for (const group of groups) {
    const model = modelFor(group, models);
    if (!model) { unmapped.push({ group, reason: "model name did not map uniquely to EncarRus index" }); continue; }
    const key = `${model.id}|${group.year ?? "unknown"}`;
    const task = grouped.get(key) ?? { model, groups: [] };
    task.groups.push(group); grouped.set(key, task);
  }

  const resultsByKey = new Map<string, { group: Group; model: Model | null; matchedCards: EncarrusIceCard[]; rejections: Record<string, number>; pages: number[]; errors: string[] }>();
  for (const group of groups) resultsByKey.set(groupKey(group), { group, model: modelFor(group, models), matchedCards: [], rejections: {}, pages: [], errors: [] });
  const requestLog: Array<Record<string, unknown>> = [];
  let stoppedOnProtection = false;
  let completed = 0;
  outer: for (const [taskKey, task] of grouped) {
    const generationIds = new Set<string | number>();
    for (const group of task.groups) {
      const matching = (task.model.generations ?? []).filter((generation) => {
        const range = yearRange(generation.name);
        return !!range && group.year != null && group.year >= range.from && group.year <= range.to;
      });
      for (const generation of matching) generationIds.add(generation.id);
    }
    const selectedGenerations = generationIds.size ? [...generationIds] : [null];
    for (const generationId of selectedGenerations) {
      let page = 1;
      while (page <= maxPages) {
        const params = new URLSearchParams({ _path: task.model.url || "/korea/", model: String(task.model.id) });
        if (page > 1) params.set("PAGEN_3", String(page));
        if (generationId != null) params.set("generation", String(generationId));
        const url = `https://encarrus.ru/ajax/meili-list.php?${params}`;
        try {
          const payload = await request(url, `https://encarrus.ru${task.model.url}`, true) as Record<string, unknown>;
          const cards = parseEncarrusIceCards(String(payload.html ?? ""), task.model.url);
          requestLog.push({ taskKey, generationId, page, status: "ok", cards: cards.length });
          for (const group of task.groups) {
            const target = resultsByKey.get(groupKey(group))!;
            target.pages.push(page);
            for (const card of cards) {
              const match = encarrusIceMatch(card, group);
              if (match.matched) {
                if (!target.matchedCards.some((existing) => existing.encarrusListingId === card.encarrusListingId)) target.matchedCards.push(card);
              } else target.rejections[match.reason] = (target.rejections[match.reason] ?? 0) + 1;
            }
          }
          const totalPages = Number(payload.total_pages ?? 0);
          if (page >= totalPages || cards.length === 0) break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          requestLog.push({ taskKey, generationId, page, status: "error", error: message });
          for (const group of task.groups) resultsByKey.get(groupKey(group))!.errors.push(message);
          if (/protection\/limit response|HTTP (?:403|429)/i.test(message)) { stoppedOnProtection = true; break outer; }
          break;
        }
        page++;
        await sleep(delayMs);
      }
    }
    completed++;
    if (completed % 10 === 0) console.log(JSON.stringify({ event: "progress", modelYearTasks: completed, total: grouped.size }));
  }

  const detailLog: Array<Record<string, unknown>> = [];
  if (detailSamples > 0 && !stoppedOnProtection) {
    const seenUrls = new Set<string>();
    outer: for (const entry of resultsByKey.values()) {
      for (const card of entry.matchedCards.filter((candidate) => candidate.productUrl).slice(0, detailSamples)) {
        const url = card.productUrl!;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        await sleep(delayMs);
        try {
          const html = await request(url, card.modelUrl, false) as string;
          const evidence = parseEncarrusProductPower(html, card.fuelType);
          detailLog.push({
            url, status: "parsed", sourceListingId: card.encarrusListingId,
            rawPowerText: evidence.rawPowerText, powerHp: evidence.displayedPowerHp,
            powerBasis: evidence.powerBasis,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          detailLog.push({ url, status: "error", error: message });
          if (/protection\/limit response|HTTP (?:403|429)/i.test(message)) { stoppedOnProtection = true; break outer; }
        }
      }
    }
  }

  const results = [...resultsByKey.values()].map(({ group, model, matchedCards, rejections, pages, errors }) => {
    const powers = [...new Set(matchedCards.map((card) => card.displayedPowerHp).filter((value): value is number => value != null))];
    const hasUnverifiedDrive = matchedCards.some((card) => group.driveType && !card.driveText);
    return {
      group,
      encarrusModel: model ? { id: model.id, name: model.name, url: `https://encarrus.ru${model.url}` } : null,
      matchedCards,
      scannedPages: [...new Set(pages)],
      rejectedCardCounts: rejections,
      errors,
      powerCandidatesHp: powers,
      suggestedPowerHp: powers.length === 1 && !hasUnverifiedDrive ? powers[0] : null,
      classification: errors.length ? "source_error" : !matchedCards.length ? "no_matching_card" : !powers.length ? "matched_without_power" : powers.length > 1 || hasUnverifiedDrive ? "review_match_or_power" : "preliminary_candidate",
    };
  });
  const report = {
    generatedAt: new Date().toISOString(), runId: plan.runId, source: "EncarRus Meili AJAX catalogue (ICE)",
    input: inputPath, readOnly: true, databaseWrites: 0, publications: 0,
    targetConfigurations: groups.length, mappedConfigurations: groups.length - unmapped.length,
    unmappedConfigurations: unmapped.length, modelYearTasks: grouped.size, ajaxRequests: requestLog.length,
    configurationsWithMatchingCards: results.filter((row) => row.matchedCards.length).length,
    withDisplayedPower: results.filter((row) => row.matchedCards.some((card) => card.displayedPowerHp != null)).length,
    classifications: Object.fromEntries(["preliminary_candidate", "review_match_or_power", "matched_without_power", "no_matching_card", "source_error"].map((key) => [key, results.filter((row) => row.classification === key).length])),
    detailSamplesRequested: detailSamples, detailPagesParsed: detailLog.filter((entry) => entry.status === "parsed").length,
    stoppedOnProtection, delayMs, maxPagesPerGeneration: maxPages, output: outputPath,
    unmapped, requestLog, detailLog, results,
  };
  await mkdir("output", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    generatedAt: report.generatedAt, runId: report.runId, source: report.source,
    readOnly: report.readOnly, databaseWrites: report.databaseWrites, publications: report.publications,
    targetConfigurations: report.targetConfigurations, mappedConfigurations: report.mappedConfigurations,
    unmappedConfigurations: report.unmappedConfigurations, modelYearTasks: report.modelYearTasks,
    ajaxRequests: report.ajaxRequests, configurationsWithMatchingCards: report.configurationsWithMatchingCards,
    withDisplayedPower: report.withDisplayedPower, classifications: report.classifications,
    detailSamplesRequested: report.detailSamplesRequested, detailPagesParsed: report.detailPagesParsed,
    stoppedOnProtection: report.stoppedOnProtection, delayMs: report.delayMs,
    maxPagesPerGeneration: report.maxPagesPerGeneration, output: report.output,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
