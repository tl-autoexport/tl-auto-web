import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.MANUFACTURER_POWER_IMPORT_DRY_RUN !== "false";
const manifestPath = "data/power-reference/manufacturer-korea-v1.json";
if (!dbUrl && !dryRun) throw new Error("SUPABASE_DB_URL is required when MANUFACTURER_POWER_IMPORT_DRY_RUN=false");

type Match = {
  generation?: string;
  driveType?: string;
  trim?: string;
  /** Exact Encar badge/detail when the same engine displacement has multiple outputs. */
  badge?: string;
  yearFrom: number;
  yearTo: number;
  engineCcFrom: number;
  engineCcTo: number;
};

type Specification = {
  specKey: string;
  brand: string;
  model: string;
  fuelType: string;
  propulsionType: "ice";
  engineCc: number;
  years: [number, number];
  power: { value: number; unit: "PS" | "kW"; kw: number };
  powerBasis: "combustion_engine";
  source: { title: string; uri: string; supportingUri?: string; retrievedAt: string; note: string };
  matches: Match[];
};

type Manifest = { version: string; specifications: Specification[] };

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertPower(spec: Specification) {
  const expectedKw = spec.power.unit === "PS" ? spec.power.value * 0.73549875 : spec.power.value;
  if (Math.abs(expectedKw - spec.power.kw) > 0.0001) {
    throw new Error(`${spec.specKey}: declared kW does not match source value`);
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  manifest.specifications.forEach(assertPower);
  const sourceSha256 = sha256(manifest);
  const summary = {
    dryRun,
    manifestPath,
    manifestVersion: manifest.version,
    specifications: manifest.specifications.length,
    matches: manifest.specifications.reduce((total, spec) => total + spec.matches.length, 0),
    sourceSha256,
    policy: "Only manufacturer/OEM technical documents with restricted configuration matches are approved. Existing car power and prices are unchanged by this import.",
  };
  if (dryRun) {
    console.log(JSON.stringify({ ...summary, rows: manifest.specifications }, null, 2));
    return;
  }

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const batchResult = await client.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
         (source_kind, source_name, source_uri, source_sha256, source_version, imported_by, metadata)
       values ('manufacturer_document', 'TL Auto: Korean manufacturer specifications', $1, $2, $3,
               'manufacturer-power-import-v1', $4::jsonb)
       on conflict (source_kind, source_sha256) do update
         set metadata = excluded.metadata
       returning id`,
      ["https://www.genesis.com/kr/ko/", sourceSha256, manifest.version, JSON.stringify(summary)],
    );
    const batchId = batchResult.rows[0]?.id;
    if (!batchId) throw new Error("Source batch was not created");

    let created = 0;
    for (const [index, spec] of manifest.specifications.entries()) {
      const rawRow = await client.query<{ id: string }>(
        `insert into public.vehicle_power_source_rows
           (batch_id, source_sheet, source_row_number, raw_record, raw_vehicle_name, raw_power_text, parse_status)
         values ($1, 'manufacturer-korea-v1', $2, $3::jsonb, $4, $5, 'parsed')
         on conflict (batch_id, source_sheet, source_row_number) do update
           set raw_record = excluded.raw_record, raw_power_text = excluded.raw_power_text
         returning id`,
        [batchId, index + 1, JSON.stringify(spec), `${spec.brand} ${spec.model}`, `${spec.power.value} ${spec.power.unit}`],
      );
      const sourceRowId = rawRow.rows[0]?.id;
      if (!sourceRowId) throw new Error(`Raw source row was not created for ${spec.specKey}`);

      const existing = await client.query<{ id: string }>(
        "select id from public.vehicle_power_specs where spec_key = $1 and version = 1",
        [spec.specKey],
      );
      if (existing.rows[0]) {
        // The manifest is the reviewed source of truth for match ranges. Keep
        // the existing evidence/spec row, but synchronize its approved ranges
        // so a later, narrower or broader review is actually applied.
        await client.query("delete from public.vehicle_power_spec_matches where spec_id = $1", [existing.rows[0].id]);
        for (const match of spec.matches) {
          await client.query(
            `insert into public.vehicle_power_spec_matches
            (spec_id, priority, brand, model, generation, trim, badge_normalized, fuel_type, drive_type, production_year_from,
                production_year_to, engine_cc_from, engine_cc_to)
             values ($1, 10, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [existing.rows[0].id, spec.brand, spec.model, match.generation ?? null, match.trim ?? null, match.badge ?? null, spec.fuelType, match.driveType ?? null, match.yearFrom, match.yearTo, match.engineCcFrom, match.engineCcTo],
          );
        }
        continue;
      }

      const evidence = await client.query<{ id: string }>(
        `insert into public.vehicle_power_evidence
           (batch_id, source_row_id, source_kind, source_uri, document_reference, captured_at,
            vehicle_category, brand, model, fuel_type, production_year_from, production_year_to,
            propulsion_type, dvs_power_kw, source_units, reliability, review_status, reviewed_by,
            reviewed_at, source_title, source_retrieved_at, confidence_score, evidence_note,
            verification_status)
         values ($1, $2, 'manufacturer_document', $3, $4, $5::date,
                 'M1', $6, $7, $8, $9, $10, 'ice', $11, $12, 'high', 'verified',
                 'manufacturer-power-import-v1', now(), $13, $14::timestamptz, 95, $15, 'approved')
         returning id`,
        [
          batchId, sourceRowId, spec.source.uri, spec.source.supportingUri ?? null, spec.source.retrievedAt,
          spec.brand, spec.model, spec.fuelType, spec.years[0], spec.years[1], spec.power.kw,
          spec.power.unit, spec.source.title, `${spec.source.retrievedAt}T00:00:00Z`, spec.source.note,
        ],
      );
      const evidenceId = evidence.rows[0]?.id;
      if (!evidenceId) throw new Error(`Evidence was not created for ${spec.specKey}`);
      const specResult = await client.query<{ id: string }>(
        `insert into public.vehicle_power_specs
           (spec_key, version, status, vehicle_category, propulsion_type, engine_cc_from, engine_cc_to,
            dvs_power_kw, calculation_power_kw, evidence_id, approval_note, approved_by, approved_at,
            engine_power_hp, power_basis, source_priority)
         values ($1, 1, 'approved', 'M1', 'ice', $2, $3, $4, $4, $5, $6,
                 'manufacturer-power-import-v1', now(), null, 'combustion_engine', 10)
         returning id`,
        [spec.specKey, spec.engineCc, spec.engineCc, spec.power.kw, evidenceId, "Approved Korean manufacturer specification; exact kW calculated from the published PS value."],
      );
      const specId = specResult.rows[0]?.id;
      if (!specId) throw new Error(`Specification was not created for ${spec.specKey}`);
      for (const match of spec.matches) {
        await client.query(
          `insert into public.vehicle_power_spec_matches
           (spec_id, priority, brand, model, generation, trim, badge_normalized, fuel_type, drive_type, production_year_from,
              production_year_to, engine_cc_from, engine_cc_to)
           values ($1, 10, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [specId, spec.brand, spec.model, match.generation ?? null, match.trim ?? null, match.badge ?? null, spec.fuelType, match.driveType ?? null, match.yearFrom, match.yearTo, match.engineCcFrom, match.engineCcTo],
        );
      }
      created += 1;
    }
    await client.query("commit");
    console.log(JSON.stringify({ ...summary, created }, null, 2));
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
