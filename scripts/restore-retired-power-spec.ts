import { Client } from "pg";
import { config } from "dotenv";

/**
 * Restores a specification that was retired by the reconciliation, returning it
 * to the approved set. Used when a merge turns out to hide a real conflict
 * instead of a duplicate: ambiguity is protective, a confident wrong match is
 * not. Read-only by default; set SPEC_RESTORE_WRITE=true to apply.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.SPEC_RESTORE_WRITE === "true";
const keys = (process.env.SPEC_RESTORE_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
if (!keys.length) throw new Error("SPEC_RESTORE_KEYS is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const before = await db.query(`select spec_key, status from public.vehicle_power_specs where spec_key = any($1)`, [keys]);
    let written = 0;
    if (write) {
      const result = await db.query(
        `update public.vehicle_power_specs
            set status='approved', approval_note = coalesce(approval_note,'') || ' Restored: the merge hid a real conflict.', updated_at=now()
          where spec_key = any($1) and status='retired'`,
        [keys],
      );
      written = result.rowCount ?? 0;
    }
    const after = await db.query(`select spec_key, status from public.vehicle_power_specs where spec_key = any($1)`, [keys]);
    console.log(JSON.stringify({ dryRun: !write, requested: keys, before: before.rows, after: after.rows, written,
      encarRequests: 0, publicCatalogChanged: false }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
