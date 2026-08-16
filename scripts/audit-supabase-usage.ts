import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for the database audit");

type IndexAudit = {
  table_name: string;
  index_name: string;
  size_bytes: string;
  idx_scan: string;
  definition: string;
};

type SnapshotRetention = {
  source: string;
  redundant_snapshots: string;
  redundant_payload_bytes: string;
};

async function main() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const database = await client.query<{ database_size_bytes: string }>(
      "select pg_database_size(current_database())::text as database_size_bytes",
    );
    const unusedIndexes = await client.query<IndexAudit>(`
        select
          relname as table_name,
          indexrelname as index_name,
          pg_relation_size(indexrelid)::text as size_bytes,
          idx_scan::text,
          pg_get_indexdef(indexrelid) as definition
        from pg_stat_user_indexes
        where schemaname = 'public'
          and idx_scan = 0
          and indexrelname not like '%_pkey'
          and indexrelname not like '%_key'
        order by pg_relation_size(indexrelid) desc
      `);
    const snapshotRetention = await client.query<SnapshotRetention>(`
        select
          source,
          count(*) filter (where ordinal > 1)::text as redundant_snapshots,
          coalesce(sum(payload_bytes) filter (where ordinal > 1), 0)::text as redundant_payload_bytes
        from (
          select
            source,
            pg_column_size(payload) as payload_bytes,
            row_number() over (
              partition by source, source_id
              order by fetched_at desc
            ) as ordinal
          from source_snapshots
        ) snapshots
        group by source
        order by source
      `);

    const unusedIndexBytes = unusedIndexes.rows.reduce(
      (total, index) => total + Number(index.size_bytes),
      0,
    );
    const redundantSnapshotBytes = snapshotRetention.rows.reduce(
      (total, snapshot) => total + Number(snapshot.redundant_payload_bytes),
      0,
    );

    console.log(
      JSON.stringify(
        {
          databaseSizeBytes: Number(database.rows[0]?.database_size_bytes ?? 0),
          unusedIndexes: unusedIndexes.rows.map((index) => ({
            table: index.table_name,
            index: index.index_name,
            bytes: Number(index.size_bytes),
            scans: Number(index.idx_scan),
            definition: index.definition,
          })),
          unusedIndexBytes,
          snapshotRetention: snapshotRetention.rows.map((snapshot) => ({
            source: snapshot.source,
            redundantSnapshots: Number(snapshot.redundant_snapshots),
            redundantPayloadBytes: Number(snapshot.redundant_payload_bytes),
          })),
          redundantSnapshotBytes,
          note: "This script is read-only. It does not remove indexes, snapshots, media, or vehicle history.",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

void main();
