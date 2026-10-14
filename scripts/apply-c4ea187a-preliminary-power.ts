/**
 * Import the locally retained preliminary power decisions for Encar run c4ea...
 * Rules are listing-scoped, opt-in, and never update cars, calculations,
 * prices, or publication. The 85 recovered EncarRus/Danawa decisions are
 * imported only after reconciling each listing to its saved source report.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import {
  resolveAutomaticPowerReference,
  type AutomaticPowerReferenceRow,
} from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "c4ea187a-437f-42e2-aef0-71bf9a65d6c7";
const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.TL_AUTO_PRELIMINARY_POWER_WRITE === "true";
const planPath = process.env.TL_AUTO_POWER_PLAN ?? `output/tl-auto-new-encar-power-plan-${RUN_ID}.local.json`;
const outputPath = process.env.TL_AUTO_PRELIMINARY_POWER_AUDIT ?? `output/tl-auto-run-${RUN_ID}-preliminary-reference-application.json`;
const base = `output/tl-auto-run-${RUN_ID}`;
const independentPath = `docs/power-independent-18-${RUN_ID}.md`;

type Json = Record<string, unknown>;
type Configuration = {
  brand: string | null; model: string | null; generation?: string | null; trim?: string | null;
  badge?: string | null; fuelType: string | null; driveType?: string | null;
  year: number | null; engineCc: number | null;
};
type Decision = {
  sourceListingId: string; powerPs: number; configuration?: Configuration;
  source?: string; sourceUrl?: string | null; sourceUrls?: string[];
  note?: string; selectionReason?: string; decision?: string;
  originalSourceStatus?: string; originalCandidatePowers?: number[];
  selectedSourceRecord?: Json; evidence?: string; configurationCaveat?: string | null;
  sourceUnit?: string;
};
type PlanRow = { sourceListingId: string; status: string; configuration: Configuration };
type QueueRow = { source_listing_id: string; status: string; candidate_snapshot: Json };
type StageRow = { source_listing_id: string; status: string; raw_payload: Json };
type Ref = AutomaticPowerReferenceRow & {
  note: string; power_hp: number; power_kw: number; year_from: number; year_to: number;
  configuration_key: string; brand: string; model: string; fuel_type: string; engine_cc: number;
  drive_type: string | null; badge: string | null; badge_detail: string | null;
};

const obj = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clean = (v: unknown) => String(v ?? "").trim() || null;
const normalizeFuel = (v: unknown): string | null => {
  const s = norm(v);
  if (/lpg|엘피지|액화석유/.test(s)) return "lpg";
  if (/diesel|경유|디젤/.test(s)) return "diesel";
  if (/gasoline|petrol|휘발유|가솔린/.test(s)) return "gasoline";
  return s || null;
};
const normalizeYear = (v: unknown): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9999 ? Math.floor(n / 100) : Math.floor(n);
};
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

function getDecisions(planById: Map<string, PlanRow>, earlierIds: string[]) {
  const review: Decision[] = [];
  for (let part = 1; part <= 5; part++) {
    const file = `${base}-review-80-decisions-part-${String(part).padStart(2, "0")}.json`;
    const report = JSON.parse(require("node:fs").readFileSync(file, "utf8")) as { runId: string; rows: Decision[] };
    if (report.runId !== RUN_ID) throw new Error(`Wrong run ID in ${file}`);
    review.push(...report.rows);
  }
  const final = require("node:fs").readFileSync(`${base}-remaining-113-decisions.json`, "utf8");
  const finalReport = JSON.parse(final) as { runId: string; rows: Decision[]; earlierPreliminaryIds: string[] };
  if (finalReport.runId !== RUN_ID || finalReport.earlierPreliminaryIds.length !== 164 ||
      earlierIds.length !== 164 || finalReport.earlierPreliminaryIds.some((id, i) => id !== earlierIds[i])) {
    throw new Error("Run ledger's earlier preliminary ID manifest changed");
  }
  review.push(...finalReport.rows);
  const flat = readJsonSync<{ runId: string; rows: Array<{ sourceListingId: string; powerPs: number }> }>(`${base}-review-183-selected.json`);
  const selectedById = new Map(flat.rows.map((row) => [String(row.sourceListingId), Number(row.powerPs)]));
  if (flat.runId !== RUN_ID || review.length !== 183 || new Set(review.map((r) => String(r.sourceListingId))).size !== 183 ||
      selectedById.size !== 183 || review.some((r) => selectedById.get(String(r.sourceListingId)) !== Number(r.powerPs))) {
    throw new Error("The five review parts and final decisions do not reproduce the saved 183-row selection");
  }

  const korexReport = readJsonSync<{ runId: string; results: Array<{ listingIds: string[]; disposition?: { status: string; powerPs?: number; matchedRecords?: Json[] } }> }>(`${base}-korex.json`);
  if (korexReport.runId !== RUN_ID) throw new Error("Korex report run ID mismatch");
  const korex: Decision[] = [];
  for (const group of korexReport.results) {
    if (group.disposition?.status !== "preliminary_candidate") continue;
    const powerPs = Number(group.disposition.powerPs);
    const selectedRecord = (group.disposition.matchedRecords ?? []).find((r) => Number(r.powerPs) === powerPs);
    for (const id of group.listingIds) {
      korex.push({ sourceListingId: String(id), powerPs, source: "Korex Auto saved public inventory",
        sourceUrl: clean(selectedRecord?.url), selectedSourceRecord: selectedRecord,
        selectionReason: "Previously classified as a preliminary candidate in the completed Korex report.",
        sourceUnit: "Korex displayed horsepower; unit not independently certified" });
    }
  }
  if (korex.length !== 25 || new Set(korex.map((x) => x.sourceListingId)).size !== 25) {
    throw new Error(`Expected 25 unique earlier Korex candidates; got ${korex.length}`);
  }

  const markdown = require("node:fs").readFileSync(independentPath, "utf8") as string;
  const independent: Decision[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*\d+\s*\|\s*`(\d+)`\s*\|\s*(.*?)\s*\|\s*\*\*(\d+(?:\.\d+)?)\*\*\s*\|\s*(.*?)\s*\|\s*$/);
    if (!match) continue;
    const urls = [...match[4].matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    independent.push({ sourceListingId: match[1], powerPs: Number(match[3]), source: "Independent Korean-market power research",
      sourceUrls: urls, evidence: `${match[2]} | ${match[4]}`, selectionReason: "Previously selected independent open-source recommendation." });
  }
  if (independent.length !== 18 || new Set(independent.map((x) => x.sourceListingId)).size !== 18) {
    throw new Error(`Expected 18 unique independent recommendations; got ${independent.length}`);
  }

  const recoveredReport = readJsonSync<{
    runId: string;
    count: number;
    rows: Decision[];
  }>(`${base}-recovered-85-decisions.json`);
  if (recoveredReport.runId !== RUN_ID || recoveredReport.count !== 85 ||
      recoveredReport.rows.length !== 85 ||
      new Set(recoveredReport.rows.map((row) => String(row.sourceListingId))).size !== 85) {
    throw new Error("Recovered EncarRus/Danawa report must contain exactly 85 unique rows for this run");
  }
  for (const d of recoveredReport.rows) {
    const evidence = obj(d.selectedSourceRecord);
    const encarrus = obj(evidence.encarrus);
    const danawa = obj(evidence.danawa);
    const ePowers = Array.isArray(encarrus.powers) ? encarrus.powers.map(Number) : [];
    const dPowers = Array.isArray(danawa.powers) ? danawa.powers.map(Number) : [];
    const eSingle = encarrus.classification === "preliminary_candidate" && ePowers.length === 1;
    const dSingle = danawa.classification === "preliminary_candidate" && dPowers.length === 1;
    const agrees = eSingle && dSingle && ePowers[0] === dPowers[0] && Number(d.powerPs) === ePowers[0];
    const eSelected = eSingle && !dSingle && Number(d.powerPs) === ePowers[0];
    const dSelected = dSingle && !eSingle && Number(d.powerPs) === dPowers[0];
    if (!(agrees || eSelected || dSelected)) {
      throw new Error(`Recovered source evidence is not uniquely selectable for ${d.sourceListingId}`);
    }
  }

  const decisions = [...review, ...korex, ...independent, ...recoveredReport.rows];
  const allIds = decisions.map((x) => String(x.sourceListingId));
  if (decisions.length !== 311 || new Set(allIds).size !== 311) throw new Error("Selected decision IDs overlap or count differs from 311");
  for (const d of decisions) {
    const row = planById.get(String(d.sourceListingId));
    if (!row || row.status !== "unmatched") throw new Error(`Selected listing ${d.sourceListingId} is absent or no longer unmatched`);
    d.configuration = row.configuration;
    if (!Number.isFinite(d.powerPs) || d.powerPs <= 0) throw new Error(`Invalid preliminary power for ${d.sourceListingId}`);
  }
  return { decisions, counts: { reviewed183: review.length, earlierKorex25: korex.length, independent18: independent.length, recoveredEncarRusDanawa85: recoveredReport.rows.length } };
}

function readJsonSync<T>(path: string): T {
  return JSON.parse(require("node:fs").readFileSync(path, "utf8")) as T;
}

function toReference(d: Decision, c: Configuration): Ref {
  const brand = clean(c.brand), model = clean(c.model), fuel_type = normalizeFuel(c.fuelType);
  const engine_cc = Number(c.engineCc), year = Number(c.year), power_hp = Number(d.powerPs);
  const drive_type = clean(c.driveType), badge = clean(c.badge), badge_detail = clean(c.trim);
  const id = String(d.sourceListingId);
  if (!brand || !model || !fuel_type || !Number.isInteger(engine_cc) || engine_cc <= 0 || !Number.isInteger(year) || year <= 0 || !/^\d+$/.test(id)) {
    throw new Error(`Required configuration fields missing for ${id}: ${JSON.stringify({ brand, model, fuel_type, engine_cc, year })}`);
  }
  const configuration_key = [norm(brand), norm(model), norm(fuel_type), engine_cc, norm(drive_type), norm(badge), norm(badge_detail), `year=${year}-${year}`, `listing=${id}`].join("|");
  const urls = [...new Set([...(d.sourceUrls ?? []), d.sourceUrl ?? null].filter((x): x is string => Boolean(x && /^https?:\/\//.test(x))))];
  const provenance = [
    `Selected source: ${d.source ?? "earlier EncarRus/Danawa source decision"}.`,
    d.decision ? `Decision: ${d.decision}.` : null,
    d.selectionReason ? `Reason: ${d.selectionReason}` : null,
    d.note ? `Research note: ${d.note}` : null,
    d.evidence ? `Research evidence: ${d.evidence}` : null,
    d.originalSourceStatus ? `Original source status: ${d.originalSourceStatus}.` : null,
    d.originalCandidatePowers?.length ? `Original candidate values: ${d.originalCandidatePowers.join(", ")} PS.` : null,
    d.configurationCaveat ? `Configuration caveat: ${d.configurationCaveat}` : null,
    d.sourceUnit ? `Source unit caveat: ${d.sourceUnit}.` : null,
    d.selectedSourceRecord ? `Selected source record: ${JSON.stringify(d.selectedSourceRecord)}` : null,
    urls.length ? `Evidence URLs: ${urls.join(" | ")}.` : null,
    !urls.length ? "Source output and selection are retained in the run research ledger; the exact source URL was not present in the local saved decision." : null,
  ].filter(Boolean).join(" ");
  const note = `Предварительная мощность для расчёта; не подтверждённая ТКС/ОТТС. Encar run ${RUN_ID}; listing ID ${id}; selected ${power_hp} PS. ${provenance}`;
  return { configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge, badge_detail,
    year_from: year, year_to: year, power_hp, power_kw: Number((power_hp * 0.73549875).toFixed(4)),
    source: "encar_run_c4ea187a_preliminary", status: "automatic", note };
}

async function main() {
  if (runId !== RUN_ID) throw new Error(`Set TL_AUTO_ENRICHMENT_RUN_ID=${RUN_ID}`);
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const plan = await readJson<{ runId: string; candidates: PlanRow[] }>(planPath);
  if (plan.runId !== RUN_ID || plan.candidates.length !== 499) throw new Error("Power plan run/count mismatch");
  const planById = new Map(plan.candidates.map((row) => [String(row.sourceListingId), row]));
  const finalReport = await readJson<{ earlierPreliminaryIds: string[] }>(`${base}-remaining-113-decisions.json`);
  const { decisions, counts } = getDecisions(planById, finalReport.earlierPreliminaryIds);
  const unmatched = plan.candidates.filter((x) => x.status === "unmatched");
  if (unmatched.length !== 347) throw new Error(`Expected 347 unmatched plan rows, got ${unmatched.length}`);
  const uncovered = finalReport.earlierPreliminaryIds.filter((id) => !decisions.some((d) => String(d.sourceListingId) === String(id)));
  if (uncovered.length !== 36) throw new Error(`Expected exactly 36 earlier EncarRus/Danawa IDs already covered by pre-existing references, got ${uncovered.length}`);

  const refs = decisions.map((d) => toReference(d, d.configuration!));
  if (new Set(refs.map((r) => r.configuration_key)).size !== refs.length) throw new Error("Duplicate listing-scoped reference keys");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const ids = decisions.map((d) => String(d.sourceListingId));
    const queueResult = await db.query<QueueRow>(
      `select source_listing_id,status,candidate_snapshot from public.encar_enrichment_queue where run_id=$1 and source_listing_id=any($2::text[])`,
      [RUN_ID, ids],
    );
    const stagingResult = await db.query<StageRow>(
      `select source_listing_id,status,raw_payload from public.encar_enrichment_staging where run_id=$1 and source_listing_id=any($2::text[])`,
      [RUN_ID, ids],
    );
    const liveResult = await db.query<Ref>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8,power_kw::float8,source,status,note from public.vehicle_power_automatic_reference where status <> 'retired'${write ? " for update" : ""}`,
    );
    const queues = new Map(queueResult.rows.map((r) => [String(r.source_listing_id), r]));
    const stages = new Map(stagingResult.rows.map((r) => [String(r.source_listing_id), r]));
    const live = liveResult.rows;
    if (queues.size !== 311 || stages.size !== 311) throw new Error(`Enrichment rows missing: queue=${queues.size}/311, staging=${stages.size}/311`);
    for (const d of decisions) {
      const id = String(d.sourceListingId), q = queues.get(id)!, s = stages.get(id)!;
      if (q.status !== "succeeded" || s.status !== "succeeded") throw new Error(`Enrichment not succeeded for ${id}: ${q.status}/${s.status}`);
      const p = obj(s.raw_payload), detail = obj(p.detail), spec = obj(detail.spec), category = obj(detail.category);
      const actualCc = Number(spec.displacement);
      const actualYear = normalizeYear(q.candidate_snapshot.year ?? category.formYear ?? category.yearMonth ?? detail.year);
      const actualFuel = normalizeFuel(spec.fuelName ?? detail.fuelName ?? d.configuration?.fuelType);
      if (actualCc !== Number(d.configuration?.engineCc) || actualYear !== Number(d.configuration?.year) || actualFuel !== normalizeFuel(d.configuration?.fuelType)) {
        throw new Error(`Plan/staging config mismatch for ${id}: ${JSON.stringify({ plan: d.configuration, actual: { year: actualYear, cc: actualCc, fuel: actualFuel } })}`);
      }
    }

    const proposedByKey = new Map(refs.map((r) => [r.configuration_key, r]));
    const currentByKey = new Map(live.map((r) => [r.configuration_key, r]));
    const conflictingKeys: Array<Record<string, unknown>> = [];
    const effective = refs.filter((r) => {
      const old = currentByKey.get(r.configuration_key);
      if (!old) return true;
      if (old.status !== "automatic" || Number(old.power_hp) !== Number(r.power_hp) || old.source !== r.source) {
        conflictingKeys.push({ key: r.configuration_key, existingStatus: old.status, existingSource: old.source, existingPower: old.power_hp, proposedPower: r.power_hp });
        return false;
      }
      return false;
    });
    if (conflictingKeys.length) throw new Error(`Existing listing-scoped reference conflicts; no write: ${JSON.stringify(conflictingKeys.slice(0, 20))}`);
    const simulated = [...live.filter((r) => !effective.some((x) => x.configuration_key === r.configuration_key)), ...effective];
    const resolverFailures = decisions.flatMap((d) => {
      const c = d.configuration!;
      const resolved = resolveAutomaticPowerReference({ brand: String(c.brand), model: String(c.model), fuel_type: normalizeFuel(c.fuelType), engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge: clean(c.badge), badge_detail: clean(c.trim), year: Number(c.year), source_listing_id: String(d.sourceListingId) }, simulated);
      return Number(resolved?.power_hp) === Number(d.powerPs) ? [] : [{ id: d.sourceListingId, expected: d.powerPs, actual: resolved?.power_hp ?? null }];
    });
    if (resolverFailures.length) throw new Error(`Resolver preflight failed: ${JSON.stringify(resolverFailures.slice(0, 20))}`);

    const proposedIds = new Set(ids);
    const unexpectedEffects = unmatched.filter((row) => !proposedIds.has(String(row.sourceListingId))).flatMap((row) => {
      const c = row.configuration;
      const input = { brand: String(c.brand), model: String(c.model), fuel_type: normalizeFuel(c.fuelType), engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge: clean(c.badge), badge_detail: clean(c.trim), year: Number(c.year), source_listing_id: String(row.sourceListingId) };
      const before = resolveAutomaticPowerReference(input, live), after = resolveAutomaticPowerReference(input, simulated);
      return before?.configuration_key !== after?.configuration_key ? [{ id: row.sourceListingId, before: before?.power_hp ?? null, after: after?.power_hp ?? null }] : [];
    });
    if (unexpectedEffects.length) throw new Error(`Selected rules change ${unexpectedEffects.length} other run listings; refusing: ${JSON.stringify(unexpectedEffects.slice(0, 20))}`);

    const report = {
      generatedAt: new Date().toISOString(), committed: false, write, runId: RUN_ID,
      input: { planUnmatched: 347, stagedSelected: 311, selected: counts, uncoveredEarlierDecisions: uncovered.length, unavailableInRun: 1 },
      referenceRules: refs.length, newReferences: effective.length, alreadyIdentical: refs.length - effective.length,
      resolverVerifiedListings: decisions.length, unaffectedOtherUnmatchedListings: unmatched.length - decisions.length,
      uncoveredEarlierEncarRusDanawaIds: uncovered,
      preliminaryOnly: true, effects: { cars: 0, calculations: 0, prices: 0, publication: 0 },
      limitation: "36 earlier EncarRus/Danawa candidate listings are already resolved by existing references; no new rules are inferred for them.",
    };
    await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ...report, uncoveredEarlierEncarRusDanawaIds: `${uncovered.length} IDs saved in audit file` , auditPath: outputPath }, null, 2));
    if (!write) { await db.query("rollback"); return; }
    if (effective.length) {
      await db.query(`insert into public.vehicle_power_automatic_reference
        (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
        select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
        from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)
        on conflict(configuration_key) do nothing`, [JSON.stringify(effective)]);
    }
    const verifyResult = await db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8,power_kw::float8,source,status,note from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [refs.map((r) => r.configuration_key)]);
    const verified = new Map(verifyResult.rows.map((r) => [r.configuration_key, r]));
    const postFailures = refs.filter((r) => {
      const saved = verified.get(r.configuration_key);
      return !saved || saved.status !== "automatic" || Number(saved.power_hp) !== Number(r.power_hp);
    });
    if (postFailures.length) throw new Error(`Post-insert verification failed for ${postFailures.length} listing rules`);
    const savedResolutionFailures = decisions.flatMap((d) => {
      const c = d.configuration!;
      const resolved = resolveAutomaticPowerReference({ brand: String(c.brand), model: String(c.model), fuel_type: normalizeFuel(c.fuelType), engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge: clean(c.badge), badge_detail: clean(c.trim), year: Number(c.year), source_listing_id: String(d.sourceListingId) }, verifyResult.rows);
      return Number(resolved?.power_hp) === Number(d.powerPs) ? [] : [{ id: d.sourceListingId, expected: d.powerPs, actual: resolved?.power_hp ?? null }];
    });
    if (savedResolutionFailures.length) throw new Error(`Post-insert resolver verification failed: ${JSON.stringify(savedResolutionFailures.slice(0, 20))}`);
    await db.query("commit");
    await writeFile(outputPath, JSON.stringify({ ...report, committed: true }, null, 2) + "\n");
    console.log(JSON.stringify({ committed: true, insertedListingRules: effective.length, alreadyIdentical: refs.length - effective.length, resolverVerifiedListings: decisions.length, preliminaryOnly: true, carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
