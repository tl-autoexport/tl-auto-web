import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const archiveRunId = process.env.CATALOG_ARCHIVE_RUN_ID?.trim();
const dryRun = process.env.CATALOG_RESTORE_DRY_RUN !== "false";
if (!dbUrl || !archiveRunId) throw new Error("SUPABASE_DB_URL and CATALOG_ARCHIVE_RUN_ID are required");

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const members = await client.query<{ count: string }>("select count(*)::text as count from public.catalog_archive_members where archive_run_id = $1", [archiveRunId]);
    const count = Number(members.rows[0]?.count ?? 0);
    if (!count) throw new Error("Archive run was not found or has no cars");
    if (dryRun) {
      await client.query("rollback");
      console.log(JSON.stringify({ dryRun, archiveRunId, restorable: count }, null, 2));
      return;
    }
    const update = await client.query("update public.cars set is_available = true where id in (select car_id from public.catalog_archive_members where archive_run_id = $1)", [archiveRunId]);
    await client.query("update public.catalog_archive_runs set restored_at = now() where id = $1", [archiveRunId]);
    await client.query("commit");
    console.log(JSON.stringify({ dryRun, archiveRunId, restored: update.rowCount ?? 0 }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

