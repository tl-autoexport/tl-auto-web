/** Apply a saved Encar run's source-reconciled preliminary power decisions.
 * Read-only by default. Writes only listing-scoped automatic power references.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
const write = process.env.TL_AUTO_PRELIMINARY_POWER_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("A UUID TL_AUTO_ENRICHMENT_RUN_ID is required");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const base = `output/tl-auto-run-${runId}`;
const planPath = process.env.TL_AUTO_POWER_PLAN ?? `output/tl-auto-new-encar-power-plan-${runId}.json`;
const reconciliationPath = process.env.TL_AUTO_POWER_RECONCILIATION ?? `${base}-power-source-reconciliation.json`;
const encarrusPath = process.env.TL_AUTO_ENCARRUS_REPORT ?? `${base}-encarrus-ice.json`;
const danawaPath = process.env.TL_AUTO_DANAWA_REPORT ?? `${base}-danawa-power.json`;
const proposalsPath = process.env.TL_AUTO_REMAINING_POWER_PROPOSALS ?? `${base}-remaining-power-proposals.json`;
const auditPath = process.env.TL_AUTO_PRELIMINARY_POWER_AUDIT ?? `${base}-preliminary-reference-application.json`;
const psToKw = 0.73549875;
type Obj = Record<string, unknown>;
type Config = { brand: string; model: string; fuelType: string; engineCc: number; driveType: string | null; badge: string | null; trim: string | null; year: number };
type Decision = { id: string; config: Config; ps: number; source: string; urls: string[]; rationale: string };
type Ref = AutomaticPowerReferenceRow & { note: string; power_hp: number; power_kw: number };
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clean = (v: unknown): string | null => String(v ?? "").trim() || null;
const normalizeFuel = (v: unknown) => {
  const s = norm(v);
  if (/lpg|엘피지|액화석유/.test(s)) return "lpg";
  if (/diesel|경유|디젤/.test(s)) return "diesel";
  if (/gasoline|petrol|휘발유|가솔린/.test(s)) return "gasoline";
  return s;
};
const read = async <T>(p: string) => JSON.parse(await readFile(p, "utf8")) as T;
const configFrom = (v: Obj): Config => {
  const c = obj(v.configuration);
  const brand = clean(c.brand), model = clean(c.model), fuelType = clean(c.fuelType);
  const engineCc = Number(c.engineCc), year = Number(c.year), id = clean(v.sourceListingId);
  if (!brand || !model || !fuelType || !Number.isInteger(engineCc) || engineCc <= 0 || !Number.isInteger(year) || year <= 0 || !/^\d+$/.test(id ?? ""))
    throw new Error(`Incomplete listing configuration: ${id ?? "unknown"}`);
  return { brand, model, fuelType: normalizeFuel(fuelType), engineCc, driveType: clean(c.driveType), badge: clean(c.badge), trim: clean(c.trim), year };
};
const configurationKey = (c: Config, id: string) => [norm(c.brand), norm(c.model), normalizeFuel(c.fuelType), c.engineCc,
  norm(c.driveType), norm(c.badge), norm(c.trim), `year=${c.year}-${c.year}`, `listing=${id}`].join("|");

async function main() {
  const [plan, reconciliation, encarrus, danawa, proposals] = await Promise.all([
    read<{ runId: string; candidates: Array<{ sourceListingId: string; status: string; configuration: Obj }> }>(planPath),
    read<{ runId: string; readOnly: boolean; databaseWrites: number; byListing: Array<{ sourceListingId: string; outcome: string; proposedPower: number | null; configuration: Obj; encarrus: Obj; danawa: Obj }> }>(reconciliationPath),
    read<{ runId: string; results: Array<{ group: Obj; classification: string; suggestedPowerHp?: number; matchedCards?: Array<{ displayedPowerHp?: number; productUrl?: string; modelUrl?: string }> }> }>(encarrusPath),
    read<{ runId: string; results: Array<{ group: Obj; classification: string; suggestedPowerPs?: number; sourceCandidates?: Array<{ powerPs?: number; sourceUrl?: string }> }> }>(danawaPath),
    read<{ runId: string; targetListingCount: number; decisions: Array<{ sourceListingId: string; configuration: Obj; selectedPowerPs: number; status: string; evidence: { type?: string; urls?: string[]; note?: string } }> }>(proposalsPath),
  ]);
  if ([plan.runId, reconciliation.runId, encarrus.runId, danawa.runId, proposals.runId].some((id) => id !== runId) ||
      !reconciliation.readOnly || reconciliation.databaseWrites !== 0 || proposals.targetListingCount !== 500)
    throw new Error("Input run IDs or read-only report guards do not match");

  const resultFor = (report: { results: Array<{ group: Obj; classification: string; suggestedPowerHp?: number; suggestedPowerPs?: number; matchedCards?: Array<{ displayedPowerHp?: number; productUrl?: string; modelUrl?: string }>; sourceCandidates?: Array<{ powerPs?: number; sourceUrl?: string }> }> }, id: string) =>
    report.results.find((r) => Array.isArray(obj(r.group).listingIds) && (obj(r.group).listingIds as unknown[]).map(String).includes(id));
  const candidates = new Map(plan.candidates.map((row) => [String(row.sourceListingId), row]));
  const unmatched = plan.candidates.filter((row) => row.status === "unmatched");
  const decisions: Decision[] = [];
  for (const row of reconciliation.byListing) {
    if (!["both_agree_preliminary", "encarrus_only_preliminary", "danawa_only_preliminary"].includes(row.outcome)) continue;
    const id = String(row.sourceListingId), ps = Number(row.proposedPower), config = configFrom({ sourceListingId: id, configuration: row.configuration });
    // The reconciler stores the selected configuration alongside the listing outcome.
    if (!Number.isFinite(ps) || ps <= 0) throw new Error(`No selected power in source reconciliation for ${id}`);
    const e = resultFor(encarrus, id), d = resultFor(danawa, id);
    const eOk = e?.classification === "preliminary_candidate" && Number(e.suggestedPowerHp) === ps;
    const dOk = d?.classification === "preliminary_candidate" && Number(d.suggestedPowerPs) === ps;
    if (row.outcome === "both_agree_preliminary" ? !(eOk && dOk) : row.outcome === "encarrus_only_preliminary" ? !eOk : !dOk)
      throw new Error(`Source outputs do not support selected ${ps} PS for ${id}`);
    const urls = [...new Set([
      ...(eOk ? (e?.matchedCards ?? []).filter((x) => Number(x.displayedPowerHp) === ps).flatMap((x) => [x.productUrl, x.modelUrl]) : []),
      ...(dOk ? (d?.sourceCandidates ?? []).filter((x) => Number(x.powerPs) === ps).map((x) => x.sourceUrl) : []),
    ].filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x)))];
    if (!urls.length) throw new Error(`Missing source evidence URL for ${id}`);
    decisions.push({ id, config, ps, source: eOk && dOk ? "encarrus_danawa_preliminary" : eOk ? "encarrus_danawa_preliminary" : "encarrus_danawa_preliminary",
      urls, rationale: `Source reconciliation outcome=${row.outcome}; selected ${ps} PS. EncarRus=${String(row.encarrus.classification)} ${JSON.stringify(row.encarrus)}; Danawa=${String(row.danawa.classification)} ${JSON.stringify(row.danawa)}.` });
  }
  if (proposals.decisions.length !== 51) throw new Error(`Expected exactly 51 remaining research proposals, found ${proposals.decisions.length}`);
  for (const item of proposals.decisions) {
    const id = String(item.sourceListingId), config = configFrom({ sourceListingId: id, configuration: item.configuration });
    const ps = Number(item.selectedPowerPs), urls = [...new Set((item.evidence?.urls ?? []).filter((x) => /^https?:\/\//i.test(x)))];
    if (item.status !== "preliminary_proposal" || !Number.isFinite(ps) || ps <= 0 || !urls.length)
      throw new Error(`Invalid or unsupported remaining proposal for ${id}`);
    decisions.push({ id, config, ps, source: "encar_run_open_source_preliminary", urls,
      rationale: `${item.evidence.type ?? "Open-source evidence"}: ${item.evidence.note ?? ""}` });
  }
  const decisionIds = new Set(decisions.map((d) => d.id));
  if (decisions.length !== 110 || decisionIds.size !== 110 || unmatched.length !== 110 ||
      unmatched.some((row) => !decisionIds.has(String(row.sourceListingId))) ||
      decisions.some((d) => candidates.get(d.id)?.status !== "unmatched"))
    throw new Error(`Coverage mismatch: decisions=${decisionIds.size}, unmatched=${unmatched.length}`);
  for (const d of decisions) {
    const planned = candidates.get(d.id)!;
    const c = planned.configuration;
    for (const [key, left, right] of [["brand", norm(d.config.brand), norm(c.brand)], ["model", norm(d.config.model), norm(c.model)],
      ["fuel", normalizeFuel(d.config.fuelType), normalizeFuel(c.fuelType)], ["cc", d.config.engineCc, Number(c.engineCc)],
      ["year", d.config.year, Number(c.year)]] as Array<[string, unknown, unknown]>)
      if (left !== right) throw new Error(`Decision/plan ${key} mismatch for ${d.id}: ${left} != ${right}`);
  }

  const refs: Ref[] = decisions.map((d) => ({
    configuration_key: configurationKey(d.config, d.id), brand: d.config.brand, model: d.config.model,
    fuel_type: normalizeFuel(d.config.fuelType), engine_cc: d.config.engineCc, drive_type: d.config.driveType,
    badge: d.config.badge, badge_detail: d.config.trim, year_from: d.config.year, year_to: d.config.year,
    power_hp: d.ps, power_kw: Number((d.ps * psToKw).toFixed(4)), source: d.source, status: "automatic",
    note: `Предварительная мощность для расчёта; не подтверждённая ТКС/ОТТС. Encar run ${runId}; listing ${d.id}; ${d.ps} PS. ${d.rationale} Evidence: ${d.urls.join(" | ")}`,
  }));
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const ids = decisions.map((d) => d.id);
    const queue = await db.query<{ source_listing_id: string; status: string }>(
      `select source_listing_id,status from public.encar_enrichment_queue where run_id=$1 and source_listing_id=any($2::text[])`, [runId, ids]);
    const stage = await db.query<{ source_listing_id: string; status: string; raw_payload: Obj }>(
      `select source_listing_id,status,raw_payload from public.encar_enrichment_staging where run_id=$1 and source_listing_id=any($2::text[])`, [runId, ids]);
    const allRefs = await db.query<Ref>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note from public.vehicle_power_automatic_reference where status <> 'retired'${write ? " for update" : ""}`);
    if (queue.rowCount !== 110 || stage.rowCount !== 110) throw new Error(`Expected 110 staged rows; got queue=${queue.rowCount}, staging=${stage.rowCount}`);
    if (queue.rows.some((x) => x.status !== "succeeded") || stage.rows.some((x) => x.status !== "succeeded")) throw new Error("Some selected Encar rows are not successfully enriched");
    const qKeys = new Map(allRefs.rows.map((r) => [r.configuration_key, r]));
    const conflicts = refs.flatMap((r) => {
      const prior = qKeys.get(r.configuration_key);
      return prior && (prior.status !== "automatic" || Number(prior.power_hp) !== r.power_hp || prior.source !== r.source)
        ? [{ key: r.configuration_key, status: prior.status, source: prior.source, existingPs: prior.power_hp, proposedPs: r.power_hp }] : [];
    });
    if (conflicts.length) throw new Error(`Conflicting listing-scoped reference rows: ${JSON.stringify(conflicts.slice(0, 10))}`);
    const toWrite = refs.filter((r) => !qKeys.has(r.configuration_key));
    const simulated = [...allRefs.rows, ...toWrite];
    const resolverFailures = decisions.flatMap((d) => {
      const ref = resolveAutomaticPowerReference({ brand: d.config.brand, model: d.config.model, fuel_type: d.config.fuelType,
        engine_cc: d.config.engineCc, drive_type: d.config.driveType, badge: d.config.badge, badge_detail: d.config.trim,
        year: d.config.year, source_listing_id: d.id }, simulated);
      return Number(ref?.power_hp) === d.ps ? [] : [{ id: d.id, expectedPs: d.ps, resolvedPs: ref?.power_hp ?? null }];
    });
    if (resolverFailures.length) throw new Error(`Power resolver preflight failed: ${JSON.stringify(resolverFailures.slice(0, 10))}`);
    const report = { runId, write, matchedApproved: 390, sourceCandidateListings: 59, openSourceProposalListings: 51,
      unmatchedCovered: decisions.length, newListingScopedReferences: toWrite.length,
      alreadyIdentical: refs.length - toWrite.length, resolverVerifiedListings: decisions.length,
      effects: { cars: 0, calculations: 0, prices: 0, publication: 0 } };
    console.log(JSON.stringify(report, null, 2));
    if (!write) { await db.query("rollback"); return; }
    if (toWrite.length) await db.query(`insert into public.vehicle_power_automatic_reference
      (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
      select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
      from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)
      on conflict(configuration_key) do nothing`, [JSON.stringify(toWrite)]);
    const verify = await db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [refs.map((r) => r.configuration_key)]);
    const verified = new Map(verify.rows.map((r) => [r.configuration_key, r]));
    const postFailures = refs.filter((r) => { const v = verified.get(r.configuration_key); return !v || v.status !== "automatic" || Number(v.power_hp) !== r.power_hp; });
    if (postFailures.length) throw new Error(`Post-write verification failed for ${postFailures.length} rules`);
    await db.query("commit");
    await writeFile(auditPath, `${JSON.stringify({ ...report, write: true, committed: true }, null, 2)}\n`);
    console.log(JSON.stringify({ committed: true, inserted: toWrite.length, verified: verify.rowCount, preliminaryOnly: true }));
  } catch (error) { await db.query("rollback").catch(() => undefined); throw error; }
  finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
