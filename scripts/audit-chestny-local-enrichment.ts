import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const targetKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const sourceUrl = process.env.CHESTNY_SUPABASE_URL?.trim();
const sourceKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!targetUrl || !targetKey || !sourceUrl || !sourceKey) throw new Error("TL Auto and Chesty Supabase admin variables are required");
const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function main() {
  const target = createClient(targetUrl!, targetKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const source = createClient(sourceUrl!, sourceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const queue: Array<{ source_listing_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await target.from("chestny_catalog_staging").select("source_listing_id").eq("source_status", "active").in("promotion_status", ["auto_candidate", "enrichment_required"]).range(from, from + 999);
    if (error) throw error; queue.push(...((data ?? []) as Array<{ source_listing_id: string }>)); if (!data || data.length < 1000) break;
  }
  const vehicleIds = new Map<string, string>();
  for (const ids of chunk(queue.map((row) => row.source_listing_id), 200)) {
    const { data, error } = await source.from("vehicles").select("id,source_listing_id").in("source_listing_id", ids); if (error) throw error;
    for (const row of data ?? []) vehicleIds.set(row.id, row.source_listing_id);
  }
  const imagesByListing = new Map<string, number>();
  for (const ids of chunk([...vehicleIds.keys()], 200)) {
    const { data, error } = await source.from("vehicle_images").select("vehicle_id,source_url").in("vehicle_id", ids); if (error) throw error;
    for (const row of data ?? []) { const listing = vehicleIds.get(row.vehicle_id); if (listing && row.source_url) imagesByListing.set(listing, (imagesByListing.get(listing) ?? 0) + 1); }
  }
  const withPhotos = queue.filter((row) => (imagesByListing.get(row.source_listing_id) ?? 0) > 0).length;
  const report = { generatedAt: new Date().toISOString(), encarRequests: 0, queueRows: queue.length, matchedSourceVehicles: vehicleIds.size, queueRowsWithLocalPhotos: withPhotos, queueRowsWithoutLocalPhotos: queue.length - withPhotos, localPhotoRows: [...imagesByListing.values()].reduce((sum, count) => sum + count, 0), note: "Read-only comparison of TL Auto queue with existing Chesty vehicle_images; no writes." };
  await writeFile("docs/chestny-local-enrichment-audit.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
