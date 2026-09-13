import { config } from "dotenv";
import { createSupabaseAdmin } from "../src/server/supabase/admin";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const DETAIL_URL = "https://api.encar.com/v1/readside/vehicle";
const LOCK_PATH = process.env.TL_AUTO_ENCAR_LOCK_PATH ?? "/tmp/tl-auto-encar-queue.lock";

type Car = { id: string; source_id: string; price_krw: number | null; encar_check_attempts: number };
type Detail = { manage?: { modifyDateTime?: string }; advertisement?: { price?: number; salesStatus?: string; status?: string }; price?: number; salePrice?: number; sellPrice?: number; spec?: { price?: number; salePrice?: number } };

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function priceFrom(detail: Detail) {
  const raw = detail.price ?? detail.salePrice ?? detail.sellPrice ?? detail.spec?.price ?? detail.spec?.salePrice ?? detail.advertisement?.price;
  // Encar's advertisement.price is expressed in 만 KRW (10,000 KRW units).
  const multiplier = detail.advertisement?.price === raw ? 10_000 : 1;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw * multiplier) : null;
}
async function fetchDetail(sourceId: string, attempts: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${DETAIL_URL}/${sourceId}`, {
        headers: ENCAR_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404 || response.status === 410) return response;
      if (!response.ok) throw new Error(`Encar HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(30_000, 1_500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Encar detail request failed");
}

async function main() {
  const dryRun = process.env.TL_AUTO_ENCAR_DRY_RUN !== "false";
  const batchSize = Math.min(1000, positiveInt(process.env.TL_AUTO_ENCAR_BATCH_SIZE, 500));
  const delayMs = Math.max(500, positiveInt(process.env.TL_AUTO_ENCAR_DELAY_MS, 1500));
  const intervalHours = positiveInt(process.env.TL_AUTO_ENCAR_INTERVAL_HOURS, 12);
  const fs = await import("node:fs/promises");
  let lockHandle;
  try {
    lockHandle = await fs.open(LOCK_PATH, "wx");
  } catch {
    throw new Error(`Another TL Auto Encar queue worker is running (${LOCK_PATH})`);
  }
  try {
    const db = createSupabaseAdmin();
    const { data, error } = await db.from("cars")
      .select("id,source_id,price_krw,encar_check_attempts")
      // TL Auto publishes the catalog sourced from Chesty; Encar is used only
      // as the live authority for availability and current price.
      .eq("primary_source", "chestny_prigon").eq("is_available", true)
      .or(`next_encar_check_at.is.null,next_encar_check_at.lte.${new Date().toISOString()}`)
      .order("next_encar_check_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);
    if (error) throw error;
    const cars = (data ?? []) as Car[];
    const errorSamples: Array<{ sourceId: string; error: string }> = [];
    const summary = { dryRun, requested: cars.length, checked: 0, active: 0, unavailable: 0, priceChanged: 0, priceMissing: 0, errors: 0 };
    for (const car of cars) {
      const checkedAt = new Date().toISOString();
      try {
        summary.checked++;
        const response = await fetchDetail(car.source_id, positiveInt(process.env.TL_AUTO_ENCAR_ATTEMPTS, 5));
        if (response.status === 404 || response.status === 410) {
          summary.unavailable++;
          if (!dryRun) await db.from("cars").update({ is_available: false, sale_status: "source_unavailable", encar_check_status: "unavailable", encar_check_error: null, encar_check_attempts: 0, last_seen_at: checkedAt, next_encar_check_at: null }).eq("id", car.id);
        } else if (!response.ok) {
          throw new Error(`Encar HTTP ${response.status}`);
        } else {
          const detail = await response.json() as Detail;
          const priceKrw = priceFrom(detail);
          summary.active++; if (priceKrw == null) summary.priceMissing++; else if (priceKrw !== car.price_krw) summary.priceChanged++;
          if (!dryRun) await db.from("cars").update({ ...(priceKrw == null ? {} : { price_krw: priceKrw }), is_available: true, sale_status: null, source_updated_at: detail.manage?.modifyDateTime ?? checkedAt, last_seen_at: checkedAt, encar_price_checked_at: checkedAt, encar_check_status: "ok", encar_check_error: null, encar_check_attempts: 0, next_encar_check_at: new Date(Date.now() + intervalHours * 3600_000).toISOString() }).eq("id", car.id);
        }
      } catch (error) {
        summary.errors++;
        const message = error instanceof Error ? error.message : String(error);
        if (errorSamples.length < 5) errorSamples.push({ sourceId: car.source_id, error: message });
        if (!dryRun) await db.from("cars").update({ encar_check_status: "error", encar_check_error: message, encar_check_attempts: car.encar_check_attempts + 1, next_encar_check_at: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", car.id);
      }
      await sleep(delayMs);
    }
    console.log(JSON.stringify({ ...summary, errorSamples }, null, 2));
  } finally { await lockHandle.close(); await fs.unlink(LOCK_PATH).catch(() => undefined); }
}
main().catch((error) => { console.error(error); process.exit(1); });
