import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("TL Auto Supabase admin credentials are required");
const limit = Math.min(100, Math.max(1, Number(process.env.CHESTNY_STAGING_ENCAR_LIMIT ?? 100)));
const write = process.env.CHESTNY_STAGING_ENCAR_DRY_RUN === "false";
const idFromUrl = (value: string | null) => value?.match(/[?&]carid=(\d+)/i)?.[1] ?? null;
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const obj = (v: unknown) => v && typeof v === "object" ? v as Record<string, unknown> : {};
const imageUrl = (v: string) => v.startsWith("http") ? v : `https://ci.encar.com${v}`;
async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("chestny_catalog_staging").select("source_listing_id,source_url,image_urls,raw_payload,fuel_type,exterior_color").eq("source_status", "active").eq("promotion_status", "auto_candidate").order("source_updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const results: Array<Record<string, unknown>> = [];
  for (const row of data ?? []) {
    const encarId = idFromUrl(row.source_url); if (!encarId) { results.push({ sourceId: row.source_listing_id, status: "missing_encar_id" }); continue; }
    try {
      const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${encarId}`, { headers: ENCAR_HEADERS, signal: AbortSignal.timeout(20_000) }); if (!response.ok) throw new Error(`Encar HTTP ${response.status}`);
      const detail = obj(await response.json()); const spec = obj(detail.spec); const photos = Array.isArray(detail.photos) ? detail.photos.map((p) => text(obj(p).path)).filter((p): p is string => Boolean(p)).map(imageUrl) : [];
      const seats = typeof spec.seatCount === "number" ? spec.seatCount : null; const fuel = text(spec.fuelName); const color = text(spec.colorName);
      if (write) { const current = Array.isArray(row.image_urls) ? row.image_urls : []; const payload = { ...obj(row.raw_payload), encar_enrichment: { encar_id: encarId, seats, fuel, color, fetched_at: new Date().toISOString() } }; const update: Record<string, unknown> = { raw_payload: payload }; if (!current.length && photos.length) update.image_urls = photos; if (!row.fuel_type && fuel) update.fuel_type = fuel; if (!row.exterior_color && color) update.exterior_color = color; const result = await db.from("chestny_catalog_staging").update(update).eq("source_listing_id", row.source_listing_id); if (result.error) throw result.error; }
      results.push({ sourceId: row.source_listing_id, encarId, status: write ? "written" : "dry_run", seats, fuel, color, galleryImages: photos.length });
    } catch (e) { results.push({ sourceId: row.source_listing_id, encarId, status: "error", error: e instanceof Error ? e.message : String(e) }); }
  }
  console.log(JSON.stringify({ write, requested: data?.length ?? 0, written: results.filter((r) => r.status === "written").length, dryRun: results.filter((r) => r.status === "dry_run").length, errors: results.filter((r) => r.status === "error").length, seatsFound: results.filter((r) => Number(r.seats) > 0).length, galleryImagesLoaded: results.reduce((n, r) => n + Number(r.galleryImages ?? 0), 0), encarRequests: results.length, results }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
