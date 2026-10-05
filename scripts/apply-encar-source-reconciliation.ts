/**
 * Register unique EncarRus/Danawa candidates from one Encar run as preliminary
 * automatic power references. It never changes cars, calculations, prices or
 * publication. Writes are opt-in through TL_AUTO_SOURCE_RECONCILIATION_WRITE.
 */
import { Client } from "pg";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import {
  resolveAutomaticPowerReference,
  type AutomaticPowerReferenceRow,
} from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
if (!runId) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID is required");
const planPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const reconciliationPath = process.env.TL_AUTO_SOURCE_RECONCILIATION ??
  `output/tl-auto-run-${runId}-source-reconciliation.json`;
const write = process.env.TL_AUTO_SOURCE_RECONCILIATION_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const psToKw = 0.73549875;
const eligibleOutcomes = new Set([
  "both_agree_preliminary",
  "encarrus_only_preliminary",
  "danawa_only_preliminary",
]);

type Obj = Record<string, unknown>;
type Config = {
  brand?: string | null;
  model?: string | null;
  generation?: string | null;
  trim?: string | null;
  badge?: string | null;
  year?: number | null;
  engineCc?: number | null;
  fuelType?: string | null;
  driveType?: string | null;
};
type ReconciledRow = {
  sourceListingId: string;
  configuration: Config;
  outcome: string;
  powerPs: number | null;
  encarrus: { status: string; powers: number[]; uniqueCandidate: boolean; evidence: Array<{ power: unknown; trim: unknown; url: unknown }> } | null;
  danawa: { status: string; powers: number[]; uniqueCandidate: boolean; evidence: Array<{ power: unknown; trim: unknown; url: unknown }> } | null;
};
type Plan = { runId: string; candidates: Array<{ sourceListingId: string; status: string; configuration: Config }> };
type Reference = AutomaticPowerReferenceRow & { note: string };
type StoredListing = {
  source_listing_id: string;
  queue_status: string;
  staging_status: string;
  candidate_snapshot: Obj;
  raw_payload: Obj;
};

const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value)
  ? value as Obj : {};
const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clean = (value: unknown) => String(value ?? "").trim() || null;
const normalizeFuel = (value: unknown): string | null => {
  const text = norm(value);
  if (/lpg|엘피지|액화석유|газ/.test(text)) return "lpg";
  if (/diesel|경유|디젤|диз/.test(text)) return "diesel";
  if (/gasoline|petrol|휘발유|가솔린|бенз/.test(text)) return "gasoline";
  return text || null;
};
const normalizeYear = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9999 ? Math.floor(n / 100) : Math.floor(n);
};
const referenceKey = (row: Omit<Reference, "configuration_key" | "power_hp" | "power_kw" | "source" | "status" | "note">, listingId?: string) =>
  [norm(row.brand), norm(row.model), norm(row.fuel_type), row.engine_cc, norm(row.drive_type),
    norm(row.badge), norm(row.badge_detail), `year=${row.year_from}-${row.year_to}`,
    ...(listingId ? [`listing=${listingId}`] : [])].join("|");
const sameShape = (a: Reference, b: Reference) =>
  norm(a.brand) === norm(b.brand) && norm(a.model) === norm(b.model) &&
  norm(a.fuel_type) === norm(b.fuel_type) && a.engine_cc === b.engine_cc &&
  norm(a.drive_type) === norm(b.drive_type) && norm(a.badge) === norm(b.badge) &&
  norm(a.badge_detail) === norm(b.badge_detail) && a.year_from === b.year_from && a.year_to === b.year_to;
const configKey = (c: Config) => [c.brand, c.model, c.generation, c.trim, c.badge, c.year, c.engineCc, c.fuelType, c.driveType].map(norm).join("|");

