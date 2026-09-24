/** Read-only direct-source pass after AutoHome. No result is promoted here. */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

type Group = { brand: string | null; model: string | null; generation: string | null; year: number | null; engineCc: number | null; fuelType: string | null; driveType: string | null; listingIds: string[]; badgeExamples: string[] };
type SourceCandidate = { engineCc: number; powerHp: number; context: string };
type SourceResult = { url: string | null; status: "ok" | "unmapped" | "http_error" | "network_error"; candidates: SourceCandidate[]; error?: string };

const inputPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.EXTERNAL_CATALOG_OUTPUT ?? "output/tl-auto-new-encar-external-catalogs.json";
const delayMs = Math.max(300, Number(process.env.EXTERNAL_CATALOG_DELAY_MS ?? 800));
const concurrency = Math.max(1, Math.min(4, Number(process.env.EXTERNAL_CATALOG_CONCURRENCY ?? 2)));
const limit = Math.max(1, Number(process.env.EXTERNAL_CATALOG_LIMIT ?? 1000));
const SLUGS: Record<string, string> = {
  "Audi|A6": "audi/a6", "BMW|1 Series": "bmw/1-series", "BMW|2 Series": "bmw/2-series", "BMW|3 Series": "bmw/3-series", "BMW|5 Series": "bmw/5-series", "BMW|X1": "bmw/x1", "BMW|X3": "bmw/x3", "BMW|X5": "bmw/x5", "Chevrolet|Trax": "chevrolet/trax", "Genesis|GV70": "genesis/gv70", "Hyundai|Palisade": "hyundai/palisade", "Kia|Sorento": "kia/sorento", "Land Rover|Discovery": "land-rover/discovery", "Land Rover|Range Rover Evoque": "land-rover/range-rover-evoque", "Renault Korea|XM3": "renault-korea/xm3", "Volkswagen|Golf": "volkswagen/golf",
};
const headers = { "user-agent": "Mozilla/5.0 (compatible; TL-Auto catalog research/1.0)", "accept-language": "ru-RU,ru;q=0.9,en;q=0.8" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const keyOf = (group: Group) => `${group.brand}|${group.model}`;

function candidatesFromText(text: string) {
  const values: SourceCandidate[] = [];
  const pattern = /(\d(?:[.,]\d)?)\s*(?:л|l)\b([\s\S]{0,120}?)(\d{2,4})\s*(?:л\.?с\.?|hp)/gi;
  for (const match of text.matchAll(pattern)) {
    const engineCc = Math.round(Number(match[1].replace(",", ".")) * 1000), powerHp = Number(match[3]);
    if (engineCc < 600 || engineCc > 9000 || powerHp < 30 || powerHp > 1500) continue;
    values.push({ engineCc, powerHp, context: match[0].slice(0, 180) });
  }
  return [...new Map(values.map((value) => [`${value.engineCc}|${value.powerHp}`, value])).values()];
}
async function fetchSource(url: string): Promise<SourceResult> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { url, status: "http_error", candidates: [], error: `HTTP ${response.status}` };
    return { url, status: "ok", candidates: candidatesFromText(clean(await response.text())) };
  } catch (error) { return { url, status: "network_error", candidates: [], error: error instanceof Error ? error.message : String(error) }; }
}
async function queryGroup(group: Group) {
  const slug = SLUGS[keyOf(group)], year = group.year;
  const dromUrl = slug && year ? `https://www.drom.ru/catalog/${slug}/${year}/` : null;
  const encarrusUrl = group.brand && group.model ? `https://encarrus.ru/?s=${encodeURIComponent(`${group.brand} ${group.model} ${year ?? ""}`)}` : null;
  const drom = dromUrl ? await fetchSource(dromUrl) : { url: null, status: "unmapped" as const, candidates: [] };
  await sleep(delayMs);
  const encarrus = encarrusUrl ? await fetchSource(encarrusUrl) : { url: null, status: "unmapped" as const, candidates: [] };
  const eligible = [...drom.candidates, ...encarrus.candidates].filter((candidate) => group.engineCc == null || Math.abs(candidate.engineCc - group.engineCc) <= 120);
  const powers = [...new Set(eligible.map((candidate) => candidate.powerHp))];
  return { group, drom, encarrus, eligibleCandidates: eligible,
    classification: powers.length === 1 ? "preliminary_candidate" : powers.length > 1 ? "review_multiple_powers" : "no_direct_match",
    suggestedPowerHp: powers.length === 1 ? powers[0] : null };
}
async function main() {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string; externalSearch?: { worklist?: Group[] } };
  const worklist = input.externalSearch?.worklist;
  if (!Array.isArray(worklist)) throw new Error(`No externalSearch.worklist in ${inputPath}`);
  const selected = worklist.slice(0, limit), results: Awaited<ReturnType<typeof queryGroup>>[] = new Array(selected.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => { while (true) {
    const index = cursor++; if (index >= selected.length) return;
    results[index] = await queryGroup(selected[index]);
    if ((index + 1) % 20 === 0) console.log(JSON.stringify({ event: "progress", completed: index + 1, total: selected.length }));
  }}));
  const counts = Object.fromEntries(["preliminary_candidate", "review_multiple_powers", "no_direct_match"].map((status) => [status, results.filter((result) => result.classification === status).length]));
  const report = { generatedAt: new Date().toISOString(), runId: input.runId, readOnly: true, databaseWrites: 0, publications: 0, sources: ["Drom public catalog HTML", "EncarRus public search HTML"], input: inputPath, selectedConfigurations: selected.length, counts, results };
  await mkdir("output", { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, results: undefined, output: outputPath }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
