import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  try {
    const result = await client.query<{
      rows: string;
      table_bytes: string;
      total_bytes: string;
      avg_row_bytes: string;
      metadata_rows: string;
      raw_rows: string;
    }>(`
      select
        count(*)::text as rows,
        pg_relation_size('public.chestny_catalog_staging')::text as table_bytes,
        pg_total_relation_size('public.chestny_catalog_staging')::text as total_bytes,
        coalesce(avg(pg_column_size(s))::numeric(12,2), 0)::text as avg_row_bytes,
        count(*) filter (where raw_payload = '{}'::jsonb)::text as metadata_rows,
        count(*) filter (where raw_payload <> '{}'::jsonb)::text as raw_rows
      from public.chestny_catalog_staging s
    `);
    const row = result.rows[0];
    const rows = Number(row?.rows ?? 0);
    const avg = Number(row?.avg_row_bytes ?? 0);
    const projectedRows = 32265;
    console.log(JSON.stringify({
      table: "public.chestny_catalog_staging",
      rows,
      metadataRows: Number(row?.metadata_rows ?? 0),
      rawRows: Number(row?.raw_rows ?? 0),
      tableBytes: Number(row?.table_bytes ?? 0),
      totalBytesWithIndexes: Number(row?.total_bytes ?? 0),
      averageRowBytes: avg,
      projectedBytesFor32265Rows: Math.round(avg * projectedRows),
      freeDatabaseLimitBytes: 500 * 1024 * 1024,
      note: "Read-only audit. Projection excludes future indexes, WAL and other tables."
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
