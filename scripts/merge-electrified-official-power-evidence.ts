/** Merge reviewed Danawa/OEM evidence into this Encar run's private power reference. */
import { readFile, writeFile } from "node:fs/promises";

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const PLAN_PATH = "output/tl-auto-electrified-21a687ee-power-plan.json";
const REFERENCE_PATH = "data/power/electrified-21a687ee-power-reference.json";
const DANAWA_PATH = "data/power/electrified-21a687ee-hybrid-motor-candidates.json";
const OFFICIAL_PATH = "data/power/electrified-21a687ee-official-decisions.json";
const KW_PER_PS = 0.73549875;
const PS_PER_KW = 1 / KW_PER_PS;

type Config = { brand: string; model: string; generation?: string | null; year: number; engineCc?: number;
  fuelType: "hybrid" | "electric"; driveType?: string | null; trim?: string | null; badge?: string | null; listingIds?: string[] };
type OfficialDecision = { listingIds: string[]; brand: string; model: string; generation?: string; engineCc?: number;
  fuelType: "hybrid" | "electric"; yearFrom: number; yearTo: number; sourceUrl: string; sourceTitle: string;
  enginePowerPs?: number; electricMotorPowerKw?: number; electric30MinKw?: number; systemPowerPs?: number | null;
  peakOrSystemPowerPs?: number | null; grade: string; rationale: string };
type Entry = Record<string, unknown> & { sourceListingId: string; fuelType: string; sourceKind: string };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const generationKey = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/\s*lci\b/g, "").replace(/[^a-z0-9]/g, "");
const kwFromPs = (ps: number) => Number((ps * KW_PER_PS).toFixed(4));
const psFromKw = (kw: number) => Number((kw * PS_PER_KW).toFixed(4));
async function read<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

