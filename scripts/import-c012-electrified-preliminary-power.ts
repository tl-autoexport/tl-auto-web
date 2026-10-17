/** Store this run's 100 preliminary electrified power values as draft, listing-scoped specs. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });
const RUN_ID = "c012d314-d718-48b0-97d9-857f7a96af1e";
const POWER_PATH = `output/tl-auto-run-${RUN_ID}-power-reference.json`;
const WRITE = process.env.TL_AUTO_ELECTRIFIED_IMPORT_WRITE === "true";
const KW_PER_PS = 0.73549875;
type Entry = { sourceListingId: string; brand: string; model: string; year: number; engineCc: number | null; fuelType: "hybrid" | "electric";
  sourceKind: string; sourceUrl: string; sourceNote: string; powerBasis: "parallel_sum" | "electric_30min";
  customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null; electric30MinPs: number | null;
  electric30MinKw: number | null; peakMotorPowerPs: number | null; peakMotorPowerKw: number | null; peakOrSystemPowerPs: number | null;
  grade: string | null; gradeDetail: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kw = (ps: number) => Number((ps * KW_PER_PS).toFixed(4));

async function main() {
  const report = JSON.parse(await readFile(POWER_PATH, "utf8")) as { runId: string; entries: Entry[]; unresolved: unknown[] };
  if (report.runId !== RUN_ID || report.entries.length !== 100 || report.unresolved.length !== 0 ||
      new Set(report.entries.map((e) => e.sourceListingId)).size !== 100) throw new Error("Power report membership/status changed");
  for (const e of report.entries) {
    if (!e.sourceUrl.startsWith("https://") || !Number.isFinite(e.calculationPowerKw) || e.calculationPowerKw <= 0 ||
        (e.fuelType === "electric" && (e.powerBasis !== "electric_30min" || e.electric30MinKw !== e.calculationPowerKw || e.enginePowerPs != null)) ||
        (e.fuelType === "hybrid" && (e.powerBasis !== "parallel_sum" || e.enginePowerPs == null || e.electricMotorPowerKw == null ||
          Math.abs(e.calculationPowerKw - kw(e.enginePowerPs) - e.electricMotorPowerKw) > 0.0002)))
      throw new Error(`Invalid calculation basis/source for ${e.sourceListingId}`);
  }
  if (!WRITE) {
    console.log(JSON.stringify({ runId: RUN_ID, validated: report.entries.length, hybrid: report.entries.filter((e) => e.fuelType === "hybrid").length,
      electric: report.entries.filter((e) => e.fuelType === "electric").length, write: false, databaseWrites: 0,
      status: "draft_only", noGlobalMatches: true }, null, 2));
    return;
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let inserted = 0, existing = 0;
  try {
    await db.query("begin");
    const sourceBatch = await db.query<{ id: string }>(`insert into public.vehicle_power_source_batches
      (source_kind,source_name,source_sha256,source_version,imported_by,metadata)
      values ('manual',$1,$2,'c012-electrified-preliminary-v1','c012-electrified-import-v1',$3::jsonb)
      on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
      [`Encar run ${RUN_ID} preliminary electrified powers`, hash(report.entries), JSON.stringify({ runId: RUN_ID,
        entries: 100, hybrid: 50, electric: 50, status: "draft_only", sourceReport: POWER_PATH })]);
    const batchId = sourceBatch.rows[0]?.id;
    if (!batchId) throw new Error("No source batch ID returned");
    for (const [index, e] of report.entries.entries()) {
      const key = `encar-${RUN_ID.slice(0, 8)}-${e.sourceListingId}`;
      const found = await db.query<{ status: string; calculation_power_kw: string; evidence_id: string }>(
        `select status,calculation_power_kw::text,evidence_id from public.vehicle_power_specs where spec_key=$1 and version=1`, [key]);
      if (found.rows.length) {
        if (found.rows[0].status !== "draft" || Number(found.rows[0].calculation_power_kw) !== e.calculationPowerKw)
          throw new Error(`Protected nonmatching existing spec: ${key}`);
        existing++;
        continue;
      }
      const raw = await db.query<{ id: string }>(`insert into public.vehicle_power_source_rows
        (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
        values ($1,'c012-en-car-electrified',$2,$3::jsonb,$4,$5,'parsed') returning id`,
        [batchId, index + 1, JSON.stringify(e), `${e.brand} ${e.model} ${e.year}`,
          `${e.customsPowerPs} PS calculation power; 30-minute electric ${e.electric30MinPs ?? e.electricMotorPowerPs ?? "n/a"} PS`]);
      const propulsion = e.fuelType === "electric" ? "electric" : "hybrid_parallel";
      const iceKw = e.enginePowerPs == null ? null : kw(e.enginePowerPs);
      const electric30Kw = e.fuelType === "electric" ? e.electric30MinKw : e.electricMotorPowerKw;
      const ev = await db.query<{ id: string }>(`insert into public.vehicle_power_evidence
        (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
         brand,model,generation,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
         dvs_power_kw,electric_power_kw_30min,hybrid_electric_motor_power_kw,source_units,reliability,review_status,review_note)
        values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,null,'PS','medium','draft',$14)
        returning id`,
        [batchId, raw.rows[0].id, e.sourceUrl, e.sourceKind, e.brand, e.model, null, e.gradeDetail ?? e.grade,
          e.fuelType, e.year, propulsion, iceKw, electric30Kw,
          `Preliminary listing-specific evidence for Encar ${e.sourceListingId}; ${e.sourceKind}; ${e.sourceUrl}. ${e.sourceNote}`]);
      if (!ev.rows[0]?.id) throw new Error(`Evidence insert failed: ${e.sourceListingId}`);
      const spec = await db.query<{ id: string }>(`insert into public.vehicle_power_specs
        (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,
         electric_power_kw_30min,hybrid_electric_motor_power_kw,calculation_power_kw,evidence_id,approval_note,
         power_basis,source_priority,hybrid_type,power_ice_hp,power_electric_30min_hp,power_electric_motor_hp,
         customs_power_hp,system_power_hp)
        values ($1,1,'draft','M1',$2,$3,$3,$4,$5,null,$6,$7,$8,$9,90,$10,$11,$12,$13,$14,$15) returning id`,
        [key, propulsion, e.engineCc, iceKw, electric30Kw, e.calculationPowerKw, ev.rows[0].id,
          `Run-scoped preliminary source evidence only; Encar ${e.sourceListingId}; ${e.sourceUrl}`,
          e.powerBasis, e.fuelType === "electric" ? "electric" : "parallel", e.enginePowerPs,
          e.fuelType === "electric" ? e.electric30MinPs : e.electricMotorPowerPs,
          e.peakMotorPowerPs, e.customsPowerPs, e.peakOrSystemPowerPs]);
      if (!spec.rows[0]?.id) throw new Error(`Spec insert failed: ${e.sourceListingId}`);
      inserted++;
    }
    await db.query("commit");
    console.log(JSON.stringify({ runId: RUN_ID, insertedDraftSpecs: inserted, existingMatchingDraftSpecs: existing,
      databaseWrites: inserted, publicCarsChanged: 0, publications: 0, noGlobalMatches: true }, null, 2));
  } catch (error) { await db.query("rollback").catch(() => undefined); throw error; }
  finally { await db.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
