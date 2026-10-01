/**
 * Register the user-approved 53 Drom ICE/LPG matches as preliminary automatic
 * references for this Encar run only. Never changes cars, prices or publication.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.DROM_ICE_PRELIMINARY_MANIFEST ?? "data/power/drom-ice-gasd-lpg-201-preliminary-v3.json";
const planPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-gasd-bd5481a2-power-plan.json";
const write = process.env.DROM_ICE_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = "bd5481a2-04a1-458a-810a-30c3ae130fc5";
const PS_TO_KW = 0.73549875;

type Obj = Record<string, unknown>;
type RecordRow = { brand: string; model: string; year: number; engineCc: number; fuelType: string; powerPs: number; listingIds: string[]; sourceUrl: string; note: string };
type PlanRow = { sourceListingId: string; status: string; configuration: Obj };
type Ref = AutomaticPowerReferenceRow & { note: string };
type Queue = { source_listing_id: string; candidate_snapshot: Obj };
type Stage = { source_listing_id: string; raw_payload: Obj };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const normModel = (v: unknown) => norm(v).replace(/[^a-z0-9가-힣]/g, "");
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const keyFor = (x: Omit<Ref, "configuration_key" | "power_hp" | "power_kw" | "source" | "status" | "note">) =>
  [norm(x.brand), norm(x.model), norm(x.fuel_type), x.engine_cc, norm(x.drive_type), norm(x.badge), norm(x.badge_detail), `year=${x.year_from}-${x.year_to}`].join("|");
const sameShape = (a: Ref, b: Ref) => norm(a.brand) === norm(b.brand) && norm(a.model) === norm(b.model) &&
  norm(a.fuel_type) === norm(b.fuel_type) && a.engine_cc === b.engine_cc && norm(a.drive_type) === norm(b.drive_type) &&
  norm(a.badge) === norm(b.badge) && norm(a.badge_detail) === norm(b.badge_detail) && a.year_from === b.year_from && a.year_to === b.year_to;

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string; runIds: string[]; status: string; candidateListingCount: number; records: RecordRow[] };
  const plan = JSON.parse(await readFile(planPath, "utf8")) as { runId: string; candidates: PlanRow[] };
  if (manifest.version !== "drom-ice-gasd-lpg-201-preliminary-v3" || manifest.status !== "preliminary_only_not_approved_tks_evidence" || manifest.candidateListingCount !== 53 || manifest.records.length !== 44 || manifest.runIds.length !== 1 || manifest.runIds[0] !== runId || plan.runId !== runId)
    throw new Error("Unexpected Drom manifest/plan cohort; refusing");
  const ids = manifest.records.flatMap((r) => r.listingIds.map(String));
  if (ids.length !== 53 || new Set(ids).size !== 53) throw new Error(`Expected 53 unique manifest IDs, got ${ids.length}/${new Set(ids).size}`);
  const planById = new Map(plan.candidates.map((row) => [String(row.sourceListingId), row]));
  if (ids.some((id) => planById.get(id)?.status !== "unmatched")) throw new Error("At least one Drom ID is absent or no longer unmatched in power plan");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const queue = await db.query<Queue>(`select source_listing_id,candidate_snapshot from public.encar_enrichment_queue where run_id=$1 and source_listing_id=any($2::text[]) and status='succeeded'`, [runId, ids]);
    const stage = await db.query<Stage>(`select source_listing_id,raw_payload from public.encar_enrichment_staging where run_id=$1 and source_listing_id=any($2::text[]) and status='succeeded'`, [runId, ids]);
    const refsResult = await db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note from public.vehicle_power_automatic_reference where status <> 'retired'${write ? " for update" : ""}`);
    const qById = new Map(queue.rows.map((r) => [String(r.source_listing_id), r]));
    const sById = new Map(stage.rows.map((r) => [String(r.source_listing_id), r]));
    if (qById.size !== 53 || sById.size !== 53) throw new Error(`Enrichment evidence incomplete: queue=${qById.size}/53 staging=${sById.size}/53`);
    const refs = new Map<string, Ref>();
    const idInputs = new Map<string, { input: Parameters<typeof resolveAutomaticPowerReference>[0]; ps: number }>();
    for (const record of manifest.records) for (const id of record.listingIds.map(String)) {
      const planRow = planById.get(id)!; const conf = planRow.configuration;
      const snapshot = qById.get(id)!.candidate_snapshot; const detail = obj(sById.get(id)!.raw_payload?.detail);
      const category = obj(detail.category); const spec = obj(detail.spec);
      const badge = String(conf.badge ?? category.gradeEnglishName ?? category.gradeName ?? "").trim();
      const badgeDetail = String(conf.trim ?? category.gradeDetailEnglishName ?? "").trim() || null;
      const year = Number(conf.year); const cc = Number(conf.engineCc ?? spec.displacement);
      const fuel = norm(conf.fuelType);
      const modelAliasMatches = normModel(conf.model) === normModel(record.model) ||
        (normModel(record.model) === "avante" && normModel(conf.model) === "elantra");
      if (!badge || year !== record.year || cc !== record.engineCc || fuel !== record.fuelType || norm(conf.brand) !== norm(record.brand) || !modelAliasMatches)
        throw new Error(`Drom-to-Encar config mismatch for ${id}: ${JSON.stringify({ brand: conf.brand, model: conf.model, year, cc, fuel, badge })}`);
      // Source naming aliases are possible (e.g. Korea AVANTE vs Encar Elantra);
      // key the rule to the exact Encar plan identity, retaining Drom naming in provenance.
      const base = { brand: String(conf.brand), model: String(conf.model), fuel_type: record.fuelType, engine_cc: record.engineCc,
        drive_type: conf.driveType == null ? null : String(conf.driveType), badge, badge_detail: badgeDetail, year_from: record.year, year_to: record.year };
      const configuration_key = keyFor(base);
      const ref: Ref = { configuration_key, ...base, power_hp: record.powerPs, power_kw: Number((record.powerPs * PS_TO_KW).toFixed(4)), source: "drom_ice_catalog", status: "automatic",
        note: `Предварительная мощность для расчёта; не подтверждённая ТКС/ОТТС. Источник: ${record.sourceUrl}. ${record.note} Drom identity: ${record.brand} ${record.model}; exact Encar identity: ${base.brand} ${base.model}. Encar ID: ${id}.` };
      const prior = refs.get(configuration_key);
      if (prior && (prior.power_hp !== ref.power_hp || !sameShape(prior, ref))) throw new Error(`Conflicting Drom rules for ${configuration_key}`);
      refs.set(configuration_key, ref);
      idInputs.set(id, { input: { brand: base.brand, model: base.model, fuel_type: record.fuelType, engine_cc: record.engineCc,
        drive_type: base.drive_type, badge, badge_detail: badgeDetail, year }, ps: record.powerPs });
      // Explicit snapshot guard: no synthetic or mislinked listing may pass.
      if (!snapshot || !category || Number(spec.displacement) !== record.engineCc) throw new Error(`Invalid staged source details for ${id}`);
    }
    const proposed = [...refs.values()];
    const live = refsResult.rows;
    const conflicts: Array<Record<string, unknown>> = [];
    for (const ref of proposed) {
      for (const old of live.filter((r) => sameShape(r, ref))) {
        if (old.status !== "automatic" || Number(old.power_hp) !== ref.power_hp) conflicts.push({ key: old.configuration_key, status: old.status, source: old.source, existingPs: old.power_hp, proposedPs: ref.power_hp });
      }
    }
    if (conflicts.length) throw new Error(`Existing exact-rule conflicts; no write: ${JSON.stringify(conflicts)}`);
    const combined = [...live.filter((r) => !proposed.some((p) => p.configuration_key === r.configuration_key)), ...proposed];
    const unresolved = [...idInputs].flatMap(([id, target]) => {
      const actual = resolveAutomaticPowerReference(target.input, combined);
      return Number(actual?.power_hp) !== target.ps ? [{ id, proposedPs: target.ps, resolvedPs: actual?.power_hp ?? null, resolvedKey: actual?.configuration_key ?? null, resolvedSource: actual?.source ?? null }] : [];
    });
    if (unresolved.length) throw new Error(`Resolver did not select proposed Drom power; no write: ${JSON.stringify(unresolved)}`);
    const effective = proposed.filter((r) => !live.some((x) => x.configuration_key === r.configuration_key && x.status === "automatic" && Number(x.power_hp) === r.power_hp));
    console.log(JSON.stringify({ write, runId, approvedPreliminaryListings: 53, exactBadgeRules: proposed.length, newOrUpdatedRules: effective.length,
      resolverVerifiedListings: 53, conflicts: 0, effects: { cars: 0, calculations: 0, prices: 0, publication: 0 } }, null, 2));
    if (!write) { await db.query("rollback"); return; }
    if (effective.length) await db.query(`insert into public.vehicle_power_automatic_reference
      (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
      select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
      from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)
      on conflict(configuration_key) do update set power_hp=excluded.power_hp,power_kw=excluded.power_kw,source=excluded.source,note=excluded.note,updated_at=now()
      where vehicle_power_automatic_reference.status='automatic'`, [JSON.stringify(effective)]);
    const verify = await db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [proposed.map((r) => r.configuration_key)]);
    if (verify.rows.length !== proposed.length || [...idInputs].some(([, target]) => Number(resolveAutomaticPowerReference(target.input, verify.rows)?.power_hp) !== target.ps)) throw new Error("Post-write Drom resolver verification failed");
    await db.query("commit");
    console.log(JSON.stringify({ committed: true, verifiedRules: verify.rows.length, coveredListings: 53, preliminaryOnly: true, carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 }));
  } catch (error) { await db.query("rollback").catch(() => undefined); throw error; }
  finally { await db.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
