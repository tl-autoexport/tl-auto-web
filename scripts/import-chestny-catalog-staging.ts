import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const targetKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const sourceUrl = process.env.CHESTNY_SUPABASE_URL?.trim();
const sourceKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY?.trim();
const dryRun = process.env.CHESTNY_IMPORT_DRY_RUN !== "false";
const limit = Math.max(1, Number(process.env.CHESTNY_IMPORT_LIMIT ?? 10000));
// Keep the TL Auto mirror lightweight. Raw source rows are retained in Chesty
// and are not needed for catalogue matching or power resolution.
const includeRawPayload = process.env.CHESTNY_IMPORT_INCLUDE_RAW === "true";

if (!sourceUrl || !sourceKey) {
  throw new Error("CHESTNY_SUPABASE_URL and CHESTNY_SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!dryRun && (!targetUrl || !targetKey)) {
  throw new Error("TL Auto Supabase admin variables are required in write mode");
}

type Vehicle = {
  source_listing_id: string;
  manufacturer: string | null;
  model: string | null;
  generation: string | null;
  trim: string | null;
  model_year: number | null;
  first_registration_date: string | null;
  mileage_km: number | null;
  price_krw: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  body_type: string | null;
  location: string | null;
  vin_masked: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  last_seen_at: string | null;
  status: string | null;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const source = createClient(sourceUrl!, sourceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const target = !dryRun ? createClient(targetUrl!, targetKey!, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const rows: Vehicle[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const to = Math.min(from + 999, limit - 1);
    const { data, error } = await source.from("vehicles").select("source_listing_id,manufacturer,model,generation,trim,model_year,first_registration_date,mileage_km,price_krw,engine_cc,fuel_type,transmission,drive_type,body_type,location,vin_masked,source_url,source_updated_at,last_seen_at,status").range(from, to);
    if (error) throw new Error(`Chesty source read failed: ${error.message}`);
    rows.push(...((data ?? []) as Vehicle[]));
    if (!data || data.length < 1000) break;
  }
  const unique = [...new Map(rows.filter((row) => row.source_listing_id).map((row) => [row.source_listing_id, row])).values()];
  if (!target) {
    console.log(JSON.stringify({ dryRun, fetched: rows.length, unique: unique.length, sample: unique.slice(0, 3).map((row) => ({ id: row.source_listing_id, manufacturer: row.manufacturer, model: row.model, year: row.model_year })) }, null, 2));
    return;
  }
  for (let offset = 0; offset < unique.length; offset += 500) {
    const batch = unique.slice(offset, offset + 500).map((row) => ({
      source_listing_id: row.source_listing_id,
      source_url: row.source_url,
      source_status: row.status,
      manufacturer: row.manufacturer,
      model: row.model,
      generation: row.generation,
      trim: row.trim,
      model_year: row.model_year,
      first_registration_date: row.first_registration_date,
      mileage_km: row.mileage_km,
      price_krw: row.price_krw,
      engine_cc: row.engine_cc,
      fuel_type: row.fuel_type,
      transmission: row.transmission,
      drive_type: row.drive_type,
      body_type: row.body_type,
      location: row.location,
      vin_masked: row.vin_masked,
      // Only copy raw JSON when explicitly requested for a controlled audit.
      // The normal production import is metadata-only.
      ...(includeRawPayload ? { raw_payload: row } : {}),
      image_urls: [],
      payload_hash: hash(row),
      source_updated_at: row.source_updated_at,
      last_seen_at: row.last_seen_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await target.from("chestny_catalog_staging").upsert(batch, { onConflict: "source_listing_id" });
    if (error) throw new Error(`TL Auto staging write failed: ${error.message}`);
  }
  console.log(JSON.stringify({ dryRun, includeRawPayload, fetched: rows.length, unique: unique.length, staged: unique.length, table: "public.chestny_catalog_staging" }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
