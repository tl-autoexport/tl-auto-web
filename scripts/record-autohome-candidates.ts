import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const input = process.env.AUTOHOME_BEST_FIT_INPUT ?? "/tmp/tl-auto-autohome-ice-best-fit-years-badge3.json";
const sourceBase = "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse";

type KeyFields = {
  manufacturer?: string | null; model?: string | null; generation?: string | null; trim?: string | null;
  model_year?: number | null; engine_cc?: number | null; fuel_type?: string | null; drive_type?: string | null;
};
type StagingRow = KeyFields & { source_listing_id: string };
type CandidateSpec = { powerHp?: number | string | null; year?: number | null; specId?: string | null; name?: string | null; drive?: string | null };
type Candidate = KeyFields & {
  seriesId?: string | number | null; selectedPowerHp?: number | string | null; decision?: string; candidates?: CandidateSpec[];
};

function equalField(field: string, value: unknown) { return value == null ? `${field} is null` : `${field} = $VALUE`; }
function key(row: KeyFields) { return [row.manufacturer,row.model,row.generation,row.trim,row.model_year,row.engine_cc,row.fuel_type,row.drive_type].map((x) => x ?? "<null>").join("|"); }

async function main() {
  const report = JSON.parse(await readFile(input, "utf8"));
  const accepted = report.accepted as Candidate[];
  const sourceSha = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
try {
  await db.query("begin");
  const batchResult = await db.query<{ id: string }>(`insert into public.vehicle_power_source_batches
      (source_kind,source_name,source_uri,source_sha256,source_version,imported_by,metadata)
    values ('manual','AutoHome alternative specification candidates',$1,$2,'autohome-candidate-v1','record-autohome-candidates-v1',$3::jsonb)
    on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`, [sourceBase, sourceSha, JSON.stringify({ actualSourceKind: "autohome", runId, input, totalCards: report.totalCards, acceptedCards: report.acceptedCards, policy: "Candidate only; no automatic publication or price update" })]);
  const batchId = batchResult.rows[0]?.id;
  if (!batchId) throw new Error("AutoHome source batch was not created");

  const cards = await db.query<StagingRow>(`select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type
    from public.chestny_catalog_staging s join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id
      and q.run_id=$1 and q.status='succeeded'
    where s.source_status='active' and s.promotion_status='auto_candidate' and s.fuel_type in ('가솔린','디젤')`, [runId]);
  const groups = new Map(accepted.map((row) => [key(row), row]));
  let recordedGroups = 0, updatedCards = 0, sourceRows = 0;
  const seen = new Set<string>();
  for (const row of cards.rows) {
    const candidate = groups.get(key(row));
    if (!candidate) continue;
    const selected = Number(candidate.selectedPowerHp);
    if (!Number.isFinite(selected) || selected <= 0) continue;
    const spec = candidate.candidates?.find((x: CandidateSpec) => Number(x.powerHp) === selected) ?? candidate.candidates?.[0];
    const year = candidate.model_year ?? spec?.year ?? new Date().getUTCFullYear();
    const sourceUri = `${sourceBase}?seriesid=${candidate.seriesId}&tagid=${year}&tagname=${encodeURIComponent(`${year}款`)}&cityid=110100`;
    const record = { source: "AutoHome", source_uri: sourceUri, series_id: candidate.seriesId, spec_id: spec?.specId ?? null, source_year: year, power_hp: selected, decision: candidate.decision, source_spec_name: spec?.name ?? null, source_drive: spec?.drive ?? null, review_status: "draft", recorded_at: new Date().toISOString() };
    if (!seen.has(key(candidate))) {
      const sourceRow = await db.query<{ id: string }>(`insert into public.vehicle_power_source_rows
        (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status,review_classification,classification_rule_version,classified_at)
        values ($1,'autohome-best-fit',$2,$3::jsonb,$4,$5,'parsed','range_or_ambiguous','autohome-candidate-v1',now())
        on conflict (batch_id,source_sheet,source_row_number) do update set raw_record=excluded.raw_record,raw_power_text=excluded.raw_power_text,review_classification=excluded.review_classification,classified_at=now()
        returning id`, [batchId, sourceRows + 1, JSON.stringify({ group: candidate, candidate: record }), `${row.manufacturer} ${row.model}`, `${selected} PS`]);
        sourceRows += 1; seen.add(key(candidate)); recordedGroups += 1;
    }
    await db.query(`update public.chestny_catalog_staging set raw_payload = raw_payload || jsonb_build_object('autohome_power_candidate',$2::jsonb), updated_at=now()
      where source_listing_id=$1 and promotion_status='auto_candidate'`, [row.source_listing_id, JSON.stringify(record)]);
    updatedCards += 1;
  }
  await db.query("commit");
  console.log(JSON.stringify({ batchId, input, acceptedGroups: accepted.length, recordedGroups, sourceRows, updatedCards, note: "Candidate data recorded as draft; promotion_status and prices unchanged." }, null, 2));
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  throw error;
} finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
