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
  const nonTransactional = /^-- migrate:non-transactional$/m.test(sql);
  // Concurrent indexes keep catalogue imports/writes available. Only this
  // additive DDL is permitted outside the usual all-or-nothing transaction.
  const statements = nonTransactional
    ? sql.replace(/^--.*$/gm, "").split(";").map((statement) => statement.trim()).filter(Boolean)
    : [];
  if (nonTransactional && (!statements.length || statements.some((statement) =>
    !/^create index concurrently if not exists [a-z0-9_]+\s+on public\.(cars|catalog_vehicle_names)\s+\(/i.test(statement)))) {
    throw new Error("Non-transactional migrations must contain only additive concurrent catalogue indexes");
  }
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    if (nonTransactional) {
      await client.query("set lock_timeout = '5s'");
      await client.query("set statement_timeout = '120s'");
      for (const statement of statements) {
        await client.query(statement);
        const index = statement.match(/if not exists ([a-z0-9_]+)/i)![1];
        const validity = await client.query<{ valid: boolean }>(
          "select i.indisvalid and i.indisready as valid from pg_index i where i.indexrelid = to_regclass($1)",
          [`public.${index}`],
        );
        if (validity.rows[0]?.valid !== true) throw new Error(`Concurrent index is not valid: ${index}`);
        console.log("concurrent index applied", { index });
      }
    } else {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
    }
    console.log("migration applied", { migrationPath });
  } catch (error) {
    if (!nonTransactional) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
