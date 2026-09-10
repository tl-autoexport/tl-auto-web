import { createHash } from "node:crypto";
import { Client } from "pg";
import { config } from "dotenv";
import { getLegacyPowerCandidates } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.LEGACY_POWER_IMPORT_DRY_RUN !== "false";
if (!dbUrl && !dryRun) throw new Error("SUPABASE_DB_URL is required when LEGACY_POWER_IMPORT_DRY_RUN=false");

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const candidates = getLegacyPowerCandidates();
  const rows = [
    ...candidates.exactSpecs,
    ...candidates.badgeMaps,
    ...candidates.modelMaps,
  ];
  const sourceSha256 = sha256(rows);
  const summary = {
    exactSpecs: candidates.exactSpecs.length,
    badgeMaps: candidates.badgeMaps.length,
    modelMaps: candidates.modelMaps.length,
    totalCandidates: rows.length,
    sourceSha256,
    policy: "staging only: no candidate is created as evidence or approved specification",
  };
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...summary, sample: rows.slice(0, 5) }, null, 2));
    return;
  }

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const batch = await client.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
         (source_kind, source_name, source_uri, source_sha256, source_version, imported_by, metadata)
       values ('manual', 'TL Auto legacy power maps', 'code:src/server/normalization/vehicles.ts', $1,
               'legacy-power-maps-v1', 'legacy-power-candidates-import-v1', $2::jsonb)
       on conflict (source_kind, source_sha256) do update
         set metadata = excluded.metadata
       returning id`,
      [sourceSha256, JSON.stringify(summary)],
    );
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new Error("Legacy power batch was not created");
    for (const [index, candidate] of rows.entries()) {
      const displayName = candidate.kind === "legacy_exact_spec"
        ? [candidate.brand, candidate.model, candidate.badgeDetail].filter(Boolean).join(" ")
        : candidate.kind === "legacy_badge_map"
          ? candidate.key
          : candidate.key;
      const powerHp = String(candidate.powerHp ?? "");
      await client.query(
        `insert into public.vehicle_power_source_rows
           (batch_id, source_sheet, source_row_number, raw_record, raw_vehicle_name, raw_power_text,
            parse_status, parse_warnings)
         values ($1, 'legacy_code', $2, $3::jsonb, $4, $5, 'parsed',
                 array['Legacy map candidate: requires an official TL Auto evidence record before price use.'])
         on conflict (batch_id, source_sheet, source_row_number) do nothing`,
        [batchId, index + 1, JSON.stringify(candidate), displayName, `${powerHp} hp`],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({ dryRun: false, batchId, ...summary }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
