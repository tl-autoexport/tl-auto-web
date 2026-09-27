/** Resolve saved source evidence to exact Encar IDs in the 21a687ee run. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const planPath = "output/tl-auto-electrified-21a687ee-power-plan.json";
const encarrusPath = "output/tl-auto-electrified-encarrus.json";
const dromPath = "data/power/drom-hybrid-preliminary-v1.json";
const dromResearchPath = "output/tl-auto-electrified-21a687ee-drom-hybrid-research.json";
const harPath = "data/power/encarrus-hybrid-har-21a687ee.json";
const decisionsPath = "data/power/electrified-21a687ee-reviewed-decisions.json";
const outputPath = "data/power/electrified-21a687ee-power-reference.json";
const write = process.env.TL_AUTO_ELECTRIFIED_REFERENCE_WRITE === "true";
const PS_TO_KW = 0.73549875;

type Json = Record<string, unknown>;
type Group = { brand: string; model: string; year: number; engineCc: number; fuelType: string; driveType: string | null; listingIds: string[] };
type Card = { trim: string; year: number; driveText: string | null; displayedPowerHp: number | null; displayedPower30MinHp: number | null; url: string };
type Resolved = { sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: "drom" | "encarrus_catalog" | "encarrus_detail_har"; sourceUrl: string; sourceNote: string;
  powerBasis: "parallel_sum" | "electric_30min"; customsPowerPs: number; calculationPowerKw: number;
  enginePowerPs: number | null; electric30MinPs: number; peakOrSystemPowerPs: number | null;
  sourceSpecKey: string | null; grade: string | null; gradeDetail: string | null };
type Unresolved = { sourceListingId: string; fuelType: string; reason: string; candidates30MinPs?: number[] };
type ReviewedDecision = { sourceListingId: string; sourceKind: "drom" | "encarrus_catalog"; sourceUrl: string;
  selectedTrim: string; enginePowerPs: number | null; electric30MinPs: number; peakOrSystemPowerPs: number | null;
  minimumEvidenceCards: number; rationale: string };

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kw = (ps: number) => Number((ps * PS_TO_KW).toFixed(4));
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
function sameGroup(a: Group, b: Group) {
  return a.brand === b.brand && a.model === b.model && a.year === b.year && a.engineCc === b.engineCc &&
    (a.driveType ?? null) === (b.driveType ?? null) && a.fuelType === b.fuelType &&
    a.listingIds.map(String).sort().join(",") === b.listingIds.map(String).sort().join(",");
}
function sourceTrim(card: Card) { return card.trim.replace(/^\d{4}\s*[·:–-]\s*/, "").trim(); }
function gradeMatches(grade: string, trim: string) {
  const g = normalize(grade), t = normalize(trim);
  if (!g) return false;
  // Single-letter grades like Hyundai N must match the whole trim, not N Line.
  return g.length === 1 ? g === t : t.includes(g);
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [plan, enc, drom, har, dromResearch, decisions] = await Promise.all([planPath, encarrusPath, dromPath, harPath, dromResearchPath, decisionsPath]
    .map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  if ([plan.runId, enc.runId, drom.runId, har.runId, dromResearch.summary?.runId, decisions.runId].some((id) => id !== runId))
    throw new Error("Input run IDs differ");
  if (enc.databaseWrites !== 0 || drom.status !== "draft_preliminary_not_approved_for_calculation") throw new Error("Unexpected input status");
  const groups = plan.externalSearch.worklist as Group[];
  const targetIds = groups.flatMap((group) => group.listingIds.map(String));
  if (groups.length !== 131 || targetIds.length !== 244 || new Set(targetIds).size !== 244) throw new Error("Power plan membership changed");
  const groupById = new Map(targetIds.map((id) => [id, groups.find((group) => group.listingIds.includes(id))!]));

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let stageRows: Array<{ source_listing_id: string; status: string; staging_status: string; category: Json }>;
  try {
    await db.query("begin read only");
    stageRows = (await db.query(`select q.source_listing_id,q.status,s.status staging_status,
         s.raw_payload->'detail'->'category' category
       from public.encar_enrichment_queue q join public.encar_enrichment_staging s
         on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
       where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [runId, targetIds])).rows;
    await db.query("rollback");
  } finally { await db.end(); }
  if (stageRows.length !== 244 || stageRows.some((row) => row.status !== "succeeded" || row.staging_status !== "succeeded"))
    throw new Error("Encar staging is incomplete for the plan");
  const stageById = new Map(stageRows.map((row) => [row.source_listing_id, row]));
  const resolved = new Map<string, Resolved>();
  const unresolved: Unresolved[] = [];
  function put(row: Resolved) {
    if (!groupById.has(row.sourceListingId) || resolved.has(row.sourceListingId)) throw new Error(`Duplicate/foreign resolution ${row.sourceListingId}`);
    resolved.set(row.sourceListingId, row);
  }

  for (const entry of drom.rows as Array<Json>) {
    const listingIds = entry.listingIds as string[];
    const powers = obj(entry.powers), source = obj(entry.source);
    for (const id of listingIds) {
      const group = groupById.get(id);
      if (!group || group.fuelType !== "hybrid" || group.brand !== entry.brand || group.model !== entry.model || group.year !== entry.year || group.engineCc !== entry.engineCc)
        throw new Error(`Drom source identity changed for ${id}`);
      const category = obj(stageById.get(id)?.category);
      put({ sourceListingId: id, brand: group.brand, model: group.model, year: group.year, fuelType: "hybrid",
        sourceKind: "drom", sourceUrl: String(source.uri), sourceNote: `Drom ICE + motor 30-minute power; selected trim: ${String(source.trim ?? "unknown")}`,
        powerBasis: "parallel_sum", customsPowerPs: Number(powers.combinedPs), calculationPowerKw: Number(powers.combinedKw),
        enginePowerPs: Number(powers.enginePs), electric30MinPs: Number(powers.electric30MinPs), peakOrSystemPowerPs: null,
        sourceSpecKey: String(entry.specKey), grade: String(category.gradeEnglishName ?? category.gradeName ?? "") || null,
        gradeDetail: String(category.gradeDetailEnglishName ?? category.gradeDetailName ?? "") || null });
    }
  }

  for (const item of har.configurations as Array<Json>) {
    const found = groups.filter((group) => group.brand === item.brand && group.model === item.model && group.year === item.year &&
      group.engineCc === item.engineCc && group.fuelType === "hybrid");
    const ids = found.flatMap((group) => group.listingIds);
    if (ids.length !== item.expectedListings || ids.some((id) => resolved.has(id)) ||
      Number(item.enginePowerPs) + Number(item.derivedElectric30MinPs) !== Number(item.sourceStatedUtilPowerPs))
      throw new Error(`HAR hybrid identity/power mismatch: ${item.sourceUrl}`);
    for (const id of ids) {
      const group = groupById.get(id)!;
      const category = obj(stageById.get(id)?.category);
      const ice = Number(item.enginePowerPs), electric = Number(item.derivedElectric30MinPs);
      put({ sourceListingId: id, brand: group.brand, model: group.model, year: group.year, fuelType: "hybrid",
        sourceKind: "encarrus_detail_har", sourceUrl: String(item.sourceUrl),
        sourceNote: `Source stated recycling-fee power ${item.sourceStatedUtilPowerPs} PS; 30-minute component ${electric} PS derived by subtracting ICE ${ice} PS. ${item.captureFile}`,
        powerBasis: "parallel_sum", customsPowerPs: ice + electric, calculationPowerKw: Number((kw(ice) + kw(electric)).toFixed(4)),
        enginePowerPs: ice, electric30MinPs: electric, peakOrSystemPowerPs: Number(item.systemPowerPs), sourceSpecKey: null,
        grade: String(category.gradeEnglishName ?? category.gradeName ?? "") || null,
        gradeDetail: String(category.gradeDetailEnglishName ?? category.gradeDetailName ?? "") || null });
    }
  }

  for (const decision of decisions.entries as ReviewedDecision[]) {
    const group = groupById.get(decision.sourceListingId);
    if (!group || resolved.has(decision.sourceListingId) || !decision.sourceUrl.startsWith("https://"))
      throw new Error(`Invalid or duplicate reviewed decision: ${decision.sourceListingId}`);
    const category = obj(stageById.get(decision.sourceListingId)?.category);
    if (decision.sourceKind === "drom") {
      const evidence = (dromResearch.results as Array<Json>).find((row) =>
        Array.isArray(row.listingIds) && (row.listingIds as string[]).includes(decision.sourceListingId));
      const spec = obj(evidence?.drom), engine = obj(spec.engineMaxPower), motor30 = obj(spec.motor30minPower);
      if (!evidence || evidence.dromPageStatus !== "ok" || evidence.brand !== group.brand || evidence.model !== group.model ||
          evidence.year !== group.year || evidence.engineCc !== group.engineCc || evidence.driveType !== group.driveType ||
          spec.url !== decision.sourceUrl || spec.trim !== decision.selectedTrim ||
          engine.value !== decision.enginePowerPs || motor30.value !== decision.electric30MinPs ||
          group.fuelType !== "hybrid" || decision.enginePowerPs == null ||
          decision.minimumEvidenceCards !== 1)
        throw new Error(`Drom evidence no longer supports reviewed decision ${decision.sourceListingId}`);
      const combined = decision.enginePowerPs + decision.electric30MinPs;
      put({ sourceListingId: decision.sourceListingId, brand: group.brand, model: group.model, year: group.year,
        fuelType: "hybrid", sourceKind: "drom", sourceUrl: decision.sourceUrl,
        sourceNote: `${decision.rationale}; selected Drom trim: ${decision.selectedTrim}`,
        powerBasis: "parallel_sum", customsPowerPs: combined,
        calculationPowerKw: Number((kw(decision.enginePowerPs) + kw(decision.electric30MinPs)).toFixed(4)),
        enginePowerPs: decision.enginePowerPs, electric30MinPs: decision.electric30MinPs,
        peakOrSystemPowerPs: decision.peakOrSystemPowerPs, sourceSpecKey: `drom-reviewed-${runId.slice(0, 8)}-${decision.sourceListingId}`,
        grade: String(category.gradeEnglishName ?? category.gradeName ?? "") || null,
        gradeDetail: String(category.gradeDetailEnglishName ?? category.gradeDetailName ?? "") || null });
      continue;
    }

    const evidence = (enc.results as Array<{ group: Group; matchedCards: Card[] }>).find((row) =>
      row.group.listingIds.includes(decision.sourceListingId));
    const selectedCards = (evidence?.matchedCards ?? []).filter((card) => card.year === group.year &&
      sourceTrim(card) === decision.selectedTrim && card.url === decision.sourceUrl &&
      card.displayedPowerHp === decision.peakOrSystemPowerPs && card.displayedPower30MinHp === decision.electric30MinPs &&
      (!group.driveType || card.driveText === group.driveType));
    if (!evidence || group.fuelType !== "electric" || decision.enginePowerPs !== null ||
        selectedCards.length < decision.minimumEvidenceCards || decision.minimumEvidenceCards < 1)
      throw new Error(`EncarRus cards no longer support reviewed decision ${decision.sourceListingId}`);
    put({ sourceListingId: decision.sourceListingId, brand: group.brand, model: group.model, year: group.year,
      fuelType: "electric", sourceKind: "encarrus_catalog", sourceUrl: decision.sourceUrl,
      sourceNote: `${decision.rationale}; selected catalog trim: ${decision.selectedTrim}; corroborating cards: ${selectedCards.length}`,
      powerBasis: "electric_30min", customsPowerPs: decision.electric30MinPs,
      calculationPowerKw: kw(decision.electric30MinPs), enginePowerPs: null,
      electric30MinPs: decision.electric30MinPs, peakOrSystemPowerPs: decision.peakOrSystemPowerPs,
      sourceSpecKey: null, grade: String(category.gradeEnglishName ?? category.gradeName ?? "") || decision.selectedTrim,
      gradeDetail: String(category.gradeDetailEnglishName ?? category.gradeDetailName ?? "") || null });
  }

  for (const item of enc.results as Array<{ group: Group; matchedCards: Card[] }>) {
    const group = groups.find((candidate) => sameGroup(candidate, item.group));
    if (!group) throw new Error(`EncarRus group does not belong to run: ${item.group.listingIds.join(",")}`);
    if (group.fuelType !== "electric") continue;
    for (const id of group.listingIds) {
      const category = obj(stageById.get(id)?.category);
      const grade = String(category.gradeEnglishName ?? "").trim();
      const detail = String(category.gradeDetailEnglishName ?? "").trim();
      const powered = (item.matchedCards ?? []).filter((card) => Number.isFinite(card.displayedPower30MinHp) && Number(card.displayedPower30MinHp) > 0);
      if (resolved.has(id)) continue;
      if (!powered.length) { unresolved.push({ sourceListingId: id, fuelType: "electric", reason: "encarrus_card_missing" }); continue; }
      let candidates = powered.filter((card) => gradeMatches(grade, sourceTrim(card)));
      if (group.driveType) candidates = candidates.filter((card) => card.driveText === group.driveType);
      const values = [...new Set(candidates.map((card) => Number(card.displayedPower30MinHp)))];
      if (values.length !== 1) {
        unresolved.push({ sourceListingId: id, fuelType: "electric", reason: values.length ? "multiple_30min_powers_after_grade_match" : "no_card_matching_encar_grade", candidates30MinPs: values });
        continue;
      }
      const peaks = [...new Set(candidates.map((card) => Number(card.displayedPowerHp)).filter((n) => Number.isFinite(n) && n > 0))];
      const sourceUrl = candidates[0]?.url;
      if (!sourceUrl) throw new Error(`Missing source URL for ${id}`);
      put({ sourceListingId: id, brand: group.brand, model: group.model, year: group.year, fuelType: "electric",
        sourceKind: "encarrus_catalog", sourceUrl, sourceNote: `30-minute value matches Encar grade '${grade}'${group.driveType ? ` and drive ${group.driveType}` : ""}; model/year catalog evidence, not same listing ID`,
        powerBasis: "electric_30min", customsPowerPs: values[0], calculationPowerKw: kw(values[0]), enginePowerPs: null,
        electric30MinPs: values[0], peakOrSystemPowerPs: peaks.length === 1 ? peaks[0] : null,
        sourceSpecKey: null, grade: grade || null, gradeDetail: detail || null });
    }
  }
  for (const id of targetIds) if (!resolved.has(id) && !unresolved.some((row) => row.sourceListingId === id))
    unresolved.push({ sourceListingId: id, fuelType: groupById.get(id)!.fuelType, reason: "calculation_power_not_found" });
  if (resolved.size + unresolved.length !== 244) throw new Error("Resolution partition does not cover the power plan");
  const entries = [...resolved.values()].sort((a, b) => a.sourceListingId.localeCompare(b.sourceListingId));
  const report = { runId, generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0, publications: 0,
    sources: { planPath, encarrusPath, dromPath, harPath }, counts: {
      target: 244, drom: entries.filter((row) => row.sourceKind === "drom").length,
      encarrusHar: entries.filter((row) => row.sourceKind === "encarrus_detail_har").length,
      electricCatalog: entries.filter((row) => row.sourceKind === "encarrus_catalog").length,
      unresolved: unresolved.length,
      unresolvedByReason: Object.fromEntries([...new Set(unresolved.map((row) => row.reason))].map((reason) =>
        [reason, unresolved.filter((row) => row.reason === reason).length])),
    }, entries, unresolved: unresolved.sort((a, b) => a.sourceListingId.localeCompare(b.sourceListingId)) };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (write) throw new Error("This script only prepares an auditable reference manifest; use the dedicated draft importer for database writes");
  await writeFile(outputPath, serialized);
  console.log(JSON.stringify({ runId, counts: report.counts, output: outputPath, sha256: sha256(serialized) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