function makeReferences(rows: ReconciledRow[], planById: Map<string, Plan["candidates"][number]>) {
  const candidates = rows.filter((row) => eligibleOutcomes.has(row.outcome));
  const selected = candidates;
  const ids = candidates.map((row) => String(row.sourceListingId));
  if (ids.length !== 90 || new Set(ids).size !== 90) {
    throw new Error(`Expected 90 unique preliminary listings from reconciliation, got ${ids.length}/${new Set(ids).size}`);
  }

  const excluded: ReconciledRow[] = [];
  const grouped = new Map<string, { config: Config; powerPs: number; rows: ReconciledRow[] }>();
  for (const row of selected) {
    const planRow = planById.get(String(row.sourceListingId));
    if (!planRow || planRow.status !== "unmatched") throw new Error(`Listing ${row.sourceListingId} is absent or no longer unmatched in power plan`);
    const c = planRow.configuration;
    const powerPs = Number(row.powerPs);
    if (!Number.isInteger(powerPs) || powerPs <= 0 || row.configuration == null || configKey(c) !== configKey(row.configuration)) {
      throw new Error(`Invalid/mismatched reconciled power configuration for ${row.sourceListingId}`);
    }
    if (row.outcome === "both_agree_preliminary" &&
        (!row.encarrus?.uniqueCandidate || !row.danawa?.uniqueCandidate || row.encarrus.powers[0] !== powerPs || row.danawa.powers[0] !== powerPs)) {
      throw new Error(`Both-source agreement guard failed for ${row.sourceListingId}`);
    }
    if (row.outcome === "encarrus_only_preliminary" &&
        (!row.encarrus?.uniqueCandidate || row.encarrus.powers[0] !== powerPs || (row.danawa?.powers.length ?? 0) !== 0)) {
      throw new Error(`EncarRus-only candidate guard failed for ${row.sourceListingId}`);
    }
    if (row.outcome === "danawa_only_preliminary" &&
        (!row.danawa?.uniqueCandidate || row.danawa.powers[0] !== powerPs || (row.encarrus?.powers.length ?? 0) !== 0)) {
      throw new Error(`Danawa-only candidate guard failed for ${row.sourceListingId}`);
    }

    const key = configKey(c);
    const prior = grouped.get(key);
    if (prior && prior.powerPs !== powerPs) throw new Error(`Conflicting powers for one exact Encar configuration: ${key}`);
    grouped.set(key, { config: c, powerPs, rows: [...(prior?.rows ?? []), row] });
  }

  const proposed: Reference[] = [];
  const targetInputs = new Map<string, { input: Parameters<typeof resolveAutomaticPowerReference>[0]; powerPs: number }>();
  for (const { config: c, powerPs, rows: groupRows } of grouped.values()) {
    const representative = groupRows[0];
    const sourceTypes = [...new Set(groupRows.flatMap((row) => [
      row.encarrus?.uniqueCandidate ? "EncarRus" : null,
      row.danawa?.uniqueCandidate ? "Danawa" : null,
    ].filter((value): value is string => Boolean(value))))];
    const evidenceUrls = [...new Set(groupRows.flatMap((row) => [
      ...(row.encarrus?.evidence ?? []), ...(row.danawa?.evidence ?? []),
    ].map((evidence) => clean(evidence.url)).filter((url): url is string => Boolean(url && /^https?:\/\//i.test(url)))))];
    if (!evidenceUrls.length) throw new Error(`No source URL in accepted evidence for ${groupRows.map((row) => row.sourceListingId).join(",")}`);

    const badge = clean(c.badge);
    const badgeDetail = clean(c.trim);
    // Avoid a broad wildcard rule when Encar supplied neither grade field.
    const needsListingScope = !badge && !badgeDetail;
    const idsForRules = needsListingScope ? groupRows : [representative];
    for (const row of idsForRules) {
      const listingId = String(row.sourceListingId);
      const base = {
        brand: clean(c.brand), model: clean(c.model), fuel_type: normalizeFuel(c.fuelType),
        engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge, badge_detail: badgeDetail,
        year_from: Number(c.year), year_to: Number(c.year),
      };
      if (!base.brand || !base.model || !base.fuel_type || !Number.isInteger(base.engine_cc) || base.engine_cc <= 0 ||
          !Number.isInteger(base.year_from) || base.year_from <= 0) {
        throw new Error(`Required power reference fields missing for ${listingId}: ${JSON.stringify(base)}`);
      }
      const configuration_key = referenceKey(base, needsListingScope ? listingId : undefined);
      const source = sourceTypes.length > 1 ? "encarrus_danawa_preliminary" : sourceTypes[0] === "EncarRus"
        ? "encarrus_ice_catalog" : "danawa_public_specs";
      const note = [
        "Предварительная мощность для расчёта, не подтверждённая мощность ТКС/ОТТС.",
        `Sources: ${sourceTypes.join(" + ")}.`,
        `Candidate power: ${powerPs} PS.`,
        `Encar run: ${runId}; listing IDs: ${groupRows.map((item) => item.sourceListingId).join(", ")}.`,
        `Exact Encar badge/trim: ${badge ?? "(empty)"} / ${badgeDetail ?? "(empty)"}.`,
        `Evidence URLs: ${evidenceUrls.join(" | ")}.`,
      ].join(" ");
      const ref: Reference = {
        configuration_key, ...base, power_hp: powerPs,
        power_kw: Number((powerPs * psToKw).toFixed(4)), source, status: "automatic", note,
      };
      const existingProposed = proposed.find((old) => old.configuration_key === ref.configuration_key);
      if (existingProposed && (Number(existingProposed.power_hp) !== powerPs || !sameShape(existingProposed, ref))) {
        throw new Error(`Conflicting proposed references for ${configuration_key}`);
      }
      if (!existingProposed) proposed.push(ref);
    }

    for (const row of groupRows) {
      const id = String(row.sourceListingId);
      targetInputs.set(id, {
        input: {
          brand: String(c.brand), model: String(c.model), fuel_type: normalizeFuel(c.fuelType),
          engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge, badge_detail: badgeDetail,
          year: Number(c.year), source_listing_id: id,
        },
        powerPs,
      });
    }
  }
  return { selected, excluded, proposed, targetInputs, configurationCount: grouped.size };
}

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const [plan, reconciliation] = await Promise.all([
    readFile(planPath, "utf8").then((value) => JSON.parse(value) as Plan),
    readFile(reconciliationPath, "utf8").then((value) => JSON.parse(value) as { runId: string; readOnly: boolean; databaseWrites: number; rows: ReconciledRow[] }),
  ]);
  if (plan.runId !== runId || reconciliation.runId !== runId || reconciliation.readOnly !== true || reconciliation.databaseWrites !== 0) {
    throw new Error("Run ID or read-only reconciliation guard failed");
  }
  const planById = new Map(plan.candidates.map((row) => [String(row.sourceListingId), row]));
  const built = makeReferences(reconciliation.rows, planById);
  if (built.selected.length !== 90 || built.configurationCount !== 88 || built.proposed.length < 88 || built.proposed.length > 90) {
    throw new Error(`Expected 90 preliminary listings/88 Encar configurations, got ${built.selected.length}/${built.configurationCount} and ${built.proposed.length} reference rules`);
  }

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const ids = built.selected.map((row) => String(row.sourceListingId));
    const [sourceRows, liveResult] = await Promise.all([
      db.query<StoredListing>(
        `select q.source_listing_id,q.status as queue_status,s.status as staging_status,
                q.candidate_snapshot,s.raw_payload
           from public.encar_enrichment_queue q
           join public.encar_enrichment_staging s
             on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
          where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [runId, ids]),
      db.query<Reference>(
        `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
                year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note
           from public.vehicle_power_automatic_reference where status <> 'retired'${write ? " for update" : ""}`),
    ]);
    const storedById = new Map(sourceRows.rows.map((row) => [String(row.source_listing_id), row]));
    if (storedById.size !== 90) throw new Error(`Encar queue/staging evidence incomplete: ${storedById.size}/90 listings`);
    for (const id of ids) {
      const stored = storedById.get(id)!;
      if (stored.queue_status !== "succeeded" || stored.staging_status !== "succeeded") {
        throw new Error(`Encar enrichment is not succeeded for ${id}: queue=${stored.queue_status}, staging=${stored.staging_status}`);
      }
      const planRow = planById.get(id)!;
      const config = planRow.configuration;
      const payload = obj(stored.raw_payload);
      const detail = obj(payload.detail);
      const category = obj(detail.category);
      const spec = obj(detail.spec);
      const actualCc = Number(spec.displacement);
      const actualYear = normalizeYear(stored.candidate_snapshot.year ?? category.formYear ?? category.yearMonth ?? detail.year);
      const actualFuel = normalizeFuel(spec.fuelName ?? detail.fuelName ?? stored.candidate_snapshot.fuelType);
      if (actualCc !== Number(config.engineCc) || actualYear !== Number(config.year) || actualFuel !== normalizeFuel(config.fuelType)) {
        throw new Error(`Encar queue/staging configuration mismatch for ${id}: ${JSON.stringify({ plan: { year: config.year, cc: config.engineCc, fuel: config.fuelType }, actual: { year: actualYear, cc: actualCc, fuel: actualFuel } })}`);
      }
    }

    const live = liveResult.rows;
    const existingReferenceDecisions = new Map<string, { power: number; source: string; note: string }>([
      ["42837452", { power: 252, source: "manual_web_research_0358", note: "Official Genesis source retained; EncarRus 255 PS candidate declined" }],
      ["42444571", { power: 381, source: "carpoint_one", note: "Existing CarPoint reference retained; Danawa 6250 PS candidate rejected as invalid" }],
      ["42824478", { power: 308, source: "carpoint_one", note: "Existing CarPoint reference retained over conflicting EncarRus candidate" }],
      ["42782354", { power: 75, source: "engine_fallback", note: "Existing engine fallback reference retained over conflicting EncarRus candidate" }],
      ["42089782", { power: 202, source: "carpoint_one", note: "Existing CarPoint reference retained over conflicting Danawa candidate" }],
    ]);
    const deferredReasons = new Map<string, Record<string, unknown>>();
    const blockedConfigurations = new Set<string>();
    const acceptedExisting: Array<{ row: ReconciledRow; reference: Reference }> = [];
    for (const row of built.selected) {
      const id = String(row.sourceListingId);
      const target = built.targetInputs.get(id)!;
      const existing = resolveAutomaticPowerReference(target.input, live);
      const c = row.configuration;
      const sameReferences = live.filter((ref) =>
        norm(ref.brand) === norm(c.brand) && norm(ref.model) === norm(c.model) &&
        norm(ref.fuel_type) === normalizeFuel(c.fuelType) && Number(ref.engine_cc) === Number(c.engineCc) &&
        norm(ref.drive_type) === norm(c.driveType) && norm(ref.badge) === norm(c.badge) &&
        norm(ref.badge_detail) === norm(c.trim) && Number(ref.year_from) === Number(c.year) &&
        Number(ref.year_to) === Number(c.year) &&
        (!ref.configuration_key.includes("|listing=") || ref.configuration_key.endsWith(`|listing=${id}`)));
      const decision = existingReferenceDecisions.get(id);
      if (decision) {
        const resolvedReference = existing ? live.find((ref) => ref.configuration_key === existing.configuration_key) : undefined;
        const retained = sameReferences.find((ref) => Number(ref.power_hp) === decision.power &&
          ref.source === decision.source && (ref.status === "automatic" || ref.status === "confirmed")) ??
          (resolvedReference && Number(resolvedReference.power_hp) === decision.power &&
            resolvedReference.source === decision.source && (resolvedReference.status === "automatic" ||
              resolvedReference.status === "confirmed") ? resolvedReference : undefined);
        if (!retained) throw new Error(`Expected retained reference missing for reviewed listing ${id}`);
        if (id === "42837452" && (!retained.note.includes("newsroom.genesis.com") ||
            target.powerPs !== 255 || norm(c.brand) !== "genesis" || norm(c.model) !== "g70")) {
          throw new Error("Genesis official-source decision guard failed for listing 42837452");
        }
        if (id === "42444571" && target.powerPs !== 6250 || id === "42824478" && target.powerPs !== 312 ||
            id === "42782354" && target.powerPs !== 76 || id === "42089782" && target.powerPs !== 194) {
          throw new Error(`Expected source conflict changed for reviewed listing ${id}`);
        }
        target.powerPs = decision.power;
        acceptedExisting.push({ row, reference: retained });
        continue;
      }
      const disagreeing = sameReferences.find((ref) => Number(ref.power_hp) !== target.powerPs ||
        ref.status !== "automatic" && ref.status !== "confirmed");
      if (target.powerPs > 1500 || disagreeing || existing && Number(existing.power_hp) !== target.powerPs) {
        blockedConfigurations.add(configKey(c));
        const prior = disagreeing ?? existing;
        deferredReasons.set(id, {
          reason: target.powerPs > 1500 ? "implausible ICE power; source parsing requires review" : "existing reference disagrees with source evidence",
          proposedPower: target.powerPs, existingPower: prior?.power_hp ?? null,
          existingSource: prior?.source ?? null,
        });
      }
    }
    const deferred = built.selected.filter((row) => blockedConfigurations.has(configKey(row.configuration)));
    built.excluded.push(...deferred);
    built.selected = built.selected.filter((row) => !blockedConfigurations.has(configKey(row.configuration)));
    for (const row of deferred) {
      const id = String(row.sourceListingId);
      built.targetInputs.delete(id);
      if (!deferredReasons.has(id)) deferredReasons.set(id, { reason: "same configuration as another deferred conflict" });
    }
    const acceptedExistingIds = new Set(acceptedExisting.map(({ row }) => String(row.sourceListingId)));
    built.selected = built.selected.filter((row) => !acceptedExistingIds.has(String(row.sourceListingId)));
    const retainedKeys = new Set(built.selected.map((row) => {
      const c = row.configuration;
      const badge = clean(c.badge), badge_detail = clean(c.trim);
      return referenceKey({ brand: clean(c.brand), model: clean(c.model), fuel_type: normalizeFuel(c.fuelType),
        engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge, badge_detail,
        year_from: Number(c.year), year_to: Number(c.year) }, !badge && !badge_detail ? String(row.sourceListingId) : undefined);
    }));
    built.proposed = built.proposed.filter((ref) => retainedKeys.has(ref.configuration_key));
    built.configurationCount = new Set(built.selected.map((row) => configKey(row.configuration))).size;
    const equivalent = new Set<string>();
    const conflicts: Array<Record<string, unknown>> = [];
    for (const proposed of built.proposed) {
      const listingScoped = proposed.configuration_key.includes("|listing=");
      const exact = live.filter((row) => listingScoped
        ? row.configuration_key === proposed.configuration_key
        : sameShape(row, proposed));
      for (const prior of exact) {
        if (Number(prior.power_hp) !== Number(proposed.power_hp) || prior.status !== "automatic" && prior.status !== "confirmed") {
          conflicts.push({ key: prior.configuration_key, status: prior.status, source: prior.source,
            existingPower: prior.power_hp, proposedPower: proposed.power_hp });
        } else {
          equivalent.add(proposed.configuration_key);
        }
      }
    }
    if (conflicts.length) throw new Error(`Existing power-reference conflicts; no rows written: ${JSON.stringify(conflicts)}`);
    const toWrite = built.proposed.filter((row) => !equivalent.has(row.configuration_key));
    const simulated = [
      ...live.filter((row) => !toWrite.some((next) => next.configuration_key === row.configuration_key)),
      ...toWrite,
    ];
    const resolverConflicts: Array<Record<string, unknown>> = [];
    for (const [id, target] of built.targetInputs) {
      const resolved = resolveAutomaticPowerReference(target.input, simulated);
      if (Number(resolved?.power_hp) !== target.powerPs) {
        resolverConflicts.push({ id, expectedPower: target.powerPs, resolvedPower: resolved?.power_hp ?? null, resolvedSource: resolved?.source ?? null });
      }
      const existing = resolveAutomaticPowerReference(target.input, live);
      if (existing && Number(existing.power_hp) !== target.powerPs) {
        resolverConflicts.push({ id, expectedPower: target.powerPs, existingPower: existing.power_hp,
          existingSource: existing.source, reason: "existing reference disagrees with reconciled source evidence" });
      }
    }
    if (resolverConflicts.length) throw new Error(`Power resolver does not select the reconciled candidate; nothing written: ${JSON.stringify(resolverConflicts)}`);

    const unselected = plan.candidates.filter((row) => row.status === "unmatched" && !built.targetInputs.has(String(row.sourceListingId)));
    const unexpectedMatches: Array<Record<string, unknown>> = [];
    for (const row of unselected) {
      const c = row.configuration;
      const input = {
        brand: String(c.brand ?? ""), model: String(c.model ?? ""), fuel_type: normalizeFuel(c.fuelType),
        engine_cc: Number(c.engineCc), drive_type: clean(c.driveType), badge: clean(c.badge), badge_detail: clean(c.trim),
        year: Number(c.year), source_listing_id: String(row.sourceListingId),
      };
      const before = resolveAutomaticPowerReference(input, live);
      const after = resolveAutomaticPowerReference(input, simulated);
      if (!before && after) unexpectedMatches.push({ id: row.sourceListingId, newPower: after.power_hp, source: after.source });
      else if (before && after && Number(before.power_hp) !== Number(after.power_hp)) {
        unexpectedMatches.push({ id: row.sourceListingId, previousPower: before.power_hp, newPower: after.power_hp, source: after.source });
      }
    }
    if (unexpectedMatches.length) throw new Error(`Reconciliation would alter ${unexpectedMatches.length} other run listings; nothing written: ${JSON.stringify(unexpectedMatches.slice(0, 20))}`);

    const audit = {
      generatedAt: new Date().toISOString(),
      committed: false,
      write,
      runId,
      sourceCandidateListings: 90,
      deferredConflictListings: built.excluded.length,
      deferredConflicts: built.excluded.map((row) => ({
        ...row,
        ...deferredReasons.get(String(row.sourceListingId)),
      })),
      acceptedExistingReferenceListings: acceptedExisting.map(({ row, reference }) => ({
        sourceListingId: row.sourceListingId, powerHp: reference.power_hp, source: reference.source,
        note: existingReferenceDecisions.get(String(row.sourceListingId))?.note,
      })),
      remainingListings: plan.candidates.length - plan.candidates.filter((row) => row.status === "approved_match").length - built.selected.length - acceptedExisting.length,
      preliminaryListings: built.selected.length,
      exactConfigurations: built.configurationCount,
      referenceRules: built.proposed.length,
      newOrUpdatedReferences: toWrite.length,
      resolverVerifiedListings: built.targetInputs.size,
      unselectedListingsChanged: 0,
      sources: {
        encarrusCandidateListings: built.selected.filter((row) => row.outcome === "encarrus_only_preliminary" || row.outcome === "both_agree_preliminary").length,
        danawaCandidateListings: built.selected.filter((row) => row.outcome === "danawa_only_preliminary" || row.outcome === "both_agree_preliminary").length,
        bothSourcesAgreeListings: built.selected.filter((row) => row.outcome === "both_agree_preliminary").length,
      },
      effects: { cars: 0, calculations: 0, prices: 0, publication: 0 },
    };
    const auditPath = `output/tl-auto-run-${runId}-source-reconciliation-application.json`;
    await writeFile(auditPath, JSON.stringify(audit, null, 2) + "\n");
    console.log(JSON.stringify({ ...audit, auditPath }, null, 2));

    if (!write) {
      await db.query("rollback");
      return;
    }
    if (toWrite.length) {
      await db.query(
        `insert into public.vehicle_power_automatic_reference
           (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
            year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
         select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
                x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
           from jsonb_to_recordset($1::jsonb) as x(
             configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
             badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
             source text,status text,note text)
         on conflict(configuration_key) do update set
           power_hp=excluded.power_hp,power_kw=excluded.power_kw,source=excluded.source,note=excluded.note,updated_at=now()
         where vehicle_power_automatic_reference.status='automatic'`, [JSON.stringify(toWrite)]);
    }
    const verify = await db.query<Reference>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
              year_from,year_to,power_hp::float8 as power_hp,power_kw::float8 as power_kw,source,status,note
         from public.vehicle_power_automatic_reference where status <> 'retired'`);
    const failed = [...built.targetInputs].flatMap(([id, target]) => {
      const resolved = resolveAutomaticPowerReference(target.input, verify.rows);
      return Number(resolved?.power_hp) === target.powerPs ? [] : [{ id, expected: target.powerPs, actual: resolved?.power_hp ?? null }];
    });
    if (failed.length) throw new Error(`Post-write resolver verification failed: ${JSON.stringify(failed)}`);
    await db.query("commit");
    await writeFile(auditPath, JSON.stringify({ ...audit, committed: true }, null, 2) + "\n");
    console.log(JSON.stringify({ committed: true, preliminaryListings: built.selected.length,
      acceptedExistingReferenceListings: acceptedExisting.length, deferredConflictListings: built.excluded.length,
      exactConfigurations: built.configurationCount, referenceRules: built.proposed.length, verifiedListings: built.targetInputs.size,
      preliminaryOnly: true, carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