async function main() {
  const [plan, reference, danawa, official] = await Promise.all([
    read<{ runId: string; externalSearch: { worklist: Config[] } }>(PLAN_PATH),
    read<{ runId: string; entries: Entry[]; unresolved: Array<{ sourceListingId: string; fuelType: string; reason: string; [key: string]: unknown }>;
      counts: Record<string, unknown>; sources: Record<string, string> }>(REFERENCE_PATH),
    read<{ runId: string; status: string; counts: { listings: number }; entries: Array<Record<string, unknown> & {
      sourceListingId: string; fuelType: string; sourceKind: string; enginePowerPs: number; electricMotorPowerPs: number;
      calculationPowerKw: number; customsPowerPs: number; electric30MinPs: null; sourceUrl: string; sourceNote: string; grade: string | null;
      gradeDetail?: string | null }> }>(DANAWA_PATH),
    read<{ runId: string; status: string; entries: OfficialDecision[] }>(OFFICIAL_PATH),
  ]);
  if ([plan.runId, reference.runId, danawa.runId, official.runId].some((id) => id !== RUN_ID) ||
      danawa.status !== "draft_preliminary" || official.status !== "draft_preliminary" || reference.entries.length + reference.unresolved.length !== 244)
    throw new Error("Run, input status or current reference membership mismatch");

  const groupById = new Map<string, Config>();
  for (const group of plan.externalSearch.worklist) for (const rawId of group.listingIds ?? []) {
    const id = String(rawId);
    if (groupById.has(id)) throw new Error(`Duplicate ID in power plan: ${id}`);
    groupById.set(id, group);
  }
  const unresolvedById = new Map(reference.unresolved.map((row) => [String(row.sourceListingId), row]));
  const entryById = new Map(reference.entries.map((row) => [String(row.sourceListingId), row]));
  if (groupById.size !== 244 || unresolvedById.size !== 54 || entryById.size !== reference.entries.length)
    throw new Error("Unexpected source-plan partition");

  const invalidLegacyHybridIds = ["42775951", "42775980"];
  for (const id of invalidLegacyHybridIds) {
    const prior = entryById.get(id);
    if (!prior || prior.fuelType !== "hybrid" || prior.sourceKind !== "drom" ||
        prior.electricMotorPowerPs != null || Number(prior.electric30MinPs) !== 14)
      throw new Error(`Expected legacy 30-minute-only hybrid evidence not found for ${id}`);
    entryById.delete(id);
    unresolvedById.set(id, { sourceListingId: id, fuelType: "hybrid", reason: "hybrid_motor_peak_power_not_found",
      note: "Saved Drom value is electric-motor 30-minute power; parallel-hybrid TKS matching requires the motor's rated peak output." });
  }

  const added = new Map<string, Entry>();
  function assertTarget(id: string, fuelType: "hybrid" | "electric", brand: string, model: string, yearFrom: number, yearTo: number,
    engineCc?: number, generation?: string) {
    const group = groupById.get(id), unresolved = unresolvedById.get(id);
    if (!group || !unresolved || group.fuelType !== fuelType || group.brand !== brand || group.model !== model ||
        group.year < yearFrom || group.year > yearTo || (generation && group.generation &&
          generationKey(group.generation) !== generationKey(generation)) ||
        (engineCc && group.engineCc !== engineCc))
      throw new Error(`Source decision does not strictly map to unresolved listing ${id}`);
    if (added.has(id) || entryById.has(id)) throw new Error(`Duplicate power evidence: ${id}`);
    return group;
  }

  let danawaCount = 0;
  const danawaExcludedIds = new Set(["42773175", "42776683"]); // Current GN7 Hybrid source pages disagree on motor rating.
  for (const row of danawa.entries) {
    const id = String(row.sourceListingId);
    if (!unresolvedById.has(id) || danawaExcludedIds.has(id)) continue;
    const group = assertTarget(id, "hybrid", String(row.brand), String(row.model), Number(row.year), Number(row.year), Number(row.engineCc));
    const enginePs = Number(row.enginePowerPs), motorPs = Number(row.electricMotorPowerPs);
    if (row.sourceKind !== "danawa" || !String(row.sourceUrl).startsWith("https://auto.danawa.com/") ||
        row.electric30MinPs !== null || !Number.isFinite(enginePs) || !Number.isFinite(motorPs) ||
        Number(row.customsPowerPs) !== Number((enginePs + motorPs).toFixed(4)) ||
        Math.abs(Number(row.calculationPowerKw) - Number((kwFromPs(enginePs) + kwFromPs(motorPs)).toFixed(4))) > 0.0001)
      throw new Error(`Danawa component-power validation failed for ${id}`);
    added.set(id, { sourceListingId: id, brand: group.brand, model: group.model, year: group.year,
      fuelType: "hybrid", sourceKind: "danawa", sourceUrl: String(row.sourceUrl),
      sourceNote: `${String(row.sourceNote)} Run-scoped preliminary evidence; peak motor power is used; no hybrid 30-minute value is used.`,
      powerBasis: "parallel_sum", customsPowerPs: Number(row.customsPowerPs),
      calculationPowerKw: Number(row.calculationPowerKw), enginePowerPs: enginePs,
      electricMotorPowerPs: motorPs, electricMotorPowerKw: kwFromPs(motorPs), electric30MinPs: null,
      electric30MinKw: null, peakOrSystemPowerPs: row.peakOrSystemPowerPs ?? null,
      sourceSpecKey: `danawa-hybrid-motor-${RUN_ID.slice(0, 8)}-${id}`,
      grade: row.grade ?? group.trim ?? group.badge ?? null, gradeDetail: row.gradeDetail ?? null });
    danawaCount++;
  }
  if (danawaCount !== 14) throw new Error(`Expected 14 unresolved Danawa motor-power rows; found ${danawaCount}`);

  for (const decision of official.entries) {
    if (!Array.isArray(decision.listingIds) || !decision.listingIds.length || !decision.sourceUrl.startsWith("https://"))
      throw new Error("Malformed official decision");
    for (const rawId of decision.listingIds) {
      const id = String(rawId);
      const group = assertTarget(id, decision.fuelType, decision.brand, decision.model, decision.yearFrom, decision.yearTo,
        decision.engineCc, decision.generation);
      if (decision.fuelType === "hybrid") {
        const enginePs = Number(decision.enginePowerPs), motorKw = Number(decision.electricMotorPowerKw);
        if (!Number.isFinite(enginePs) || enginePs <= 0 || !Number.isFinite(motorKw) || motorKw <= 0 ||
            decision.electric30MinKw != null)
          throw new Error(`Hybrid must have ICE + peak motor, not 30-minute power: ${id}`);
        const motorPs = psFromKw(motorKw);
        added.set(id, { sourceListingId: id, brand: group.brand, model: group.model, year: group.year,
          fuelType: "hybrid", sourceKind: "official_manufacturer", sourceUrl: decision.sourceUrl,
          sourceNote: `${decision.sourceTitle}. ${decision.rationale} Manufacturer-level powertrain match to the saved Encar configuration; preliminary/run-scoped. TKS components: ICE ${enginePs} PS + peak motor ${motorKw} kW. No 30-minute hybrid value used.`,
          powerBasis: "parallel_sum", customsPowerPs: Number((enginePs + motorPs).toFixed(4)),
          calculationPowerKw: Number((kwFromPs(enginePs) + motorKw).toFixed(4)), enginePowerPs: enginePs,
          electricMotorPowerPs: motorPs, electricMotorPowerKw: motorKw, electric30MinPs: null,
          electric30MinKw: null, peakOrSystemPowerPs: decision.systemPowerPs ?? null, sourceSpecKey: null,
          grade: decision.grade, gradeDetail: null });
      } else {
        const motor30Kw = Number(decision.electric30MinKw);
        if (!Number.isFinite(motor30Kw) || motor30Kw <= 0 || decision.enginePowerPs != null || decision.electricMotorPowerKw != null)
          throw new Error(`EV must have a 30-minute power value only: ${id}`);
        added.set(id, { sourceListingId: id, brand: group.brand, model: group.model, year: group.year,
          fuelType: "electric", sourceKind: "official_manufacturer", sourceUrl: decision.sourceUrl,
          sourceNote: `${decision.sourceTitle}. ${decision.rationale} Official 30-minute EV power; preliminary/run-scoped.`,
          powerBasis: "electric_30min", customsPowerPs: psFromKw(motor30Kw), calculationPowerKw: motor30Kw,
          enginePowerPs: null, electricMotorPowerPs: null, electricMotorPowerKw: null,
          electric30MinPs: psFromKw(motor30Kw), electric30MinKw: motor30Kw,
          peakOrSystemPowerPs: decision.peakOrSystemPowerPs ?? null, sourceSpecKey: null,
          grade: decision.grade, gradeDetail: null });
      }
    }
  }
  if (official.entries.length !== 18 || [...added.values()].filter((row) => row.sourceKind === "official_manufacturer").length !== 34 || added.size !== 48)
    throw new Error(`Expected 34 OEM and 14 Danawa decisions; got ${JSON.stringify({ officialGroups: official.entries.length, added: added.size })}`);

  const sourceCovered = [...added.keys()];
  for (const id of sourceCovered) unresolvedById.delete(id);
  const entries = [...entryById.values(), ...added.values()].sort((a, b) => a.sourceListingId.localeCompare(b.sourceListingId));
  const unresolved = [...unresolvedById.values()].sort((a, b) => String(a.sourceListingId).localeCompare(String(b.sourceListingId)));
  if (entries.length !== 236 || unresolved.length !== 8 || entries.length + unresolved.length !== 244 ||
      new Set(entries.map((row) => row.sourceListingId)).size !== entries.length ||
      new Set(unresolved.map((row) => row.sourceListingId)).size !== unresolved.length)
    throw new Error(`Final reference partition failed: ${entries.length} entries / ${unresolved.length} unresolved`);

  const next = { ...reference, generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0, publications: 0,
    sources: { ...reference.sources, danawaMotorPath: DANAWA_PATH, officialDecisionsPath: OFFICIAL_PATH },
    counts: { ...reference.counts, target: 244,
      drom: entries.filter((row) => row.sourceKind === "drom").length,
      encarrusHar: entries.filter((row) => row.sourceKind === "encarrus_detail_har").length,
      electricCatalog: entries.filter((row) => row.sourceKind === "encarrus_catalog").length,
      danawa: entries.filter((row) => row.sourceKind === "danawa").length,
      officialManufacturer: entries.filter((row) => row.sourceKind === "official_manufacturer").length,
      unresolved: unresolved.length,
      unresolvedByReason: Object.fromEntries([...new Set(unresolved.map((row) => String(row.reason)))].map((reason) =>
        [reason, unresolved.filter((row) => String(row.reason) === reason).length])) }, entries, unresolved };
  await writeFile(REFERENCE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify({ runId: RUN_ID, removedInvalid30MinOnlyHybrids: invalidLegacyHybridIds,
    leftUnresolvedBecauseOfSourceConflict: [...danawaExcludedIds],
    added: { total: added.size, danawa: danawaCount,
      officialManufacturer: [...added.values()].filter((row) => row.sourceKind === "official_manufacturer").length,
      hybrid: [...added.values()].filter((row) => row.fuelType === "hybrid").length,
      electric: [...added.values()].filter((row) => row.fuelType === "electric").length },
    entries: entries.length, unresolved: unresolved.length,
    unresolvedByReason: next.counts.unresolvedByReason, output: REFERENCE_PATH, databaseWrites: 0, publications: 0 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
