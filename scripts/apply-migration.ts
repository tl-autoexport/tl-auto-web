import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL is required to apply migrations");
}

async function main() {
  const requestedMigration = process.argv[2];
  const migrationPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    requestedMigration ?? "20260704_mvp_foundation.sql",
  );
  const sql = await readFile(migrationPath, "utf8");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("migration applied", { migrationPath });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
