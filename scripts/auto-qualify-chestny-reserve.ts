import { Client } from "pg";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const write = process.env.AUTO_QUALIFY_WRITE === "true";

const quota: Record<string, number> = {
  Hyundai: 1400, Kia: 1000, "Mercedes-Benz": 500, Chevrolet: 350, Volkswagen: 350,
  BMW: 300, Audi: 250, MINI: 250, "Land Rover": 250, KGM: 200, "Renault Korea": 150,
};
const aliases: Record<string, string> = { canival: "Carnival", santafe: "Santa Fe", ray: "Ray", morning: "Morning", tiboli: "Tivoli", "x2 (f39)": "X2", "1-series": "1 Series", "2-series": "2 Series" };
const normalize = (value: string | null) => aliases[(value ?? "").trim().toLowerCase()] ?? (value ?? "").trim();
const key = (value: string | null) => normalize(value).toLowerCase().replace(/[\s_-]+/g, "");
const normalizeFuel = (value: string | null) => { const s = (value ?? "").toLowerCase(); if (s.includes("디젤") || s.includes("diesel")) return "diesel"; if (s.includes("전기") || s.includes("electric")) return "electric"; if (s.includes("하이브리드") || s.includes("hybrid")) return "hybrid"; if (s.includes("가솔린") || s.includes("gas")) return "gasoline"; return null; };
const imageList = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x)) : [];
const seats = (payload: unknown) => { if (!payload || typeof payload !== "object") return null; const p = payload as Record<string, unknown>; const raw = p.seats ?? p.seat_count ?? (typeof p.specs === "object" && p.specs ? (p.specs as Record<string, unknown>).seats : null); const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 12 ? n : null; };

type StagingRow = { source_listing_id: string; source_url: string | null; manufacturer: string | null; model: string | null; model_year: number | null; mileage_km: number | null; price_krw: number | null; engine_cc: number | null; fuel_type: string | null; transmission: string | null; drive_type: string | null; exterior_color: string | null; image_urls: unknown; raw_payload: unknown; promotion_status: string; last_seen_at: string };

