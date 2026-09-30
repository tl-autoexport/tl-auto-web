/**
 * Store run-scoped Drom ICE/LPG power candidates as draft-only evidence/specs.
 * Draft specs are not eligible for the approved power resolver. No cars,
 * calculations, prices, or publication state are written by this importer.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.DROM_ICE_MANIFEST ?? "data/power/drom-ice-gasd-lpg-201-preliminary-v1.json";
const write = process.env.DROM_ICE_PRELIMINARY_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const verificationRunId = "bd5481a2-04a1-458a-810a-30c3ae130fc5";
const PS_TO_KW = 0.73549875;

type ManifestRecord = {
  brand: string;
  model: string;
  year: number;
  engineCc: number;
  fuelType: "gasoline" | "lpg";
  powerPs: number;
  listingIds: string[];
  sourceUrl: string;
  note: string;
};

type Manifest = {
  version: string;
  runIds: string[];
  status: string;
  candidateListingCount: number;
  records: ManifestRecord[];
};

type QueueRow = { source_listing_id: string; candidate_snapshot: Record<string, unknown> };
type StagingRow = { source_listing_id: string; raw_payload: Record<string, any> };

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function specKey(row: ManifestRecord) {
  const identity = [row.brand, row.model, row.fuelType, row.engineCc, row.year, row.powerPs, row.sourceUrl].join("|");
  return `drom-ice-${slug(row.brand)}-${slug(row.model)}-${row.fuelType}-${row.engineCc}-${row.year}-${sha(identity).slice(0, 10)}`;
}

function normalizedFuel(snapshotFuel: unknown): string {
  const value = String(snapshotFuel ?? "").toLowerCase();
  if (value.includes("lpg") || value.includes("газ")) return "lpg";
  if (value.includes("gasoline") || value.includes("бензин")) return "gasoline";
  return value;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (manifest.version !== "drom-ice-gasd-lpg-201-preliminary-v1" || manifest.status !== "preliminary_only_not_approved_tks_evidence") {
    throw new Error("Unexpected manifest version/status; refusing import");
  }
  const ids = manifest.records.flatMap((row) => row.listingIds.map(String));
  if (ids.length !== manifest.candidateListingCount || new Set(ids).size !== ids.length || ids.length !== 14) {
    throw new Error(`Manifest ID/count check failed: ${ids.length}`);
  }
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for Encar evidence preflight");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const [queue, staging] = await Promise.all([
      db.query<QueueRow>(`select source_listing_id,candidate_snapshot from public.encar_enrichment_queue where run_id=$1 and source_listing_id=any($2::text[])`, [verificationRunId, ids]),
      db.query<StagingRow>(`select source_listing_id,raw_payload from public.encar_enrichment_staging where run_id=$1 and source_listing_id=any($2::text[])`, [verificationRunId, ids]),
    ]);
    const queueById = new Map(queue.rows.map((row) => [String(row.source_listing_id), row]));
    const stagingById = new Map(staging.rows.map((row) => [String(row.source_listing_id), row]));
    if (queueById.size !== ids.length || stagingById.size !== ids.length) {
      throw new Error(`Encar preflight is incomplete: queue=${queueById.size}/${ids.length}, staging=${stagingById.size}/${ids.length}`);
    }

    const verified = manifest.records.map((record) => {
      const listingEvidence = record.listingIds.map((id) => {
        const queued = queueById.get(id)!;
        const staged = stagingById.get(id)!;
        const snapshot = queued.candidate_snapshot;
        const detail = staged.raw_payload?.detail ?? {};
        const category = detail.category ?? {};
        const spec = detail.spec ?? {};
        const actualYear = Math.floor(Number(snapshot.year) / 100);
        const actualFuel = normalizedFuel(snapshot.fuelType);
        const actualCc = Number(spec.displacement);
        if (actualYear !== record.year || actualFuel !== record.fuelType || actualCc !== record.engineCc) {
          throw new Error(`Encar identity mismatch for ${id}: year=${actualYear}, fuel=${actualFuel}, cc=${actualCc}; expected ${record.year}/${record.fuelType}/${record.engineCc}`);
        }
        const snapshotModel = String(snapshot.model ?? "").toLowerCase();
        if (!snapshotModel.includes(record.model.toLowerCase()) && !(record.model === "SM6" && snapshotModel.includes("sm6"))) {
          throw new Error(`Encar model mismatch for ${id}: ${snapshot.model} != ${record.model}`);
        }
        const badge = String(category.gradeEnglishName ?? category.gradeName ?? "").trim();
        if (!badge) throw new Error(`Missing Encar trim/badge for ${id}`);
        return { listingId: id, yearMonth: snapshot.year, badge };
      });
      return { ...record, listingEvidence };
    });

    const expectedSpecs = verified.map((row) => ({ key: specKey(row), row, kw: Number((row.powerPs * PS_TO_KW).toFixed(4)) }));
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
      verificationRunId,
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
      policy: "Drom-derived preliminary ICE evidence is inserted as draft only; draft specs are excluded from approved resolution and publication.",
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
         values ('manual','Drom Korean ICE/LPG preliminary candidates',$1,$2,'drom-ice-preliminary-import-v1',$3::jsonb)
         on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
        [manifestHash, manifest.version, JSON.stringify({ status: "draft_only", configurations: verified.length, listings: ids.length })],
      );
      const batchId = batch.rows[0]?.id;
      if (!batchId) throw new Error("Could not create Drom evidence batch");

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
           values ($1,$2,'manual',$3,$4,'Drom Korean-market catalog',now(),current_date,'M1',$5,$6,$7,$8,$9,$9,'ice',$10,'PS','medium','draft','draft',$11,$11)
           returning id`,
          [batchId, raw.rows[0]?.id, row.sourceUrl, `Encar listings ${row.listingIds.join(", ")}`, row.brand, row.model,
            row.listingEvidence.map((x) => x.badge).filter((v, i, a) => a.indexOf(v) === i).join(" / "), row.fuelType, row.year, kw,
            `Preliminary secondary-source match only. Drom rated engine output ${row.powerPs} PS (${kw} kW); not an official TKS/OTTS confirmation. Run-scoped IDs: ${row.listingIds.join(", ")}.`],
        );
        const spec = await db.query<{ id: string }>(
          `insert into public.vehicle_power_specs
             (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,
              calculation_power_kw,evidence_id,approval_note,engine_power_hp,power_basis,source_priority)
           values ($1,1,'draft','M1','ice',$2,$2,$3,$3,$4,$5,$6,'combustion_engine',80) returning id`,
          [key, row.engineCc, kw, evidence.rows[0]?.id, `Draft only; Drom preliminary power. Do not use in automatic/public calculation until reviewed. ${row.sourceUrl}`, row.powerPs],
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
