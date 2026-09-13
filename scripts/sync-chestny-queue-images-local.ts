import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const targetKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const sourceUrl = process.env.CHESTNY_SUPABASE_URL?.trim(); const sourceKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY?.trim(); const dbUrl = process.env.SUPABASE_DB_URL;
if (!targetUrl || !targetKey || !sourceUrl || !sourceKey || !dbUrl) throw new Error("TL Auto, Chesty Supabase and SUPABASE_DB_URL variables are required");
const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const validUrls = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x)) : [];

async function main() {
  const source = createClient(sourceUrl!, sourceKey!, { auth: { persistSession: false, autoRefreshToken: false } }); const target = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await target.connect();
  try {
    const queue: Array<{ source_listing_id: string; image_urls: unknown }> = [];
    for (let from = 0; ; from += 1000) { const { data, error } = await source.from("vehicles").select("source_listing_id").range(from, from + 999); if (error) throw error; const ids = (data ?? []).map((row) => row.source_listing_id).filter(Boolean); if (ids.length) { const result = await (await import("@supabase/supabase-js")).createClient(targetUrl!, targetKey!, { auth: { persistSession: false } }).from("chestny_catalog_staging").select("source_listing_id,image_urls").in("source_listing_id", ids).eq("source_status", "active").in("promotion_status", ["auto_candidate", "enrichment_required"]); if (result.error) throw result.error; queue.push(...((result.data ?? []) as typeof queue)); } if (!data || data.length < 1000) break; }
    const vehicleByListing = new Map<string, string>();
    for (const ids of chunk(queue.map((row) => row.source_listing_id), 200)) { const { data, error } = await source.from("vehicles").select("id,source_listing_id").in("source_listing_id", ids); if (error) throw error; for (const row of data ?? []) vehicleByListing.set(row.source_listing_id, row.id); }
    const photos = new Map<string, string[]>(); const listingByVehicle = new Map([...vehicleByListing.entries()].map(([listing, id]) => [id, listing]));
    for (const ids of chunk([...vehicleByListing.values()], 200)) { const { data, error } = await source.from("vehicle_images").select("vehicle_id,source_url,position").in("vehicle_id", ids).order("position", { ascending: true }); if (error) throw error; for (const row of data ?? []) { const listing = listingByVehicle.get(row.vehicle_id); if (!listing || typeof row.source_url !== "string" || !/^https?:\/\//i.test(row.source_url)) continue; photos.set(listing, [...(photos.get(listing) ?? []), row.source_url]); } }
    const updates = queue.map((row) => ({ source_listing_id: row.source_listing_id, image_urls: validUrls(row.image_urls).length ? validUrls(row.image_urls) : (photos.get(row.source_listing_id) ?? []) })).filter((row) => row.image_urls.length);
    let updated = 0; for (const batch of chunk(updates, 250)) { const result = await target.query(`update public.chestny_catalog_staging as s set image_urls=v.image_urls,updated_at=now() from jsonb_to_recordset($1::jsonb) as v(source_listing_id text,image_urls jsonb) where s.source_listing_id=v.source_listing_id and s.source_status='active' and s.promotion_status in ('auto_candidate','enrichment_required') and (s.image_urls is null or jsonb_array_length(s.image_urls)=0)`, [JSON.stringify(batch)]); updated += result.rowCount ?? 0; }
    console.log(JSON.stringify({ encarRequests: 0, queueRows: queue.length, matchedSourceVehicles: vehicleByListing.size, sourceListingsWithPhotos: photos.size, localPhotoRows: [...photos.values()].reduce((sum, value) => sum + value.length, 0), stagingRowsUpdated: updated, publicCatalogChanged: false, galleryMode: "full_source_gallery" }, null, 2));
  } finally { await target.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
