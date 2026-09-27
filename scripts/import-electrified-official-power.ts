/** Persist run-scoped official manufacturer power evidence as draft specs only. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const MANIFEST_PATH = "data/power/electrified-21a687ee-power-reference.json";
const WRITE = process.env.TL_AUTO_ELECTRIFIED_OFFICIAL_IMPORT_WRITE === "true";
const KW_PER_PS = 0.73549875;
type Entry = {
  sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: "official_manufacturer"; sourceUrl: string; sourceNote: string; powerBasis: "parallel_sum" | "electric_30min";
  customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null;
  electric30MinPs: number | null; electric30MinKw: number | null; peakOrSystemPowerPs: number | null;
  grade: string | null;
};
const kwFromPs = (ps: number) => Number((ps * KW_PER_PS).toFixed(4));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
    runId: string; entries: Entry[];
  };
  const entries = manifest.entries.filter((entry) => entry.sourceKind === "official_manufacturer");
  const ids = entries.map((entry) => entry.sourceListingId);
  if (manifest.runId !== RUN_ID || entries.length !== 34 || new Set(ids).size !== 34)
    throw new Error(`Run-scoped official membership mismatch: ${entries.length}`);
  for (const entry of entries) {
    if (!entry.sourceUrl.startsWith("https://") || entry.sourceNote.trim().length < 40)
      throw new Error(`Source provenance missing for ${entry.sourceListingId}`);
    if (entry.fuelType === "hybrid") {
      if (entry.powerBasis !== "parallel_sum" || entry.enginePowerPs == null || entry.electricMotorPowerKw == null ||
          entry.electricMotorPowerPs == null || entry.electric30MinPs != null || entry.electric30MinKw != null ||
          Math.abs(entry.customsPowerPs - entry.enginePowerPs - entry.electricMotorPowerPs) > 0.0001 ||
          Math.abs(entry.calculationPowerKw - kwFromPs(entry.enginePowerPs) - entry.electricMotorPowerKw) > 0.0001)
        throw new Error(`Hybrid must use ICE + peak motor power only: ${entry.sourceListingId}`);
    } else if (entry.powerBasis !== "electric_30min" || entry.enginePowerPs != null || entry.electricMotorPowerKw != null ||
      entry.electric30MinKw == null || Math.abs(entry.calculationPowerKw - entry.electric30MinKw) > 0.0001) {
      throw new Error(`EV must use 30-minute power only: ${entry.sourceListingId}`);
    }
  }
  if (!WRITE) {
    console.log(JSON.stringify({ runId: RUN_ID, validated: entries.length,
      hybrid: entries.filter((entry) => entry.fuelType === "hybrid").length,
      electric: entries.filter((entry) => entry.fuelType === "electric").length,
      databaseWrites: 0, carsChanged: 0, pricesChanged: 0, publications: 0,
      writeFlag: "TL_AUTO_ELECTRIFIED_OFFICIAL_IMPORT_WRITE=true" }, null, 2));
    return;
  }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for import");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const columns = await db.query<{ table_name: string; column_name: string }>(`
      select table_name,column_name from information_schema.columns
      where table_schema='public' and (
        (table_name='vehicle_power_evidence' and column_name in ('hybrid_electric_motor_power_kw','electric_power_kw_30min')) or
        (table_name='vehicle_power_specs' and column_name in ('hybrid_electric_motor_power_kw','power_electric_motor_hp','electric_power_kw_30min'))
      )`);
    if (columns.rows.length !== 5) throw new Error("Hybrid/EV power schema is incomplete; import stopped");

    const batchResult = await db.query<{ id: string }>(`
      insert into public.vehicle_power_source_batches
        (source_kind,source_name,source_sha256,source_version,imported_by,metadata)
      values ('manual','Official electrified manufacturer research',$1,'official-electrified-21a687ee-v1',
        'official-electrified-import-v1',$2::jsonb)
      on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
    [hash(entries), JSON.stringify({ runId: RUN_ID, entries: entries.length, status: "draft_only",
      note: "No car matching, calculation, price update or publication." })]);
    const batchId = batchResult.rows[0]?.id;
    if (!batchId) throw new Error("Source batch was not created");
    let inserted = 0, alreadyPresent = 0;
    for (const [index, entry] of entries.entries()) {
      const specKey = `official-electrified-${RUN_ID.slice(0, 8)}-${entry.sourceListingId}`;
      const prior = await db.query<{ status: string; calculation_power_kw: string; source_uri: string | null }>(`
        select s.status,s.calculation_power_kw::text,e.source_uri
        from public.vehicle_power_specs s left join public.vehicle_power_evidence e on e.id=s.evidence_id
        where s.spec_key=$1 and s.version=1`, [specKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].status !== "draft" || Number(prior.rows[0].calculation_power_kw) !== entry.calculationPowerKw ||
            prior.rows[0].source_uri !== entry.sourceUrl)
          throw new Error(`Conflicting existing spec ${specKey}; transaction rolled back`);
        alreadyPresent++;
        continue;
      }
      const rowResult = await db.query<{ id: string }>(`
        insert into public.vehicle_power_source_rows
          (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
        values ($1,'official-electrified-21a687ee-v1',$2,$3::jsonb,$4,$5,'parsed') returning id`,
      [batchId, index + 1, JSON.stringify(entry), `${entry.brand} ${entry.model} ${entry.year}`,
        entry.fuelType === "hybrid"
          ? `ICE ${entry.enginePowerPs} PS + peak electric motor ${entry.electricMotorPowerKw} kW; no hybrid 30-minute rating`
          : `EV 30-minute power ${entry.electric30MinKw} kW`]);
      const sourceRowId = rowResult.rows[0]?.id;
      if (!sourceRowId) throw new Error(`Source row insert failed for ${entry.sourceListingId}`);
      const evidenceResult = await db.query<{ id: string }>(`
        insert into public.vehicle_power_evidence
          (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
           brand,model,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
           dvs_power_kw,electric_power_kw_30min,hybrid_electric_motor_power_kw,
           source_units,reliability,review_status,review_note)
        values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,
           'official manufacturer units','medium','draft',$14) returning id`,
      [batchId, sourceRowId, entry.sourceUrl, `Run ${RUN_ID}; Encar ${entry.sourceListingId}; official manufacturer source`,
        entry.brand, entry.model, entry.grade, entry.fuelType, entry.year,
        entry.fuelType === "hybrid" ? "hybrid_parallel" : "electric",
        entry.enginePowerPs == null ? null : kwFromPs(entry.enginePowerPs), entry.electric30MinKw,
        entry.electricMotorPowerKw,
        `Run-scoped preliminary evidence. ${entry.sourceNote}`]);
      const evidenceId = evidenceResult.rows[0]?.id;
      if (!evidenceId) throw new Error(`Evidence insert failed for ${entry.sourceListingId}`);
      const specResult = await db.query<{ id: string }>(`
        insert into public.vehicle_power_specs
          (spec_key,version,status,vehicle_category,propulsion_type,dvs_power_kw,electric_power_kw_30min,
           hybrid_electric_motor_power_kw,calculation_power_kw,evidence_id,approval_note,power_basis,source_priority,
           hybrid_type,power_ice_hp,power_electric_30min_hp,power_electric_motor_hp,customs_power_hp,system_power_hp)
        values ($1,1,'draft','M1',$2,$3,$4,$5,$6,$7,$8,$9,90,$10,$11,$12,$13,$14,$15) returning id`,
      [specKey, entry.fuelType === "hybrid" ? "hybrid_parallel" : "electric",
        entry.enginePowerPs == null ? null : kwFromPs(entry.enginePowerPs), entry.electric30MinKw,
        entry.electricMotorPowerKw, entry.calculationPowerKw, evidenceId,
        `Run-scoped preliminary; Encar ${entry.sourceListingId}; ${entry.sourceUrl}. Not globally matched.`,
        entry.powerBasis, entry.fuelType === "hybrid" ? "parallel" : "electric", entry.enginePowerPs,
        entry.electric30MinPs, entry.electricMotorPowerPs, entry.customsPowerPs, entry.peakOrSystemPowerPs]);
      if (!specResult.rows[0]?.id) throw new Error(`Draft power spec insert failed for ${entry.sourceListingId}`);
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
