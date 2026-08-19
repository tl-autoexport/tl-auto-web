import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type PilotRecord = {
  source: "passo_bike" | "passo_boat";
  sourceId: string;
  vehicleType: "motorcycle" | "scooter" | "jetski";
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceKrw: number | null;
  mileageKm: number | null;
  vehicleSpecs: Record<string, unknown>;
  imageUrls: string[];
  primaryImageUrl: string | null;
  safeForImport: boolean;
  rejectedReason: string | null;
};

const dbUrl = process.env.SUPABASE_DB_URL;
const sourceFile = process.env.PASSO_PILOT_SOURCE_FILE ?? "/tmp/passo-pilot.json";

if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const payload = JSON.parse(await readFile(sourceFile, "utf8")) as { records: PilotRecord[] };
  const records = payload.records.filter((record) => record.safeForImport && record.primaryImageUrl);
  if (records.length !== 20) throw new Error(`Expected exactly 20 validated pilot records, got ${records.length}`);
  if (records.some((record) => !["motorcycle", "scooter", "jetski"].includes(record.vehicleType))) throw new Error("Pilot contains unsupported vehicle type");

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    for (const record of records) {
      await client.query(
        `insert into public.passo_catalog_staging
          (source, source_id, source_url, vehicle_type, source_updated_at, brand, model, year,
           mileage_km, price_krw, vehicle_specs, image_urls, import_status, validation_warnings, parser_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'validated', $13::text[], $14)
         on conflict (source, source_id) do update set
           source_url = excluded.source_url,
           vehicle_type = excluded.vehicle_type,
           source_updated_at = excluded.source_updated_at,
           brand = excluded.brand,
           model = excluded.model,
           year = excluded.year,
           mileage_km = excluded.mileage_km,
           price_krw = excluded.price_krw,
           vehicle_specs = excluded.vehicle_specs,
           image_urls = excluded.image_urls,
           import_status = excluded.import_status,
           validation_warnings = excluded.validation_warnings,
           parser_version = excluded.parser_version,
           fetched_at = now()`,
        [
          record.source,
          record.sourceId,
          record.sourceUrl,
          record.vehicleType,
          record.sourceUpdatedAt,
          record.brand,
          record.model,
          record.year,
          record.mileageKm,
          record.priceKrw,
          JSON.stringify(record.vehicleSpecs),
          JSON.stringify(record.imageUrls.map((url, index) => ({ url, is_primary: index === 0, sort_order: index }))),
          record.rejectedReason ? [record.rejectedReason] : [],
          "passo-pilot-v2",
        ],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({ written: records.length, table: "public.passo_catalog_staging", sources: { passo_bike: records.filter((r) => r.source === "passo_bike").length, passo_boat: records.filter((r) => r.source === "passo_boat").length } }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
