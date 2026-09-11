import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const targetKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sourceUrl = process.env.CHESTNY_SUPABASE_URL;
const sourceKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.CHESTNY_IMAGES_DRY_RUN !== "false";
if (!targetUrl || !targetKey || !sourceUrl || !sourceKey) throw new Error("Supabase admin credentials are required");
const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function main() {
  const target = createClient(targetUrl!, targetKey!, { auth: { persistSession: false } });
  const source = createClient(sourceUrl!, sourceKey!, { auth: { persistSession: false } });
  const cars: Array<{ id: string; source_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await target.from("cars").select("id,source_id").eq("primary_source", "chestny_prigon").eq("is_available", true).range(from, from + 999);
    if (error) throw error;
    cars.push(...((data ?? []) as Array<{ id: string; source_id: string }>));
    if (!data || data.length < 1000) break;
  }
  const byListing = new Map(cars.map(car => [car.source_id, car.id]));
  const vehicleIds = new Map<string, string>();
  for (const ids of chunk([...byListing.keys()], 200)) {
    const { data, error } = await source.from("vehicles").select("id,source_listing_id").in("source_listing_id", ids);
    if (error) throw error;
    for (const row of data ?? []) vehicleIds.set(row.id, row.source_listing_id);
  }
  const media: Array<{ car_id: string; source: string; media_type: string; category: string; url: string; thumbnail_url: string; sort_order: number; is_primary: boolean; legal_mode: string }> = [];
  for (const ids of chunk([...vehicleIds.keys()], 200)) {
    const { data, error } = await source.from("vehicle_images").select("vehicle_id,source_url,position,width,height").in("vehicle_id", ids).order("position", { ascending: true });
    if (error) throw error;
    for (const image of data ?? []) {
      const listingId = vehicleIds.get(image.vehicle_id); const carId = listingId ? byListing.get(listingId) : null;
      if (!carId || !image.source_url) continue;
      media.push({ car_id: carId, source: "chestny_prigon", media_type: "image", category: "outer", url: image.source_url, thumbnail_url: image.source_url, sort_order: Number(image.position ?? 0), is_primary: Number(image.position) === 1, legal_mode: "external_url" });
    }
  }
  if (!dryRun && media.length) {
    const ids = [...new Set(media.map(item => item.car_id))];
    for (const part of chunk(ids, 500)) { const { error } = await target.from("car_media").delete().eq("source", "chestny_prigon").in("car_id", part); if (error) throw error; }
    for (const part of chunk(media, 500)) { const { error } = await target.from("car_media").insert(part); if (error) throw error; }
  }
  console.log(JSON.stringify({ dryRun, activeChestnyCars: byListing.size, matchedSourceVehicles: vehicleIds.size, mediaRows: media.length, carsWithPhotos: new Set(media.map(item => item.car_id)).size }, null, 2));
}
main().catch(error => { console.error(error); process.exit(1); });
