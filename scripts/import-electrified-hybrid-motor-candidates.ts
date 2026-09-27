/** Persist the exact, source-matched 16 hybrid candidates as run-scoped draft evidence. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const MANIFEST_PATH = "data/power/electrified-21a687ee-hybrid-motor-candidates.json";
const WRITE = process.env.TL_AUTO_ELECTRIFIED_HYBRID_MOTOR_IMPORT_WRITE === "true";
const PS_TO_KW = 0.73549875;
const EXPECTED_IDS = [
  "42740267", "42740856", "42741141", "42760048", "42761681", "42764768", "42764891", "42768139",
  "42773175", "42773917", "42776683", "42778760", "42787113", "42787737", "42791349", "42792964",
];
type Entry = {
  sourceListingId: string; brand: string; model: string; year: number; engineCc: number; driveType: string | null;
  sourceKind: "danawa"; sourceUrl: string; sourceTitle: string; sourceModelCode: number; sourceNote: string;
  powerBasis: "parallel_sum"; enginePowerPs: number; electricMotorPowerPs: number;
  electric30MinPs: null; customsPowerPs: number; calculationPowerKw: number; grade: string | null;
};
const kw = (ps: number) => Number((ps * PS_TO_KW).toFixed(4));
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
    runId: string; status: string; counts: { configurations: number; listings: number }; entries: Entry[];
  };
  const ids = manifest.entries.map((entry) => entry.sourceListingId).sort();
  if (manifest.runId !== RUN_ID || manifest.status !== "draft_preliminary" || manifest.counts.configurations !== 7 ||
      manifest.counts.listings !== 16 || JSON.stringify(ids) !== JSON.stringify([...EXPECTED_IDS].sort()))
    throw new Error("Run/membership mismatch; refusing the import");
  for (const entry of manifest.entries) {
    if (entry.sourceKind !== "danawa" || !entry.sourceUrl.startsWith("https://auto.danawa.com/auto/?Model=") ||
        entry.powerBasis !== "parallel_sum" || entry.electric30MinPs !== null ||
        entry.customsPowerPs !== entry.enginePowerPs + entry.electricMotorPowerPs ||
        entry.calculationPowerKw !== Number((kw(entry.enginePowerPs) + kw(entry.electricMotorPowerPs)).toFixed(4)))
      throw new Error(`Power basis/source validation failed for ${entry.sourceListingId}`);
  }
  if (!WRITE) {
    console.log(JSON.stringify({ runId: RUN_ID, validated: manifest.entries.length, databaseWrites: 0,
      carsChanged: 0, pricesChanged: 0, publications: 0, entries: manifest.entries.map((entry) => ({
        id: entry.sourceListingId, car: `${entry.brand} ${entry.model} ${entry.year}`, enginePs: entry.enginePowerPs,
        motorPs: entry.electricMotorPowerPs, calculationPs: entry.customsPowerPs,
      })) }, null, 2));
    return;
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for the write");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const columns = await db.query<{ name: string }>(`
      select column_name as name from information_schema.columns
      where table_schema='public' and table_name in ('vehicle_power_evidence','vehicle_power_specs')
        and column_name in ('hybrid_electric_motor_power_kw','power_electric_motor_hp')`);
    if (columns.rows.length !== 3) throw new Error("Hybrid/electric schema migration is missing; import aborted");
    const batch = await db.query<{ id: string }>(`
      insert into public.vehicle_power_source_batches
        (source_kind,source_name,source_sha256,source_version,imported_by,metadata)
      values ('danawa','Danawa hybrid motor power candidates',$1,'danawa-hybrid-motor-21a687ee-v1',
        'electrified-hybrid-motor-import-v1',$2::jsonb)
      on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
      [sha(manifest), JSON.stringify({ runId: RUN_ID, configurations: 7, listings: 16, status: "draft_only" })]);
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new Error("Danawa source batch was not created");
    let inserted = 0, alreadyPresent = 0;
    for (const [index, entry] of manifest.entries.entries()) {
      const specKey = `danawa-hybrid-motor-${RUN_ID.slice(0, 8)}-${entry.sourceListingId}`;
      const prior = await db.query<{ status: string; calculation_power_kw: string; evidence_source_uri: string | null }>(`
        select s.status,s.calculation_power_kw::text,e.source_uri as evidence_source_uri
        from public.vehicle_power_specs s left join public.vehicle_power_evidence e on e.id=s.evidence_id
        where s.spec_key=$1 and s.version=1`, [specKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].status !== "draft" || Number(prior.rows[0].calculation_power_kw) !== entry.calculationPowerKw ||
            prior.rows[0].evidence_source_uri !== entry.sourceUrl)
          throw new Error(`Conflicting existing spec ${specKey}; transaction aborted`);
        alreadyPresent++;
        continue;
      }
      const raw = await db.query<{ id: string }>(`
        insert into public.vehicle_power_source_rows
          (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
        values ($1,'danawa-hybrid-motor-21a687ee-v1',$2,$3::jsonb,$4,$5,'parsed')
        on conflict (batch_id,source_sheet,source_row_number) do update set raw_record=excluded.raw_record
        returning id`, [batchId, index + 1, JSON.stringify(entry), `${entry.brand} ${entry.model} ${entry.year}`,
        `parallel hybrid: ICE ${entry.enginePowerPs} PS + electric motor ${entry.electricMotorPowerPs} PS; no 30-minute rating`]);
      const evidence = await db.query<{ id: string }>(`
        insert into public.vehicle_power_evidence
          (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
           brand,model,trim,fuel_type,production_year_from,production_year_to,propulsion_type,dvs_power_kw,
           electric_power_kw_30min,hybrid_electric_motor_power_kw,peak_power_kw,source_units,reliability,
           review_status,review_note)
        values ($1,$2,'danawa',$3,$4,current_date,'M1',$5,$6,$7,'hybrid',$8,$8,'hybrid_parallel',$9,
           null,$10,$10,'PS','medium','draft',$11) returning id`,
        [batchId, raw.rows[0]?.id, entry.sourceUrl, `Danawa model ${entry.sourceModelCode}: ${entry.sourceTitle}`,
          entry.brand, entry.model, entry.grade, entry.year, kw(entry.enginePowerPs), kw(entry.electricMotorPowerPs),
          `Run ${RUN_ID}; Encar listing ${entry.sourceListingId}. ${entry.sourceNote}. Preliminary evidence only.`]);
      const spec = await db.query<{ id: string }>(`
        insert into public.vehicle_power_specs
          (spec_key,version,status,vehicle_category,propulsion_type,dvs_power_kw,electric_power_kw_30min,
           hybrid_electric_motor_power_kw,calculation_power_kw,evidence_id,approval_note,power_basis,source_priority,
           hybrid_type,power_ice_hp,power_electric_30min_hp,power_electric_motor_hp,customs_power_hp,system_power_hp)
        values ($1,1,'draft','M1','hybrid_parallel',$2,null,$3,$4,$5,$6,'parallel_sum',90,
          'parallel',$7,null,$8,$9,null) returning id`,
        [specKey, kw(entry.enginePowerPs), kw(entry.electricMotorPowerPs), entry.calculationPowerKw, evidence.rows[0]?.id,
          `Run-scoped preliminary only; Encar ${entry.sourceListingId}; Danawa model ${entry.sourceModelCode}; no global match.`,
          entry.enginePowerPs, entry.electricMotorPowerPs, entry.customsPowerPs]);
      if (!spec.rows[0]?.id) throw new Error(`Draft spec insert failed for ${entry.sourceListingId}`);
      inserted++;
    }
    await db.query("commit");
    console.log(JSON.stringify({ runId: RUN_ID, batchId, insertedDraftSpecs: inserted, alreadyPresent,
      databaseWrites: inserted, carsChanged: 0, pricesChanged: 0, publications: 0 }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
