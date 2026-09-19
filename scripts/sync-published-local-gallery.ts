import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const target = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const source = createClient(process.env.CHESTNY_SUPABASE_URL!, process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const write = process.env.CHESTNY_LOCAL_GALLERY_WRITE === "true";
async function main() {
  const { data: cars, error } = await target.from("cars").select("id,source_id").eq("primary_source", "chestny_prigon").eq("is_available", true).eq("legacy_calculation_status", "calculated_from_local_enriched_staging");
  if (error) throw error;
  const bySource = new Map((cars ?? []).map((car) => [car.source_id, car.id])); const media: Array<Record<string, unknown>> = [];
  for (let i = 0; i < bySource.size; i += 200) {
    const ids = [...bySource.keys()].slice(i, i + 200); const { data: vehicles, error: vehicleError } = await source.from("vehicles").select("id,source_listing_id").in("source_listing_id", ids); if (vehicleError) throw vehicleError;
    const byVehicle = new Map((vehicles ?? []).map((vehicle) => [vehicle.id, vehicle.source_listing_id]));
    const { data: images, error: imageError } = await source.from("vehicle_images").select("vehicle_id,source_url,position,width,height").in("vehicle_id", [...byVehicle.keys()]).order("position", { ascending: true }); if (imageError) throw imageError;
    for (const image of images ?? []) { const sourceId = byVehicle.get(image.vehicle_id); const carId = sourceId ? bySource.get(sourceId) : null; if (!carId || !image.source_url) continue; media.push({ car_id: carId, source: "chestny_prigon", media_type: "image", category: "outer", url: image.source_url, thumbnail_url: image.source_url, sort_order: Number(image.position ?? 0), width: image.width ?? null, height: image.height ?? null, is_primary: Number(image.position) === 1, legal_mode: "external_url" }); }
  }
  if (write) {
    const ids = [...bySource.values()];
    for (let i = 0; i < ids.length; i += 500) await target.from("car_media").delete().eq("source", "chestny_prigon").in("car_id", ids.slice(i, i + 500));
    for (let i = 0; i < media.length; i += 500) { const { error: insertError } = await target.from("car_media").insert(media.slice(i, i + 500)); if (insertError) throw insertError; }
  }
  const withPhotos = new Set(media.map((item) => item.car_id)).size;
  console.log(JSON.stringify({ dryRun: !write, cards: bySource.size, sourcePhotoRows: media.length, cardsWithLocalGallery: withPhotos, cardsWithoutLocalGallery: bySource.size - withPhotos, encarRequests: 0, publicCatalogChanged: false }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
