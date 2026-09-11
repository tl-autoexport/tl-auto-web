import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.CATALOG_ARCHIVE_DRY_RUN !== "false";
const reason = process.env.CATALOG_ARCHIVE_REASON?.trim() || "Catalogue reset before Chesty Prigon import";

if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const count = await client.query<{ count: string }>("select count(*)::text as count from public.cars where is_available = true");
    const activeCars = Number(count.rows[0]?.count ?? 0);
    if (dryRun) {
      await client.query("rollback");
      console.log(JSON.stringify({ dryRun, activeCars, reason, action: "No data changed. Set CATALOG_ARCHIVE_DRY_RUN=false to archive." }, null, 2));
      return;
    }
    const run = await client.query<{ id: string }>(
      "insert into public.catalog_archive_runs (reason, source_filter, cars_count) values ($1, $2, $3) returning id",
      [reason, "is_available = true", activeCars],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error("Could not create archive run");
    await client.query(
      "insert into public.catalog_archive_members (archive_run_id, car_id, original_payload) select $1, id, to_jsonb(cars) from public.cars where is_available = true",
      [runId],
    );
    const update = await client.query("update public.cars set is_available = false where is_available = true");
    await client.query("commit");
    console.log(JSON.stringify({ dryRun, archiveRunId: runId, archived: update.rowCount ?? 0, reason, recoverable: true }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

