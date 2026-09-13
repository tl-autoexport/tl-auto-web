import { Client } from "pg";
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const quota: Record<string, number> = {
  Hyundai: 1400, Kia: 1000, "Mercedes-Benz": 500, Chevrolet: 350, Volkswagen: 350,
  BMW: 300, Audi: 250, MINI: 250, "Land Rover": 250, KGM: 200, "Renault Korea": 150,
};
type Row = { manufacturer: string | null; promotion_status: string; source_updated_at: string | null; last_seen_at: string; imported_at: string; model_year: number | null; mileage_km: number | null; price_krw: number | null; engine_cc: number | null; fuel_type: string | null; drive_type: string | null; exterior_color: string | null; image_urls: unknown; raw_payload: unknown };
const images = (value: unknown) => Array.isArray(value) ? value.filter((x) => typeof x === "string" && /^https?:\/\//i.test(x)).length : 0;
const seats = (value: unknown) => { if (!value || typeof value !== "object") return null; const p = value as Record<string, unknown>; const raw = p.seats ?? p.seat_count ?? (typeof p.specs === "object" && p.specs ? (p.specs as Record<string, unknown>).seats : null); const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 12 ? n : null; };
const bucket = (date: string) => { const age = (Date.now() - Date.parse(date)) / 86_400_000; if (age <= 7) return "до_7_дней"; if (age <= 30) return "8_30_дней"; if (age <= 60) return "31_60_дней"; return "старше_60_дней"; };

async function main() {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    const [queue, published] = await Promise.all([
      c.query<Row>(`select manufacturer,promotion_status,source_updated_at,last_seen_at,imported_at,model_year,mileage_km,price_krw,engine_cc,fuel_type,drive_type,exterior_color,image_urls,raw_payload from public.chestny_catalog_staging where source_status='active' and promotion_status in ('auto_candidate','enrichment_required')`),
      c.query<{ brand: string; count: string }>(`select brand,count(*)::text from public.cars where is_available=true and primary_source in ('encar','chestny_prigon') group by brand`),
    ]);
    const byFreshness: Record<string, number> = {}; const byBrand: Record<string, { quota: number; published: number; queued: number; missing: Record<string, number> }> = {};
    for (const brand of Object.keys(quota)) byBrand[brand] = { quota: quota[brand], published: 0, queued: 0, missing: {} };
    for (const row of published.rows) if (byBrand[row.brand]) byBrand[row.brand].published = Number(row.count);
    for (const row of queue.rows) {
      const date = row.source_updated_at ?? row.last_seen_at ?? row.imported_at; const age = bucket(date); byFreshness[age] = (byFreshness[age] ?? 0) + 1;
      const brand = row.manufacturer ?? "Неизвестно"; if (!byBrand[brand]) byBrand[brand] = { quota: 0, published: 0, queued: 0, missing: {} }; byBrand[brand].queued++;
      const missing = [!row.model_year && "год", row.mileage_km == null && "пробег", !row.price_krw && "цена", !row.engine_cc && "объём", !row.fuel_type && "топливо", !row.drive_type && "привод", !row.exterior_color && "цвет", images(row.image_urls) === 0 && "фото", !seats(row.raw_payload) && "места"].filter(Boolean) as string[];
      for (const field of missing) byBrand[brand].missing[field] = (byBrand[brand].missing[field] ?? 0) + 1;
    }
    const report = { generatedAt: new Date().toISOString(), encarRequests: 0, queueTotal: queue.rowCount, byFreshness, byBrand, note: "Read-only local audit. No public cars or Encar data changed." };
    await writeFile("docs/chestny-reserve-queue-audit.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally { await c.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
