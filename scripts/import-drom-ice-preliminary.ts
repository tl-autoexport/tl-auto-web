/**
 * Store run-scoped Drom/EncarRus ICE/LPG power candidates as draft-only evidence/specs.
 * Draft specs are not eligible for the approved power resolver. No cars,
 * calculations, prices, or publication state are written by this importer.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.ICE_PRELIMINARY_MANIFEST ?? process.env.DROM_ICE_MANIFEST ?? "data/power/drom-ice-gasd-lpg-201-preliminary-v1.json";
const write = process.env.ICE_PRELIMINARY_WRITE === "true" || process.env.DROM_ICE_PRELIMINARY_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const configuredRunIds = (process.env.ICE_PRELIMINARY_VERIFICATION_RUN_IDS ?? process.env.DROM_ICE_VERIFICATION_RUN_IDS ?? process.env.DROM_ICE_VERIFICATION_RUN_ID ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const PS_TO_KW = 0.73549875;

type ManifestRecord = {
  brand: string;
  model: string;
  year: number;
  engineCc: number;
  fuelType: "gasoline" | "diesel" | "lpg";
  powerPs: number;
  listingIds: string[];
  sourceUrl: string;
  sourceTitle?: string;
  note: string;
};

type Manifest = {
  version: string;
  runIds: string[];
  status: string;
  candidateListingCount: number;
  records: ManifestRecord[];
};

type QueueRow = { run_id: string; source_listing_id: string; candidate_snapshot: Record<string, unknown> };
type StagingRow = { run_id: string; source_listing_id: string; raw_payload: Record<string, unknown> };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function specKey(row: ManifestRecord, version: string) {
  const identity = [row.brand, row.model, row.fuelType, row.engineCc, row.year, row.powerPs, row.sourceUrl].join("|");
  const sourcePrefix = version.startsWith("encarrus-") ? "encarrus-ice" : "drom-ice";
  return `${sourcePrefix}-${slug(row.brand)}-${slug(row.model)}-${row.fuelType}-${row.engineCc}-${row.year}-${sha(identity).slice(0, 10)}`;
}

function normalizedFuel(snapshotFuel: unknown): string {
  const value = String(snapshotFuel ?? "").toLowerCase();
  if (value.includes("lpg") || value.includes("газ")) return "lpg";
  if (value.includes("diesel") || value.includes("диз")) return "diesel";
  if (value.includes("gasoline") || value.includes("бензин")) return "gasoline";
  return value;
}

function normalizedModel(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function modelMatches(recordModel: string, snapshotModel: unknown, category: Record<string, unknown>): boolean {
  const expected = recordModel.replace(/\s+(?:w|f|g|u|x)\d+\b.*$/i, "").replace(/\s+n$/i, "").trim();
  const expectedNormalized = normalizedModel(expected);
  const observed = [snapshotModel, category.modelGroupEnglishName, category.modelName]
    .map(normalizedModel)
    .filter(Boolean);
  return observed.some((model) => model.includes(expectedNormalized) || expectedNormalized.includes(model));
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (!/^(drom|encarrus)-ice-gasd-lpg-201-preliminary-v/.test(manifest.version) || manifest.status !== "preliminary_only_not_approved_tks_evidence") {
    throw new Error("Unexpected manifest version/status; refusing import");
  }
  const ids = manifest.records.flatMap((row) => row.listingIds.map(String));
  const verificationRunIds = configuredRunIds.length ? configuredRunIds : manifest.runIds;
  if (!verificationRunIds.length || verificationRunIds.some((id) => !manifest.runIds.includes(id)) || ids.length !== manifest.candidateListingCount || new Set(ids).size !== ids.length) {
    throw new Error(`Manifest ID/count check failed: ${ids.length}`);
  }
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for Encar evidence preflight");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const [queue, staging] = await Promise.all([
      db.query<QueueRow>(`select run_id,source_listing_id,candidate_snapshot from public.encar_enrichment_queue where run_id=any($1::uuid[]) and source_listing_id=any($2::text[])`, [verificationRunIds, ids]),
      db.query<StagingRow>(`select run_id,source_listing_id,raw_payload from public.encar_enrichment_staging where run_id=any($1::uuid[]) and source_listing_id=any($2::text[])`, [verificationRunIds, ids]),
    ]);
    const byListingId = <T extends { source_listing_id: string }>(rows: T[]) => {
      const result = new Map<string, T[]>();
      for (const row of rows) result.set(String(row.source_listing_id), [...(result.get(String(row.source_listing_id)) ?? []), row]);
      return result;
    };
    const queueById = byListingId(queue.rows);
    const stagingById = byListingId(staging.rows);
    const missingQueue = ids.filter((id) => !queueById.has(id));
    const missingStaging = ids.filter((id) => !stagingById.has(id));
    if (missingQueue.length || missingStaging.length) {
      throw new Error(`Encar preflight is incomplete: missing queue=${missingQueue.join(",")}; missing staging=${missingStaging.join(",")}`);
    }

    const verified = manifest.records.map((record) => {
      const listingEvidence = record.listingIds.map((id) => {
        const queueRows = queueById.get(id) ?? [];
        const stagingRows = stagingById.get(id) ?? [];
        const valid = verificationRunIds.flatMap((runId) => {
          const queued = queueRows.find((row) => row.run_id === runId);
          const staged = stagingRows.find((row) => row.run_id === runId);
          if (!queued || !staged) return [];
          const snapshot = queued.candidate_snapshot;
          const detail = asRecord(staged.raw_payload.detail);
          const category = asRecord(detail.category);
          const spec = asRecord(detail.spec);
          const actualYear = Math.floor(Number(snapshot.year) / 100);
          const actualFuel = normalizedFuel(snapshot.fuelType);
          const actualCc = Number(spec.displacement);
          const snapshotModel = String(snapshot.model ?? "").toLowerCase();
          const badge = String(category.gradeEnglishName ?? category.gradeName ?? "").trim();
          if (actualYear !== record.year || actualFuel !== record.fuelType || actualCc !== record.engineCc || !badge) return [];
          if (!modelMatches(record.model, snapshot.model, category) && !(record.model === "SM6" && snapshotModel.includes("sm6"))) return [];
          return [{ listingId: id, yearMonth: snapshot.year, badge, runId }];
        });
        if (!valid.length) {
          throw new Error(`No matching queue/staging pair for ${id} across runs ${verificationRunIds.join(",")}; expected ${record.model}/${record.year}/${record.fuelType}/${record.engineCc}`);
        }
        const badgeValues = [...new Set(valid.map((row) => row.badge))];
        if (badgeValues.length > 1) throw new Error(`Conflicting Encar badges across runs for ${id}: ${badgeValues.join(" / ")}`);
        return valid[0];
      });
      return { ...record, listingEvidence };
    });

    const expectedSpecs = verified.map((row) => ({ key: specKey(row, manifest.version), row, kw: Number((row.powerPs * PS_TO_KW).toFixed(4)) }));
    const existing = await db.query<{ spec_key: string; status: string; calculation_power_kw: string }>(
      `select spec_key,status,calculation_power_kw::text from public.vehicle_power_specs where spec_key=any($1::text[]) and version=1`,
      [expectedSpecs.map((x) => x.key)],
    );
    const existingByKey = new Map(existing.rows.map((row) => [row.spec_key, row]));
    for (const item of expectedSpecs) {
      const prior = existingByKey.get(item.key);
      if (prior && (prior.status !== "draft" || Math.abs(Number(prior.calculation_power_kw) - item.kw) > 0.00001)) {
        throw new Error(`Conflicting/protected existing spec ${item.key}; refusing import`);
      }
    }

    const pending = expectedSpecs.filter((item) => !existingByKey.has(item.key));
    const output = {
      readOnly: !write,
      databaseWrites: 0,
      verificationRunIds,
      verifiedListings: ids.length,
      verifiedConfigurations: verified.length,
      draftSpecsAlreadyPresent: existing.rows.length,
      draftSpecsToInsert: pending.length,
      pricesChanged: 0,
      carsChanged: 0,
      publications: 0,
      groups: verified.map((row) => ({
        brand: row.brand, model: row.model, year: row.year, engineCc: row.engineCc,
        fuelType: row.fuelType, powerPs: row.powerPs, powerKw: Number((row.powerPs * PS_TO_KW).toFixed(4)),
        listingIds: row.listingIds, trims: row.listingEvidence.map((x) => ({ id: x.listingId, yearMonth: x.yearMonth, badge: x.badge })),
        sourceUrl: row.sourceUrl,
      })),
      policy: "Manually researched preliminary ICE evidence is inserted as draft only; draft specs are excluded from approved resolution and publication.",
    };

    if (!write) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    await db.query("begin");
    try {
      const manifestHash = sha(JSON.stringify(manifest));
      const batch = await db.query<{ id: string }>(
        `insert into public.vehicle_power_source_batches(source_kind,source_name,source_sha256,source_version,imported_by,metadata)
         values ('manual','Korean-market ICE preliminary candidates',$1,$2,'manual-ice-preliminary-import-v2',$3::jsonb)
         on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
        [manifestHash, manifest.version, JSON.stringify({ status: "draft_only", configurations: verified.length, listings: ids.length })],
      );
      const batchId = batch.rows[0]?.id;
      if (!batchId) throw new Error("Could not create preliminary ICE evidence batch");

      let inserted = 0;
      for (const [index, item] of pending.entries()) {
        const { row, kw, key } = item;
        const raw = await db.query<{ id: string }>(
          `insert into public.vehicle_power_source_rows(batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
           values ($1,$2,$3,$4::jsonb,$5,$6,'parsed') returning id`,
          [batchId, manifest.version, index + 1, JSON.stringify({ ...row, verifiedListingEvidence: row.listingEvidence }), `${row.brand} ${row.model}`, `${row.powerPs} PS engine output`],
        );
        const evidence = await db.query<{ id: string }>(
          `insert into public.vehicle_power_evidence
             (batch_id,source_row_id,source_kind,source_uri,document_reference,source_title,source_retrieved_at,captured_at,
              vehicle_category,brand,model,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
              dvs_power_kw,source_units,reliability,review_status,verification_status,review_note,evidence_note)
           values ($1,$2,'manual',$3,$4,$5,now(),current_date,'M1',$6,$7,$8,$9,$10,$10,'ice',$11,'PS','medium','draft','draft',$12,$12)
           returning id`,
          [batchId, raw.rows[0]?.id, row.sourceUrl, `Encar listings ${row.listingIds.join(", ")}`, row.sourceTitle ?? "Korean-market vehicle catalogue", row.brand, row.model,
            row.listingEvidence.map((x) => x.badge).filter((v, i, a) => a.indexOf(v) === i).join(" / "), row.fuelType, row.year, kw,
            `Preliminary source match only. ${row.sourceTitle ?? "Korean-market vehicle catalogue"} reports engine output ${row.powerPs} PS (${kw} kW); not an official TKS/OTTS confirmation. Run-scoped IDs: ${row.listingIds.join(", ")}.`],
        );
        const spec = await db.query<{ id: string }>(
          `insert into public.vehicle_power_specs
             (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,
              calculation_power_kw,evidence_id,approval_note,engine_power_hp,power_basis,source_priority)
           values ($1,1,'draft','M1','ice',$2,$2,$3,$3,$4,$5,$6,'combustion_engine',80) returning id`,
          [key, row.engineCc, kw, evidence.rows[0]?.id, `Draft only; preliminary catalogue/manufacturer power. Do not use in automatic/public calculation until reviewed. ${row.sourceUrl}`, row.powerPs],
        );
        const uniqueBadges = row.listingEvidence.map((x) => x.badge).filter((v, i, a) => a.indexOf(v) === i);
        for (const badge of uniqueBadges) {
          await db.query(
            `insert into public.vehicle_power_spec_matches
               (spec_id,priority,brand,model,trim,fuel_type,production_year_from,production_year_to,engine_cc_from,engine_cc_to)
             values ($1,80,$2,$3,$4,$5,$6,$6,$7,$7)`,
            [spec.rows[0]?.id, row.brand, row.model, badge, row.fuelType, row.year, row.engineCc],
          );
        }
        inserted += 1;
      }

      const verify = await db.query<{ total: string; active: string }>(
        `select count(*)::text as total,count(*) filter(where spec.status <> 'draft' or evidence.verification_status <> 'draft')::text as active
         from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
         where spec.spec_key=any($1::text[]) and spec.version=1`, [expectedSpecs.map((x) => x.key)],
      );
      if (Number(verify.rows[0]?.total) !== expectedSpecs.length || Number(verify.rows[0]?.active) !== 0) {
        throw new Error(`Post-write draft verification failed: ${JSON.stringify(verify.rows[0])}`);
      }
      await db.query("commit");
      output.readOnly = false;
      output.databaseWrites = inserted;
      output.draftSpecsToInsert = inserted;
      console.log(JSON.stringify(output, null, 2));
    } catch (error) {
      await db.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
