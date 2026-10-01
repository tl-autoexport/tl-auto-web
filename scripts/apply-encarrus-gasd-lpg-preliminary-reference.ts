/**
 * Register the user-approved 120 Encar ICE/LPG matches as preliminary automatic
 * power references. Does not modify cars, calculations, prices, or publication.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import {
  resolveAutomaticPowerReference,
  type AutomaticPowerReferenceRow,
} from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.ENCARRUS_GASD_LPG_MANIFEST ??
  "data/power/encarrus-ice-gasd-lpg-201-preliminary-v1.json";
const auditPath = process.env.ENCARRUS_GASD_LPG_AUDIT ??
  "data/power/encarrus-ice-gasd-lpg-201-source-audit-v1.json";
const planPaths = String(process.env.ENCARRUS_GASD_LPG_PLANS ?? [
  "output/tl-auto-gasd-bd5481a2-power-plan.json",
  "output/tl-auto-gasd-d50f740a-power-plan.json",
].join(",")).split(",").map((path: string) => path.trim()).filter(Boolean);
const write = process.env.ENCARRUS_GASD_LPG_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const expectedRunIds = new Set([
  "bd5481a2-04a1-458a-810a-30c3ae130fc5",
  "d50f740a-3cfb-4eea-8e9d-84adba3d0e52",
]);
const KW_PER_PS = 0.73549875;

type ManifestRecord = {
  brand: string;
  model: string;
  year: number;
  engineCc: number;
  fuelType: "gasoline" | "diesel" | "lpg";
  powerPs: number;
  listingIds: string[];
  sourceUrl: string;
  sourceTitle: string;
  note: string;
};
type Manifest = {
  version: string;
  runIds: string[];
  status: string;
  candidateListingCount: number;
  records: ManifestRecord[];
};
type SourceRow = {
  classification: string;
  listingIds: string[];
  car: [string, string, number, number, string, string | null];
  badges: string[];
  suggestedPowerHp: number | null;
  powerCandidatesHp: number[];
  cards: Array<{ powerHp: number; productUrl: string; trim: string }>;
};
type Audit = {
  version: string;
  runIds: string[];
  sourceRows: SourceRow[];
  reviewResolutions: Array<{ listingId: string; powerPs: number; rationale: string; url?: string }>;
};
type PlanCandidate = {
  sourceListingId: string;
  status: string;
  configuration: {
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    engineCc?: number | null;
    fuelType?: string | null;
    driveType?: string | null;
    badge?: string | null;
    trim?: string | null;
  };
};
type PowerPlan = { runId: string; candidates: PlanCandidate[] };
type Reference = AutomaticPowerReferenceRow & {
  note: string;
};

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const configKey = (r: Omit<Reference, "configuration_key" | "power_hp" | "power_kw" | "source" | "status" | "note">) =>
  [norm(r.brand), norm(r.model), norm(r.fuel_type), r.engine_cc, norm(r.drive_type), norm(r.badge), norm(r.badge_detail),
    `year=${r.year_from}-${r.year_to}`].join("|");

function buildReferences(manifest: Manifest, audit: Audit, plans: PowerPlan[]) {
  if (manifest.version !== "encarrus-ice-gasd-lpg-201-preliminary-v1" ||
      manifest.status !== "preliminary_only_not_approved_tks_evidence" ||
      manifest.candidateListingCount !== 120 || manifest.records.length !== 89 ||
      audit.version !== "encarrus-ice-gasd-lpg-201-source-audit-v1" ||
      JSON.stringify([...manifest.runIds].sort()) !== JSON.stringify([...expectedRunIds].sort()) ||
      JSON.stringify([...audit.runIds].sort()) !== JSON.stringify([...expectedRunIds].sort())) {
    throw new Error("Unexpected manifest/audit version, cohort, or run IDs; refusing to apply");
  }

  const sourceById = new Map<string, SourceRow>();
  for (const row of audit.sourceRows) {
    for (const id of row.listingIds) {
      if (sourceById.has(id)) throw new Error(`Duplicate source-audit listing ID: ${id}`);
      sourceById.set(id, row);
    }
  }
  const reviewById = new Map(audit.reviewResolutions.map((row) => [row.listingId, row]));
  const planById = new Map<string, PlanCandidate>();
  for (const plan of plans) {
    if (!expectedRunIds.has(plan.runId)) throw new Error(`Unexpected run ID in power plan: ${plan.runId}`);
    for (const candidate of plan.candidates) {
      const id = String(candidate.sourceListingId);
      const prior = planById.get(id);
      if (prior && JSON.stringify(prior.configuration) !== JSON.stringify(candidate.configuration)) {
        throw new Error(`Power-plan configuration changed between runs for ${id}`);
      }
      // Later retry-run entries supersede their cancelled/failed original queue entries.
      planById.set(id, candidate);
    }
  }
  const listingIds = manifest.records.flatMap((row) => row.listingIds.map(String));
  if (listingIds.length !== 120 || new Set(listingIds).size !== 120) {
    throw new Error(`Manifest must cover 120 unique listing IDs, got ${listingIds.length}/${new Set(listingIds).size}`);
  }

  const refsByKey = new Map<string, Reference>();
  const configById = new Map<string, PlanCandidate["configuration"]>();
  for (const record of manifest.records) {
    if (!Number.isInteger(record.year) || !Number.isInteger(record.engineCc) ||
        !Number.isFinite(record.powerPs) || record.powerPs <= 0 || !record.sourceUrl) {
      throw new Error(`Invalid manifest record: ${record.brand} ${record.model}`);
    }
    const rows = record.listingIds.map((id) => {
      const row = sourceById.get(String(id));
      if (!row) throw new Error(`Source audit missing listing ${id}`);
      const planned = planById.get(String(id));
      if (!planned || planned.status !== "unmatched") {
        throw new Error(`Power plan missing or no longer unmatched for listing ${id}`);
      }
      const config = planned.configuration;
      const [brand, model, year, engineCc, fuelType, driveType] = row.car;
      if (brand !== record.brand || model !== record.model || year !== record.year ||
          engineCc !== record.engineCc || fuelType !== record.fuelType ||
          config.brand !== record.brand || config.model !== record.model || config.year !== record.year ||
          config.engineCc !== record.engineCc || config.fuelType !== record.fuelType ||
          norm(config.driveType) !== norm(driveType)) {
        throw new Error(`Source-audit configuration mismatch for listing ${id}`);
      }
      configById.set(String(id), config);
      if (row.classification === "preliminary_candidate") {
        if (row.suggestedPowerHp !== record.powerPs || row.powerCandidatesHp.length !== 1 ||
            row.powerCandidatesHp[0] !== record.powerPs) {
          throw new Error(`Unique EncarRus power evidence mismatch for listing ${id}`);
        }
      } else if (row.classification === "review_match_or_power") {
        const resolution = reviewById.get(String(id));
        if (!resolution || resolution.powerPs !== record.powerPs) {
          throw new Error(`Reviewed power decision missing/mismatched for listing ${id}`);
        }
      } else {
        throw new Error(`Unexpected source classification for listing ${id}: ${row.classification}`);
      }
      return { row, driveType, config };
    });

    const configurations = new Map<string, typeof rows[number]["config"]>();
    for (const { config } of rows) configurations.set(JSON.stringify(config), config);
    for (const config of configurations.values()) {
      const badge = config.badge?.trim() || null;
      const badgeDetail = config.trim?.trim() || null;
      const base = {
        brand: record.brand,
        model: record.model,
        fuel_type: record.fuelType,
        engine_cc: record.engineCc,
        drive_type: config.driveType ?? null,
        badge,
        badge_detail: badgeDetail,
        year_from: record.year,
        year_to: record.year,
      };
      const key = configKey(base);
      const reviewNotes = record.listingIds
        .map((id) => reviewById.get(String(id)))
        .filter((resolution): resolution is NonNullable<typeof resolution> => Boolean(resolution))
        .map((resolution) => `${resolution.listingId}: ${resolution.rationale}${resolution.url ? ` Source: ${resolution.url}` : ""}`);
      const source = record.listingIds.some((id) => reviewById.get(String(id))?.url)
        ? "manufacturer_preliminary"
        : "encarrus_ice_catalog";
      const note = [
        "Предварительная мощность для расчёта, не является подтверждённым значением ТКС/ОТТС.",
        `EncarRus evidence: ${record.sourceTitle}; ${record.sourceUrl}.`,
        record.note,
        reviewNotes.length ? `Reviewed decision: ${reviewNotes.join("; ")}` : "",
        `Exact Encar power-plan badge/trim: ${badge ?? "(empty)"} / ${badgeDetail ?? "(empty)"}.`,
        `Covered Encar listing IDs: ${record.listingIds.join(", ")}.`,
      ].filter(Boolean).join(" ");
      const ref: Reference = {
        configuration_key: key,
        ...base,
        power_hp: record.powerPs,
        power_kw: Number((record.powerPs * KW_PER_PS).toFixed(4)),
        source,
        status: "automatic",
        note,
      };
      const previous = refsByKey.get(key);
      if (previous && (previous.power_hp !== ref.power_hp || previous.note !== ref.note)) {
        throw new Error(`Conflicting manifest rules for ${key}`);
      }
      refsByKey.set(key, ref);
    }
  }

  return { references: [...refsByKey.values()], listingIds, configById };
}

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const audit = JSON.parse(await readFile(auditPath, "utf8")) as Audit;
  if (!planPaths.length) throw new Error("ENCARRUS_GASD_LPG_PLANS must identify the saved power-plan JSON files");
  const plans = await Promise.all(planPaths.map(async (path) =>
    JSON.parse(await readFile(path, "utf8")) as PowerPlan));
  const built = buildReferences(manifest, audit, plans);
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(write ? "begin" : "begin read only");
    const liveResult = await db.query<Reference>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
              year_from,year_to,power_hp::double precision as power_hp,power_kw::double precision as power_kw,
              source,status,note
         from public.vehicle_power_automatic_reference where status <> 'retired'${write ? " for update" : ""}`,
    );
    const live = liveResult.rows;
    const proposedByKey = new Map(built.references.map((row) => [row.configuration_key, row]));
    const existingByKey = new Map(live.map((row) => [row.configuration_key, row]));
    const protectedConflicts = built.references.flatMap((row) => {
      const existing = existingByKey.get(row.configuration_key);
      if (!existing || existing.status === "automatic" || Number(existing.power_hp) === row.power_hp) return [];
      return [{ key: row.configuration_key, existingStatus: existing.status,
        existingPowerPs: existing.power_hp, proposedPowerPs: row.power_hp }];
    });
    if (protectedConflicts.length) {
      throw new Error(`Conflicting non-automatic references; nothing changed: ${JSON.stringify(protectedConflicts)}`);
    }

    // New evidence replaces only an automatic rule with the exact same key.
    // All other live rules remain in resolver simulation and can block a write.
    const simulated = [
      ...live.filter((row) => !proposedByKey.has(row.configuration_key)),
      ...built.references,
    ];
    const resolverConflicts: Array<{ listingId: string; badge: string | null; badgeDetail: string | null;
      expected: number; resolved: number | null; key: string | null }> = [];
    for (const record of manifest.records) {
      for (const id of record.listingIds) {
        const config = built.configById.get(String(id))!;
        const resolved = resolveAutomaticPowerReference({
          brand: record.brand, model: record.model, fuel_type: record.fuelType,
          engine_cc: record.engineCc, drive_type: config.driveType ?? null,
          badge: config.badge ?? null, badge_detail: config.trim ?? null, year: record.year,
        }, simulated);
        if (Number(resolved?.power_hp) !== record.powerPs) {
          resolverConflicts.push({ listingId: String(id), badge: config.badge ?? null,
            badgeDetail: config.trim ?? null, expected: record.powerPs,
            resolved: resolved?.power_hp ?? null, key: resolved?.configuration_key ?? null });
        }
      }
    }
    if (resolverConflicts.length) {
      throw new Error(`Resolver precedence conflicts; nothing changed: ${JSON.stringify(resolverConflicts)}`);
    }

    const newCount = built.references.filter((row) => !existingByKey.has(row.configuration_key)).length;
    const updates = built.references.filter((row) => {
      const existing = existingByKey.get(row.configuration_key);
      return existing?.status === "automatic" && Number(existing.power_hp) !== row.power_hp;
    }).length;
    console.log(JSON.stringify({
      write,
      runIds: manifest.runIds,
      preliminaryListings: built.listingIds.length,
      configurations: manifest.records.length,
      exactBadgeReferences: built.references.length,
      newReferences: newCount,
      automaticReferencesUpdatedToApprovedPreliminaryValues: updates,
      alreadyMatchingReferences: built.references.length - newCount - updates,
      resolverConflicts: resolverConflicts.length,
      effect: "power resolver only; no car rows, calculations, prices, or publication changed",
      next: "Run the existing per-run preliminary calculation/readiness/publication workflow after this import.",
    }, null, 2));

    if (!write) {
      await db.query("rollback");
      return;
    }

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
       on conflict (configuration_key) do update set
         power_hp=excluded.power_hp,power_kw=excluded.power_kw,source=excluded.source,
         note=excluded.note,updated_at=now()
       where vehicle_power_automatic_reference.status='automatic'`,
      [JSON.stringify(built.references)],
    );

    const verifyRows = await db.query<Reference>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
              year_from,year_to,power_hp::double precision as power_hp,power_kw::double precision as power_kw,
              source,status,note
         from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`,
      [built.references.map((row) => row.configuration_key)],
    );
    const verifiedByKey = new Map(verifyRows.rows.map((row) => [row.configuration_key, row]));
    const verifyFailures = built.references.filter((expected) => {
      const actual = verifiedByKey.get(expected.configuration_key);
      return !actual || !["automatic", "confirmed"].includes(actual.status) ||
        Number(actual.power_hp) !== expected.power_hp;
    });
    if (verifyFailures.length || verifyRows.rowCount !== built.references.length) {
      throw new Error(`Post-write verification failed: ${JSON.stringify({
        expected: built.references.length, got: verifyRows.rowCount,
        failures: verifyFailures.map((row) => row.configuration_key),
      })}`);
    }
    await db.query("commit");
    console.log(JSON.stringify({ committed: true, verifiedReferences: verifyRows.rowCount,
      coveredListings: built.listingIds.length, preliminaryOnly: true,
      carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
