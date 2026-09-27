/** Persist run-scoped EncarRus electric/HAR evidence as non-resolvable draft specs. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const manifestPath = "data/power/electrified-21a687ee-power-reference.json";
const write = process.env.TL_AUTO_ELECTRIFIED_IMPORT_WRITE === "true";
type Entry = { sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: "drom" | "encarrus_catalog" | "encarrus_detail_har"; sourceUrl: string; sourceNote: string;
  powerBasis: "parallel_sum" | "electric_30min"; customsPowerPs: number; calculationPowerKw: number;
  enginePowerPs: number | null; electric30MinPs: number; peakOrSystemPowerPs: number | null;
  grade: string | null; gradeDetail: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kw = (ps: number) => Number((ps * 0.73549875).toFixed(4));

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { runId: string; counts: { encarrusHar: number; electricCatalog: number }; entries: Entry[] };
  if (manifest.runId !== runId) throw new Error("Wrong run ID");
  const entries = manifest.entries.filter((entry) => entry.sourceKind !== "drom");
  if (manifest.counts.encarrusHar !== 14 || manifest.counts.electricCatalog !== 73 || entries.length !== 87 ||
      new Set(entries.map((entry) => entry.sourceListingId)).size !== 87) throw new Error("Manifest membership changed");
  for (const entry of entries) {
    if (!Number.isFinite(entry.customsPowerPs) || entry.customsPowerPs <= 0 || !Number.isFinite(entry.electric30MinPs) || entry.electric30MinPs <= 0 ||
        !entry.sourceUrl.startsWith("https://encarrus.ru/") ||
        (entry.fuelType === "electric" ? entry.enginePowerPs !== null || entry.powerBasis !== "electric_30min" || kw(entry.electric30MinPs) !== entry.calculationPowerKw
          : !entry.enginePowerPs || entry.powerBasis !== "parallel_sum" || entry.customsPowerPs !== entry.enginePowerPs + entry.electric30MinPs ||
            Number((kw(entry.enginePowerPs) + kw(entry.electric30MinPs)).toFixed(4)) !== entry.calculationPowerKw))
      throw new Error(`Invalid power or source: ${entry.sourceListingId}`);
  }
  if (!write) { console.log(JSON.stringify({ runId, validated: entries.length, write: false, databaseWrites: 0 })); return; }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const q = await db.query<{ id: string }>(`insert into public.vehicle_power_source_batches
       (source_kind,source_name,source_sha256,source_version,imported_by,metadata)
       values ('manual','EncarRus electrified preliminary evidence',$1,'encarrus-electrified-21a687ee-v1','encarrus-electrified-import-v1',$2::jsonb)
       on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
      [hash(entries), JSON.stringify({ runId, entries: entries.length, status: "draft_only" })]);
    const batchId = q.rows[0]?.id;
    if (!batchId) throw new Error("Missing source batch");
    let inserted = 0;
    for (const [index, entry] of entries.entries()) {
      const key = `encarrus-${entry.sourceKind}-${runId.slice(0, 8)}-${entry.sourceListingId}`;
      const prior = await db.query<{ status: string; calculation_power_kw: string }>(
        `select status,calculation_power_kw::text from public.vehicle_power_specs where spec_key=$1 and version=1`, [key]);
      if (prior.rows.length) {
        if (prior.rows[0].status !== "draft" || Number(prior.rows[0].calculation_power_kw) !== entry.calculationPowerKw)
          throw new Error(`Protected existing spec: ${key}`);
        continue;
      }
      const raw = await db.query<{ id: string }>(`insert into public.vehicle_power_source_rows
        (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
        values ($1,'encarrus-electrified-21a687ee-v1',$2,$3::jsonb,$4,$5,'parsed') returning id`,
        [batchId, index + 1, JSON.stringify(entry), `${entry.brand} ${entry.model} ${entry.year}`,
          `${entry.customsPowerPs} PS calculation; ICE ${entry.enginePowerPs ?? "none"} PS; 30-min electric ${entry.electric30MinPs} PS`]);
      const evidence = await db.query<{ id: string }>(`insert into public.vehicle_power_evidence
        (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
         brand,model,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
         dvs_power_kw,electric_power_kw_30min,source_units,reliability,review_status,review_note)
        values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,$9,$9,$10,$11,$12,'PS','medium','draft',$13)
        returning id`,
        [batchId, raw.rows[0].id, entry.sourceUrl, `${entry.sourceKind} / Encar ${entry.sourceListingId}`,
          entry.brand, entry.model, [entry.grade, entry.gradeDetail].filter(Boolean).join(" / ") || null,
          entry.fuelType, entry.year, entry.fuelType === "electric" ? "electric" : "hybrid_parallel",
          entry.enginePowerPs == null ? null : kw(entry.enginePowerPs), kw(entry.electric30MinPs),
          `Run ${runId}; Encar listing ${entry.sourceListingId}. ${entry.sourceNote}. Draft/preliminary; no automatic global matching.`]);
      const spec = await db.query(`insert into public.vehicle_power_specs
        (spec_key,version,status,vehicle_category,propulsion_type,dvs_power_kw,electric_power_kw_30min,
         calculation_power_kw,evidence_id,approval_note,power_basis,source_priority,hybrid_type,
         power_ice_hp,power_electric_30min_hp,customs_power_hp,system_power_hp)
        values ($1,1,'draft','M1',$2,$3,$4,$5,$6,$7,$8,90,$9,$10,$11,$12,$13) returning id`,
        [key, entry.fuelType === "electric" ? "electric" : "hybrid_parallel",
          entry.enginePowerPs == null ? null : kw(entry.enginePowerPs), kw(entry.electric30MinPs), entry.calculationPowerKw,
          evidence.rows[0].id, `Run-scoped preliminary evidence only; Encar ${entry.sourceListingId}; ${entry.sourceUrl}`,
          entry.powerBasis, entry.fuelType === "electric" ? "electric" : "parallel", entry.enginePowerPs,
          entry.electric30MinPs, entry.customsPowerPs, entry.peakOrSystemPowerPs]);
      if (!spec.rows[0]?.id) throw new Error(`Spec insert failed: ${key}`);
      // No vehicle_power_spec_matches: a catalogue-level match must never
      // spread this listing-specific preliminary power to a different trim.
      inserted++;
    }
    await db.query("commit");
    console.log(JSON.stringify({ runId, insertedDraftSpecs: inserted, existingDraftSpecs: entries.length - inserted, databaseWrites: inserted, carsChanged: 0, publications: 0 }));
  } catch (error) { await db.query("rollback").catch(() => undefined); throw error; }
  finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
