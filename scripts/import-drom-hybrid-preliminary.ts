/**
 * Build/import Drom-derived preliminary hybrid power evidence for one Encar run.
 *
 * By default this is read-only and writes a reviewed-input manifest under
 * data/power. Database writes are separately gated and create DRAFT evidence
 * and DRAFT calculation specs only; they do not alter cars, prices or publish.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.DROM_HYBRID_RUN_ID ?? "21a687ee-6717-4610-a9cc-97c64608bbb9";
const reportPath = process.env.DROM_HYBRID_REPORT ?? "output/tl-auto-electrified-21a687ee-drom-hybrid-research.json";
const manifestPath = process.env.DROM_HYBRID_MANIFEST ?? "data/power/drom-hybrid-preliminary-v1.json";
const buildManifest = process.env.DROM_HYBRID_BUILD_MANIFEST === "true";
const write = process.env.DROM_HYBRID_PRELIMINARY_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const PS_TO_KW = 0.73549875;

type DromResult = {
  brand: string;
  model: string;
  generation?: string | null;
  year: number;
  engineCc: number;
  driveType?: string | null;
  listingIds: string[];
  listingCount: number;
  drom: {
    status: string;
    url: string;
    title?: string;
    trim?: string;
    combinedPower: { value: number; raw: string } | null;
    engineMaxPower: { value: number; raw: string } | null;
    motor30minPower: { value: number; raw: string } | null;
    motorPeakPower?: { value: number; raw: string } | null;
  } | null;
};

type ManifestRow = {
  specKey: string;
  runId: string;
  brand: string;
  model: string;
  generation: string | null;
  year: number;
  engineCc: number;
  driveType: string | null;
  fuelType: "hybrid";
  propulsionType: "hybrid_parallel";
  source: { title: string; uri: string; retrievedAt: string; trim: string | null };
  powers: { combinedPs: number; enginePs: number; electric30MinPs: number; combinedKw: number; engineKw: number; electric30MinKw: number };
  listingIds: string[];
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function makeRows(report: { runId?: string; summary?: { runId?: string }; generatedAt: string; results: DromResult[]; databaseWrites?: number; publications?: number }): ManifestRow[] {
  const reportRunId = report.runId ?? report.summary?.runId;
  if (reportRunId !== runId) throw new Error(`Run ID mismatch: ${reportRunId} != ${runId}`);
  if (report.databaseWrites !== 0 || report.publications !== 0) throw new Error("Source report must be read-only");
  const rows = report.results.flatMap((row) => {
    const drom = row.drom;
    if (!drom || drom.status !== "ok" || !drom.combinedPower || !drom.engineMaxPower || !drom.motor30minPower) return [];
    if (!row.listingIds?.length || row.listingCount !== row.listingIds.length) throw new Error(`Listing ID/count mismatch: ${row.brand} ${row.model} ${row.year}`);
    const combinedPs = drom.combinedPower.value;
    const enginePs = drom.engineMaxPower.value;
    const electric30MinPs = drom.motor30minPower.value;
    if (![combinedPs, enginePs, electric30MinPs].every((n) => Number.isFinite(n) && n > 0)) throw new Error(`Invalid source power: ${drom.url}`);
    if (Math.abs(combinedPs - enginePs - electric30MinPs) > 0.02) throw new Error(`Drom combined power does not equal ICE + 30-min motor: ${drom.url}`);
    const identity = [row.brand, row.model, row.generation ?? "", row.year, row.engineCc, row.driveType ?? "", combinedPs, drom.url].join("|");
    return [{
      specKey: `drom-hybrid-${slug(row.brand)}-${slug(row.model)}-${row.year}-${row.engineCc}-${slug(row.driveType ?? "any-drive")}-${sha256(identity).slice(0, 10)}`,
      runId,
      brand: row.brand,
      model: row.model,
      generation: row.generation ?? null,
      year: row.year,
      engineCc: row.engineCc,
      driveType: row.driveType ?? null,
      fuelType: "hybrid" as const,
      propulsionType: "hybrid_parallel" as const,
      source: { title: drom.title ?? "Drom hybrid specification", uri: drom.url, retrievedAt: report.generatedAt, trim: drom.trim ?? null },
      powers: (() => {
        // These three values are stored in numeric(10,4) columns. Sum the
        // persisted components so the database equality constraint holds.
        const engineKw = Number((enginePs * PS_TO_KW).toFixed(4));
        const electric30MinKw = Number((electric30MinPs * PS_TO_KW).toFixed(4));
        return { combinedPs, enginePs, electric30MinPs,
          combinedKw: Number((engineKw + electric30MinKw).toFixed(4)), engineKw, electric30MinKw };
      })(),
      listingIds: [...row.listingIds].map(String),
    }];
  });
  const ids = rows.flatMap((row) => row.listingIds);
  if (new Set(ids).size !== ids.length) throw new Error("A listing appears in more than one Drom configuration; refusing to build manifest");
  return rows;
}

async function importDraftSpecs(rows: ManifestRow[], manifestHash: string) {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for database writes");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const batch = await db.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
         (source_kind, source_name, source_sha256, source_version, imported_by, metadata)
       values ('manual', 'Drom Korean hybrid preliminary research', $1, 'drom-hybrid-preliminary-v1', 'drom-hybrid-import-v1', $2::jsonb)
       on conflict (source_kind, source_sha256) do update set metadata=excluded.metadata
       returning id`,
      [manifestHash, JSON.stringify({ runId, specs: rows.length, listings: rows.reduce((n, row) => n + row.listingIds.length, 0), status: "draft_only" })],
    );
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new Error("Could not create source batch");
    let inserted = 0;
    for (const [index, row] of rows.entries()) {
      const existing = await db.query<{ id: string; status: string; evidence_id: string; calculation_power_kw: string }>(
        `select id,status,evidence_id,calculation_power_kw::text from public.vehicle_power_specs where spec_key=$1 and version=1`, [row.specKey],
      );
      if (existing.rows[0]) {
        const prior = existing.rows[0];
        const expected = row.powers.combinedKw;
        if (prior.status !== "draft" || Math.abs(Number(prior.calculation_power_kw) - expected) > 0.00001) {
          throw new Error(`Conflicting/protected existing spec ${row.specKey}; transaction aborted`);
        }
        continue;
      }
      const raw = await db.query<{ id: string }>(
        `insert into public.vehicle_power_source_rows
           (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
         values ($1,'drom-hybrid-preliminary-v1',$2,$3::jsonb,$4,$5,'parsed') returning id`,
        [batchId, index + 1, JSON.stringify(row), `${row.brand} ${row.model} hybrid`, `${row.powers.combinedPs} PS total; ICE ${row.powers.enginePs} PS; motor 30-min ${row.powers.electric30MinPs} PS`],
      );
      const evidence = await db.query<{ id: string }>(
        `insert into public.vehicle_power_evidence
           (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
            brand,model,generation,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
            dvs_power_kw,electric_power_kw_30min,source_units,reliability,review_status,review_note)
         values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,'hybrid',$9,$9,'hybrid_parallel',
                 $10,$11,'PS','medium','draft',$12) returning id`,
        [batchId, raw.rows[0]?.id, row.source.uri, row.source.title, row.brand, row.model, row.generation, row.source.trim,
          row.year, row.powers.engineKw, row.powers.electric30MinKw,
          `Preliminary, source-derived only; not approved for calculation. Drom combined=${row.powers.combinedPs} PS, ICE=${row.powers.enginePs} PS, motor 30-min=${row.powers.electric30MinPs} PS. Encar run ${runId}; listing IDs ${row.listingIds.join(", ")}.`],
      );
      const spec = await db.query<{ id: string }>(
        `insert into public.vehicle_power_specs
           (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,
            dvs_power_kw,electric_power_kw_30min,calculation_power_kw,evidence_id,approval_note,
            engine_power_hp,power_basis,source_priority,hybrid_type,power_ice_hp,power_electric_30min_hp,
            customs_power_hp,system_power_hp)
         values ($1,1,'draft','M1','hybrid_parallel',$2,$2,$3,$4,$5,$6,$7,$8,'parallel_sum',90,
                 'parallel',$9,$10,$11,null) returning id`,
        [row.specKey, row.engineCc, row.powers.engineKw, row.powers.electric30MinKw, row.powers.combinedKw,
          evidence.rows[0]?.id, `Draft preliminary hybrid reference from Drom. Do not resolve or publish until reviewed. ${row.source.uri}`,
          row.powers.enginePs, row.powers.enginePs, row.powers.electric30MinPs, row.powers.combinedPs],
      );
      await db.query(
        `insert into public.vehicle_power_spec_matches
           (spec_id,priority,brand,model,generation,fuel_type,drive_type,production_year_from,production_year_to,engine_cc_from,engine_cc_to)
         values ($1,90,$2,$3,$4,'hybrid',$5,$6,$6,$7,$7)`,
        [spec.rows[0]?.id, row.brand, row.model, row.generation, row.driveType, row.year, row.engineCc],
      );
      inserted += 1;
    }
    await db.query("commit");
    return { insertedDraftSpecs: inserted, alreadyPresentDraftSpecs: rows.length - inserted };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

async function main() {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const rows = makeRows(report);
  const listingCount = rows.reduce((n, row) => n + row.listingIds.length, 0);
  if (rows.length !== 44 || listingCount !== 97) throw new Error(`Expected 44 configurations / 97 listings; got ${rows.length} / ${listingCount}`);
  if (buildManifest) await writeFile(manifestPath, `${JSON.stringify({ version: "drom-hybrid-preliminary-v1", runId, generatedAt: report.generatedAt, status: "draft_preliminary_not_approved_for_calculation", rows }, null, 2)}\n`);
  const manifest = buildManifest ? { version: "drom-hybrid-preliminary-v1", runId, generatedAt: report.generatedAt, rows } : JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.runId !== runId || manifest.rows.length !== 44) throw new Error("Manifest run/count mismatch");
  const manifestHash = sha256(manifest);
  const summary = {
    runId, sourceRows: rows.length, listings: listingCount,
    powersValidated: rows.every((row) => Math.abs(row.powers.combinedPs - row.powers.enginePs - row.powers.electric30MinPs) <= 0.02),
    source: "Drom explicit hybrid combined power plus separate ICE and motor 30-minute fields",
    output: manifestPath, dryRun: !write,
    databaseWrites: 0, carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0,
    policy: "Database mode creates draft source evidence and draft hybrid specs only; no approved/resolvable specs or catalog writes.",
  };
  console.log(JSON.stringify({ ...summary, specs: manifest.rows.map((row: ManifestRow) => ({ specKey: row.specKey, brand: row.brand, model: row.model, year: row.year, engineCc: row.engineCc, driveType: row.driveType, powers: row.powers, listings: row.listingIds.length, sourceUrl: row.source.uri })) }, null, 2));
  if (write) {
    const result = await importDraftSpecs(manifest.rows, manifestHash);
    console.log(JSON.stringify({ ...result, databaseWrites: result.insertedDraftSpecs, carsChanged: 0, pricesChanged: 0, publications: 0 }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