async function main() {
  const inventory = JSON.parse(await readFile("docs/chestny-required-models-audit.json", "utf8")) as { groups: Array<{ manufacturer: string; requestedModel: string }> };
  const requested = new Set(inventory.groups.map((x) => `${key(x.manufacturer)}|${key(x.requestedModel)}`));
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    const [staging, refs, active] = await Promise.all([
      c.query<StagingRow>(`select source_listing_id,source_url,manufacturer,model,model_year,mileage_km,price_krw,engine_cc,fuel_type,transmission,drive_type,exterior_color,image_urls,raw_payload,promotion_status,last_seen_at from public.chestny_catalog_staging where promotion_status not in ('published','rejected')`),
      c.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id where spec.status='approved' and evidence.verification_status='approved'`),
      c.query<{ source_id: string; brand: string }>(`select source_id,brand from public.cars where is_available = true and primary_source in ('encar','chestny_prigon')`),
    ]);
    const powerRefs: ApprovedPowerCandidate[] = refs.rows.map((r) => ({ specId: r.spec_id, specVersion: r.spec_version, calculationPowerKw: Number(r.calculation_power_kw), powerBasis: r.power_basis, sourcePriority: r.source_priority, evidenceId: r.evidence_id, evidenceKind: r.evidence_kind, evidenceVerificationStatus: r.evidence_verification_status, evidenceReliability: r.evidence_reliability, match: { id: r.match_id, priority: r.match_priority, brand: r.brand, model: r.model, generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code, engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type, productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to, engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to } }));
    const activeIds = new Set(active.rows.map((x) => x.source_id));
    const seen = new Set<string>();
    const eligible: Array<StagingRow & { brand: string; modelName: string; powerHp: number; priority: number; imageCount: number; seatCount: number }> = [];
    const hold: Array<{ row: StagingRow; reasons: string[] }> = [];
    const rejected: Array<{ row: StagingRow; reason: string }> = [];
    for (const row of staging.rows) {
      const brand = normalize(row.manufacturer); const modelName = normalize(row.model); const reasons: string[] = [];
      if (!requested.has(`${key(brand)}|${key(modelName)}`)) { rejected.push({ row, reason: "not_in_customer_model_list" }); continue; }
      if (activeIds.has(row.source_listing_id) || seen.has(row.source_listing_id)) { rejected.push({ row, reason: "duplicate_of_published_or_duplicate" }); continue; }
      const images = imageList(row.image_urls); const seatCount = seats(row.raw_payload); const fuelType = normalizeFuel(row.fuel_type);
      if (!row.source_url) reasons.push("source_url"); if (!row.model_year || row.model_year < 2015) reasons.push("year"); if (row.mileage_km == null || row.mileage_km < 0) reasons.push("mileage"); if (!row.price_krw || row.price_krw <= 0) reasons.push("price"); if (!row.engine_cc || row.engine_cc <= 0) reasons.push("engine_cc"); if (!fuelType) reasons.push("fuel_type"); if (!row.drive_type) reasons.push("drive_type"); if (!row.exterior_color) reasons.push("color"); if (!seatCount) reasons.push("seats"); if (images.length === 0) reasons.push("photos");
      const match = resolveApprovedPower({ brand, model: modelName, year: row.model_year, engineCc: row.engine_cc, fuelType, driveType: row.drive_type }, powerRefs);
      if (match.status !== "matched") reasons.push("local_power_match");
      if (reasons.length || match.status !== "matched") { hold.push({ row, reasons }); continue; }
      const powerHp = Math.round(match.candidate.calculationPowerKw * 1.35962 * 10) / 10;
      eligible.push({ ...row, brand, modelName, powerHp, priority: powerHp <= 160 ? 10 : 30, imageCount: images.length, seatCount: seatCount as number }); seen.add(row.source_listing_id);
    }
    const current = Object.fromEntries(Object.keys(quota).map((brand) => [brand, active.rows.filter((x) => x.brand === brand).length]));
    const selected: typeof eligible = [];
    const selectedByBrand: Record<string, number> = {};
    eligible.sort((a, b) => a.priority - b.priority || b.imageCount - a.imageCount || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
    for (const row of eligible) { const remaining = (quota[row.brand] ?? 0) - (current[row.brand] ?? 0) - (selectedByBrand[row.brand] ?? 0); if (remaining <= 0) continue; selected.push(row); selectedByBrand[row.brand] = (selectedByBrand[row.brand] ?? 0) + 1; }
    if (write) {
      await c.query("begin");
      try {
        for (const row of selected) await c.query(`update public.chestny_catalog_staging set promotion_status='auto_approved',promotion_note=$2,normalized_at=coalesce(normalized_at,now()),updated_at=now() where source_listing_id=$1`, [row.source_listing_id, `Auto-approved locally; priority=${row.priority}; power_hp=${row.powerHp}; photos=${row.imageCount}; seats=${row.seatCount}.`]);
        for (const item of hold) await c.query(`update public.chestny_catalog_staging set promotion_status='auto_hold',promotion_note=$2,updated_at=now() where source_listing_id=$1`, [item.row.source_listing_id, `Auto-hold: missing ${item.reasons.join(", ")}.`]);
        for (const item of rejected) await c.query(`update public.chestny_catalog_staging set promotion_status='auto_rejected',promotion_note=$2,updated_at=now() where source_listing_id=$1`, [item.row.source_listing_id, `Auto-rejected: ${item.reason}.`]);
        await c.query("commit");
      } catch (error) { await c.query("rollback"); throw error; }
    }
    const byBrand = (rows: typeof selected) => Object.fromEntries(Object.keys(quota).map((brand) => [brand, rows.filter((x) => x.brand === brand).length]).filter(([, count]) => count));
    console.log(JSON.stringify({ dryRun: !write, encarRequests: 0, stagingRows: staging.rowCount, eligibleComplete: eligible.length, selectedForQuota: selected.length, selectedUnder160: selected.filter((x) => x.priority === 10).length, selectedOver160: selected.filter((x) => x.priority === 30).length, autoHold: hold.length, autoRejected: rejected.length, currentPublishedByBrand: current, selectedByBrand: byBrand(selected), remainingToQuota: Object.fromEntries(Object.keys(quota).map((brand) => [brand, Math.max(0, quota[brand] - (current[brand] ?? 0) - (selectedByBrand[brand] ?? 0))])), publicCatalogChanged: false }, null, 2));
  } finally { await c.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
