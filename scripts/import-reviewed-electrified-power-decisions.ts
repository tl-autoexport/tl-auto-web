/** Import exactly the reviewed, run-scoped electrified power decisions as draft evidence. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const manifestPath = "data/power/electrified-21a687ee-power-reference.json";
const decisionsPath = "data/power/electrified-21a687ee-reviewed-decisions.json";
const write = process.env.TL_AUTO_REVIEWED_ELECTRIFIED_IMPORT_WRITE === "true";
const kw = (ps: number) => Number((ps * 0.73549875).toFixed(4));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type Entry = {
  sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: "drom" | "encarrus_catalog"; sourceUrl: string; sourceNote: string;
  powerBasis: "parallel_sum" | "electric_30min"; customsPowerPs: number; calculationPowerKw: number;
  enginePowerPs: number | null; electric30MinPs: number; peakOrSystemPowerPs: number | null;
  grade: string | null; gradeDetail: string | null;
};

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { runId: string; entries: Entry[] };
  const decisions = JSON.parse(await readFile(decisionsPath, "utf8")) as { runId: string; entries: Array<{ sourceListingId: string }> };
  const ids = ["42775951", "42775980", "42738019", "42759595", "42793135", "42778227"];
  if (manifest.runId !== runId || decisions.runId !== runId) throw new Error("Run ID mismatch");
  if (decisions.entries.length !== ids.length || ids.some((id, index) => decisions.entries[index]?.sourceListingId !== id))
    throw new Error("Reviewed decision membership/order changed; refusing import");
  const entries = ids.map((id) => manifest.entries.find((entry) => entry.sourceListingId === id));
  if (entries.some((entry) => !entry)) throw new Error("A reviewed decision is missing from the reference manifest");
  const exact = entries as Entry[];
  for (const entry of exact) {
    const validHybrid = entry.fuelType === "hybrid" && entry.powerBasis === "parallel_sum" && entry.enginePowerPs != null &&
      entry.customsPowerPs === entry.enginePowerPs + entry.electric30MinPs &&
      Math.abs(entry.calculationPowerKw - Number((kw(entry.enginePowerPs) + kw(entry.electric30MinPs)).toFixed(4))) < 0.00001;
    const validElectric = entry.fuelType === "electric" && entry.powerBasis === "electric_30min" && entry.enginePowerPs == null &&
      entry.customsPowerPs === entry.electric30MinPs && Math.abs(entry.calculationPowerKw - kw(entry.electric30MinPs)) < 0.00001;
    if (!entry.sourceUrl.startsWith("https://") || !(validHybrid || validElectric))
      throw new Error(`Invalid source/power basis for ${entry.sourceListingId}`);
  }
  if (!write) {
    console.log(JSON.stringify({ runId, validated: exact.map(({ sourceListingId, sourceKind, brand, model, customsPowerPs }) =>
      ({ sourceListingId, sourceKind, brand, model, customsPowerPs })), write: false, databaseWrites: 0 }));
    return;
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const batch = await db.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
        (source_kind,source_name,source_sha256,source_version,imported_by,metadata)
       values ('manual','Reviewed electrified preliminary decisions',$1,'reviewed-electrified-21a687ee-v1',
         'reviewed-electrified-import-v1',$2::jsonb)
       on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
      [sha256(exact), JSON.stringify({ runId, entries: exact.length, status: "draft_only", runScoped: true })],
    );
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new Error("Could not create evidence source batch");
    let inserted = 0;
    for (const [index, entry] of exact.entries()) {
      const specKey = `reviewed-electrified-${runId.slice(0, 8)}-${entry.sourceListingId}`;
      const prior = await db.query<{ status: string; calculation_power_kw: string; evidence_source_uri: string | null }>(
        `select s.status,s.calculation_power_kw::text,e.source_uri as evidence_source_uri
           from public.vehicle_power_specs s
           left join public.vehicle_power_evidence e on e.id=s.evidence_id
          where s.spec_key=$1 and s.version=1`, [specKey],
      );
      if (prior.rows[0]) {
        const current = prior.rows[0];
        if (current.status !== "draft" || Number(current.calculation_power_kw) !== entry.calculationPowerKw ||
            current.evidence_source_uri !== entry.sourceUrl)
          throw new Error(`Conflicting/protected existing spec ${specKey}; transaction aborted`);
        continue;
      }
      const raw = await db.query<{ id: string }>(
        `insert into public.vehicle_power_source_rows
          (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status)
         values ($1,'reviewed-electrified-21a687ee-v1',$2,$3::jsonb,$4,$5,'parsed') returning id`,
        [batchId, index + 1, JSON.stringify(entry), `${entry.brand} ${entry.model} ${entry.year}`,
          `${entry.customsPowerPs} PS calculation; ICE ${entry.enginePowerPs ?? "none"} PS; 30-min electric ${entry.electric30MinPs} PS`],
      );
      const evidence = await db.query<{ id: string }>(
        `insert into public.vehicle_power_evidence
          (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,
           brand,model,trim,fuel_type,production_year_from,production_year_to,propulsion_type,
           dvs_power_kw,electric_power_kw_30min,source_units,reliability,review_status,review_note)
         values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,$9,$9,$10,$11,$12,'PS','medium','draft',$13)
         returning id`,
        [batchId, raw.rows[0]?.id, entry.sourceUrl, `${entry.sourceKind} / Encar ${entry.sourceListingId}`,
          entry.brand, entry.model, [entry.grade, entry.gradeDetail].filter(Boolean).join(" / ") || null,
          entry.fuelType, entry.year, entry.fuelType === "electric" ? "electric" : "hybrid_parallel",
          entry.enginePowerPs == null ? null : kw(entry.enginePowerPs), kw(entry.electric30MinPs),
          `Run ${runId}; Encar listing ${entry.sourceListingId}. ${entry.sourceNote}. Draft/preliminary; no global matching.`],
      );
      const spec = await db.query<{ id: string }>(
        `insert into public.vehicle_power_specs
          (spec_key,version,status,vehicle_category,propulsion_type,dvs_power_kw,electric_power_kw_30min,
           calculation_power_kw,evidence_id,approval_note,power_basis,source_priority,hybrid_type,
           power_ice_hp,power_electric_30min_hp,customs_power_hp,system_power_hp)
         values ($1,1,'draft','M1',$2,$3,$4,$5,$6,$7,$8,90,$9,$10,$11,$12,$13) returning id`,
        [specKey, entry.fuelType === "electric" ? "electric" : "hybrid_parallel",
          entry.enginePowerPs == null ? null : kw(entry.enginePowerPs), kw(entry.electric30MinPs), entry.calculationPowerKw,
          evidence.rows[0]?.id, `Run-scoped preliminary evidence only; Encar ${entry.sourceListingId}; ${entry.sourceUrl}`,
          entry.powerBasis, entry.fuelType === "electric" ? "electric" : "parallel", entry.enginePowerPs,
          entry.electric30MinPs, entry.customsPowerPs, entry.peakOrSystemPowerPs],
      );
      if (!spec.rows[0]?.id) throw new Error(`Spec insert failed: ${specKey}`);
      inserted++;
    }
    await db.query("commit");
    console.log(JSON.stringify({ runId, insertedDraftSpecs: inserted, existingDraftSpecs: exact.length - inserted,
      databaseWrites: inserted, carsChanged: 0, calculationsChanged: 0, publications: 0 }));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
