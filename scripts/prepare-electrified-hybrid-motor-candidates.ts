/** Rebuild the run-scoped Danawa hybrid-component manifest from saved reports. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const OUT = "data/power/electrified-21a687ee-hybrid-motor-candidates.json";
const WRITE = process.env.TL_AUTO_ELECTRIFIED_HYBRID_MOTOR_MANIFEST_WRITE === "true";
const KW_PER_PS = 0.73549875;

type Group = { brand: string; model: string; year: number; engineCc: number; fuelType: string; driveType: string | null; listingIds: string[]; badgeExamples?: string[] };
type Danawa = { brand: string; model: string; year: number; engineCc: number; driveType: string | null; listingIds: string[];
  danawaModelCode: number; danawaTitle: string; danawaPageStatus: number; danawaEngineValues: string[]; danawaMotorPeakValues: string[] };
type ReportRow = { group: Group; matchedCards: Array<{ displayedPowerHp: number | null }> };

const parseSet = (values: string[]) => [...new Set(values.map((value) => Number(value.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]))
  .filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
const kw = (ps: number) => Number((ps * KW_PER_PS).toFixed(4));
const key = (row: { brand: string; model: string; year: number; engineCc: number; driveType: string | null }) =>
  [row.brand, row.model, row.year, row.engineCc, row.driveType ?? ""].join("|");

async function read<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

async function main() {
  const [plan, current, danawaReport, dromReport, encarrus] = await Promise.all([
    read<{ runId: string; externalSearch: { worklist: Group[] } }>("output/tl-auto-electrified-21a687ee-power-plan.json"),
    read<{ runId: string; entries: Array<{ sourceListingId: string }>; unresolved: Array<{ sourceListingId: string; fuelType: string }> }>("data/power/electrified-21a687ee-power-reference.json"),
    read<{ runId: string; configurations: Danawa[] }>("output/tl-auto-electrified-21a687ee-danawa-hybrid-crosscheck.json"),
    read<{ summary: { runId: string }; results: Array<{ listingIds: string[]; drom?: { engineMaxPower?: { value?: number } | null } | null }> }>("output/tl-auto-electrified-21a687ee-drom-hybrid-research.json"),
    read<{ runId: string; results: ReportRow[] }>("output/tl-auto-electrified-encarrus.json"),
  ]);
  if ([plan.runId, current.runId, danawaReport.runId, dromReport.summary.runId, encarrus.runId].some((id) => id !== RUN_ID))
    throw new Error("Run ID mismatch; no manifest written");

  const targetIds = new Set([
    "42739361", "42740267", "42740856", "42741141", "42747092", "42760048", "42761681", "42761800",
    "42764768", "42764891", "42768139", "42773175", "42773917", "42776683", "42778760", "42784438",
    "42787113", "42787737", "42791349", "42792964",
  ]);
  const targetGroups = plan.externalSearch.worklist.filter((group) => group.listingIds.some((id) => targetIds.has(String(id))));
  const groupByListing = new Map(targetGroups.flatMap((group) => group.listingIds.map((id) => [String(id), group] as const)));
  const danawaByListing = new Map(danawaReport.configurations.flatMap((row) => row.listingIds.map((id) => [String(id), row] as const)));
  const dromByListing = new Map(dromReport.results.flatMap((row) => row.listingIds.map((id) => [String(id), row] as const)));
  const encarrusByKey = new Map(encarrus.results.map((row) => [key(row.group), row]));
  const unresolvedIds = new Set(current.unresolved.filter((row) => row.fuelType === "hybrid").map((row) => String(row.sourceListingId)));
  const entries: Array<Record<string, unknown>> = [];

  const unresolvedTargets: Array<{ sourceListingId: string; brand: string; model: string; year: number; driveType: string | null; reason: string }> = [];
  for (const id of targetIds) {
    if (!groupByListing.has(id) || !unresolvedIds.has(id)) throw new Error(`Target listing missing from run/unresolved set: ${id}`);
    if (!danawaByListing.has(id)) {
      const group = groupByListing.get(id)!;
      unresolvedTargets.push({ sourceListingId: id, brand: group.brand, model: group.model, year: group.year,
        driveType: group.driveType, reason: "No exact listing-level Danawa match in saved report" });
    }
  }
  const included = new Set<string>();
  for (const group of targetGroups) {
    const targetGroupIds = group.listingIds.filter((id) => targetIds.has(String(id)));
    const source = targetGroupIds.map((id) => danawaByListing.get(String(id))).find(Boolean);
    if (!source) continue;
    if (source.danawaPageStatus !== 200 || group.fuelType !== "hybrid")
      throw new Error(`Source/run validation failed for ${key(group)}`);
    const configKey = key(group);
    const engineValues = parseSet(source.danawaEngineValues);
    const motorValues = parseSet(source.danawaMotorPeakValues);
    const enginePs = engineValues[0];
    const electricMotorPowerPs = motorValues[0];
    const corroboratingCards = encarrusByKey.get(configKey)?.matchedCards ?? [];
    const encarrusEngineValues = [...new Set(corroboratingCards.map((card) => card.displayedPowerHp)
      .filter((value): value is number => value != null && Number.isFinite(value)))];
    if (encarrusEngineValues.some((value) => value !== enginePs))
      throw new Error(`EncarRus displayed-power conflict for ${configKey}: Danawa ICE ${enginePs}; EncarRus ${encarrusEngineValues.join(",")}`);
    if (encarrusEngineValues.length > 1) throw new Error(`EncarRus displayed power is inconsistent for ${configKey}`);
    if (engineValues.length !== 1 || motorValues.length !== 1)
      throw new Error(`Danawa component powers are absent or ambiguous for ${configKey}`);
    for (const listingId of targetGroupIds) {
      if (!source.listingIds.map(String).includes(String(listingId)) || !unresolvedIds.has(String(listingId))) continue;
      const drom = dromByListing.get(String(listingId));
      const dromEngine = drom?.drom?.engineMaxPower?.value;
      if (dromEngine != null && dromEngine !== enginePs)
        throw new Error(`Drom/Danawa engine-power conflict for listing ${listingId}`);
      const customsPowerPs = enginePs + electricMotorPowerPs;
      const calculationPowerKw = Number((kw(enginePs) + kw(electricMotorPowerPs)).toFixed(4));
      entries.push({
        sourceListingId: String(listingId), brand: group.brand, model: group.model, year: group.year,
        engineCc: group.engineCc, driveType: group.driveType, badgeExamples: group.badgeExamples ?? [],
        fuelType: "hybrid", sourceKind: "danawa",
        sourceUrl: `https://auto.danawa.com/auto/?Model=${source.danawaModelCode}&Work=model`,
        sourceTitle: source.danawaTitle, sourceModelCode: source.danawaModelCode,
        sourceNote: `Danawa exact listing-group powertrain: ICE ${enginePs} PS + electric motor peak ${electricMotorPowerPs} PS = ${customsPowerPs} PS; EncarRus displayed power ${encarrusEngineValues.length ? `matches ${enginePs} PS` : "not available"}; Drom engine ${dromEngine ?? "not available"}. Run-scoped preliminary match; not a 30-minute rating.`,
        powerBasis: "parallel_sum", enginePowerPs: enginePs, electricMotorPowerPs,
        electric30MinPs: null, peakOrSystemPowerPs: null, customsPowerPs, calculationPowerKw,
        grade: group.badgeExamples?.join(" / ") ?? null, gradeDetail: null,
        status: "draft_preliminary", runId: RUN_ID,
      });
      included.add(String(listingId));
    }
  }
  const expected = targetIds.size === 20 && entries.length === 16 && included.size === 16 && unresolvedTargets.length === 4
    && new Set(entries.map((entry) => entry.sourceListingId)).size === 16;
  if (!expected || entries.some((entry) => current.entries.some((known) => known.sourceListingId === entry.sourceListingId)))
    throw new Error(`Membership check failed: ${entries.length} generated entries`);
  const manifest = { runId: RUN_ID, generatedAt: new Date().toISOString(), status: "draft_preliminary",
    policy: "Parallel hybrid: TKS components are ICE power plus electric motor power. No 30-minute value is inferred or populated.",
    counts: { configurations: new Set(entries.map((entry) => key(entry as unknown as Group))).size, listings: entries.length }, entries };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (WRITE) await writeFile(OUT, serialized);
  console.log(JSON.stringify({ runId: RUN_ID, configurations: manifest.counts.configurations, listings: entries.length,
    powers: [...new Set(entries.map((entry) => `${entry.enginePowerPs}+${entry.electricMotorPowerPs}=${entry.customsPowerPs}`))],
    output: WRITE ? OUT : null, sha256: createHash("sha256").update(serialized).digest("hex"), write: WRITE,
    notCoveredByExactDanawaRows: unresolvedTargets,
    rows: entries.map((entry) => ({ sourceListingId: entry.sourceListingId, brand: entry.brand, model: entry.model,
      year: entry.year, driveType: entry.driveType, enginePowerPs: entry.enginePowerPs,
      electricMotorPowerPs: entry.electricMotorPowerPs, customsPowerPs: entry.customsPowerPs })) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
