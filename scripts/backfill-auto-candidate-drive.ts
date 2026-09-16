import { Client } from "pg";
import { config } from "dotenv";
import { normalizeDrive } from "../src/server/normalization/vehicles";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = { source_listing_id: string; drive_type: string | null; trim: string | null; generation: string | null; raw_payload: Record<string, unknown> | null };

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`select s.source_listing_id,s.drive_type,s.trim,s.generation,s.raw_payload
      from public.chestny_catalog_staging s join public.catalog_enrichment_queue q
        on q.source_listing_id=s.source_listing_id and q.run_id=$1
      where q.status='succeeded' and s.source_status='active' and s.promotion_status='auto_candidate'
        and (s.drive_type is null or btrim(s.drive_type)='')`, [runId]);
    const updates = rows.flatMap((row) => {
      const enrichment = (row.raw_payload?.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      // Only use vehicle-specific fields from the saved payload; do not infer
      // a default drive from the model name.
      const sourceText = [row.trim, row.generation, category.gradeName, category.gradeEnglishName, category.modelName]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0).join(" ");
      const drive = normalizeDrive(sourceText);
      if (!drive) return [];
      return [{ id: row.source_listing_id, drive, sourceText, payload: { ...(row.raw_payload ?? {}), drive_enrichment: { value: drive, source: "saved_payload_vehicle_fields", source_text: sourceText, resolved_at: new Date().toISOString() } } }];
    });
    let written = 0;
    await db.query("begin");
    try {
      for (let i = 0; i < updates.length; i += 250) {
        const batch = updates.slice(i, i + 250);
        const result = await db.query(`update public.chestny_catalog_staging as s
          set drive_type=v.drive_type, raw_payload=v.raw_payload, updated_at=now()
          from jsonb_to_recordset($1::jsonb) as v(source_listing_id text,drive_type text,raw_payload jsonb)
          where s.source_listing_id=v.source_listing_id and s.source_status='active' and s.promotion_status='auto_candidate'
            and (s.drive_type is null or btrim(s.drive_type)='')`, [JSON.stringify(batch.map((x) => ({ source_listing_id: x.id, drive_type: x.drive, raw_payload: x.payload })))]);
        written += result.rowCount ?? 0;
      }
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    console.log(JSON.stringify({ runId, scope: "auto_candidate", scanned: rows.length, driveCandidates: updates.length, written, encarRequests: 0, publicCatalogChanged: false }, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
