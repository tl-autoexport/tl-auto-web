import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { normalizeColor, normalizeDrive } from "../src/server/normalization/vehicles";
import { displayModelName } from "../src/server/catalog/display-model";
import { evaluatePublication, powerBasisForFuel, resolveCalculationMonth } from "../src/server/cars/calculation-contract";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const dryRun = process.env.CHESTNY_PROMOTION_DRY_RUN !== "false";
/** Optional pilot batch size, for example 20 rows before a full run. */
const limit = Number(process.env.CHESTNY_PROMOTION_LIMIT ?? 0);
if (!Number.isInteger(limit) || limit < 0) throw new Error("CHESTNY_PROMOTION_LIMIT must be a non-negative integer");

const KW_PER_PS = 0.73549875;

/**
 * Electric cars are electric, not hybrids. The previous revision collapsed
 * 전기 into "hybrid", which sent every EV through the hybrid duty branch and
 * let it be counted as a hybrid in the catalogue.
 *
 * Only the fuels the catalogue supports are mapped. Anything else (LPG,
 * hydrogen) returns null and the row is skipped explicitly instead of being
 * published under a raw source string: gas is intentionally out of scope for
 * now, and an unknown fuel must not appear in the catalogue by accident.
 */
const SUPPORTED_FUELS = new Set(["gasoline", "diesel", "electric", "hybrid"]);

const fuel = (v: string | null): string | null => {
  const s = (v ?? "").toLowerCase();
  if (s.includes("디젤") || s.includes("diesel")) return "diesel";
  if (s.includes("전기") || s.includes("electric")) return "electric";
  if (s.includes("하이브리드") || s.includes("hybrid")) return "hybrid";
  if (s.includes("가솔린") || s.includes("gas")) return "gasoline";
  return null;
};

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

async function main() {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const rateSnapshot = await getCbrCalcRates();

    // The join key mirrors the vocabulary the review queue was built with; it is
    // a key, not a classification, so it stays exactly as before. The card's own
    // fuel type is derived by `fuel()` above.
    const q = await c.query(`
      select s.source_listing_id, s.source_url, s.manufacturer, s.model, s.generation, s.trim,
             s.model_year, s.first_registration_date, s.mileage_km, s.price_krw, s.engine_cc,
             s.fuel_type, s.transmission, s.drive_type, s.exterior_color, s.body_type, s.location,
             s.vin_masked, q.current_sources
      from public.chestny_catalog_staging s
      join public.vehicle_power_review_queue q on q.configuration_key = concat(
        coalesce(s.manufacturer,''),'|',coalesce(s.model,''),'|',coalesce(s.model_year::text,''),'|',
        coalesce(s.engine_cc::text,''),'|',
        case when s.fuel_type ilike '%디젤%' then 'diesel'
             when s.fuel_type ilike '%가솔린%' then 'gasoline'
             when s.fuel_type ilike '%전기%' then 'hybrid'
             else coalesce(s.fuel_type,'') end,
        '|',coalesce(s.drive_type,''))
      where s.source_status = 'active' and q.status = 'verified'
        and q.review_note like 'Подтверждено по единственному%'
      order by s.source_listing_id${limit > 0 ? ` limit ${limit}` : ""}`);

    const rows = q.rows.filter((r) => r.price_krw != null && r.model_year != null && r.current_sources?.power_hp != null);
    const payload: Array<Record<string, unknown>> = [];
    const skipReasons: Record<string, number> = {};
    const unsupportedFuelValues: Record<string, number> = {};

    for (const r of rows) {
      const fuelType = fuel(r.fuel_type);
      // Unsupported fuel (LPG, hydrogen, unknown): skipped on purpose and
      // reported by its raw source value, never published with a raw label.
      if (!fuelType || !SUPPORTED_FUELS.has(fuelType)) {
        bump(skipReasons, "unsupported_fuel");
        bump(unsupportedFuelValues, String(r.fuel_type ?? "<null>").trim());
        continue;
      }
      const monthInfo = resolveCalculationMonth({ registrationDate: r.first_registration_date });

      // A card without a usable registration month is not priced on a silent
      // default: it is held so the price cannot look exact.
      if (monthInfo.source === "fallback") { bump(skipReasons, "month_pending"); continue; }

      const powerHp = Math.round(Number(r.current_sources.power_hp));
      const powerBasis = powerBasisForFuel(fuelType);
      const calculationPowerKw = Number((powerHp * KW_PER_PS).toFixed(4));

      const calc = calculateRuVladivostok({
        priceKrw: Number(r.price_krw), year: Number(r.model_year), month: monthInfo.month,
        engineCc: r.engine_cc == null ? null : Number(r.engine_cc), powerHp,
        fuelType: fuelType ?? undefined, destinationCity: "Владивосток",
        rates: rateSnapshot.rates, customsRates: rateSnapshot.customsRates,
        ratesAsOf: rateSnapshot.asOf, ratesSource: rateSnapshot.source, rateDetails: rateSnapshot.rateDetails,
      });
      const priceRub = Math.round(calc.totalRub);

      // The card is inserted through the same contract the catalogue audit uses,
      // so a bypass cannot create a row the audit would reject.
      const verdict = evaluatePublication({
        priceRub,
        hasSnapshot: true,
        calculationPowerStatus: "matched",
        calculationPowerKw,
        powerBasis,
        powerResolutionSource: "tl_auto_review_queue:unique_match",
        calculationMonth: monthInfo.month,
        fuelType,
        hybridDvsPowerHp: null,
        powerConfidence: "high",
        calculationPowerSpecId: null,
        legacyCalculationStatus: null,
      });
      if (!verdict.ok) { bump(skipReasons, `contract_${verdict.blockers[0]}`); continue; }

      payload.push({
        primary_source: "chestny_prigon",
        source_kind: "chestny_prigon",
        source_id: String(r.source_listing_id),
        source_url: r.source_url,
        enrichment_status: "source_only",
        is_available: true,
        source_updated_at: null,
        last_seen_at: new Date().toISOString(),
        brand: r.manufacturer,
        model: displayModelName(r.model),
        generation: r.generation,
        year: r.model_year,
        registration_year: r.model_year,
        registration_date: r.first_registration_date,
        mileage_km: r.mileage_km,
        price_krw: r.price_krw,
        price_rub: priceRub,
        engine_cc: r.engine_cc,
        power_hp: powerHp,
        power_source: "tl_auto_approved_reference",
        power_confidence: "high",
        power_resolution_note: `Сопоставлено со справочником TL Auto; calculation_power_kw выведено из подтверждённой мощности ${powerHp} л.с.`,
        fuel_type: fuelType,
        transmission: r.transmission,
        drive_type: normalizeDrive([r.drive_type, r.trim, r.generation].filter(Boolean).join(" ")) ?? r.drive_type,
        color: normalizeColor(r.exterior_color),
        body_type: r.body_type,
        seller_region: r.location,
        vin_masked: r.vin_masked,
        vehicle_specs: { source: "chestny_prigon" },
        calculation_power_status: "matched",
        calculation_power_kw: calculationPowerKw,
        power_basis: powerBasis,
        power_resolution_source: "tl_auto_review_queue:unique_match",
        calculation_month: monthInfo.month,
        calculation_month_source: monthInfo.source,
        legacy_calculation_status: "calculated_from_staging",
      });
    }

    if (!dryRun) {
      for (let i = 0; i < payload.length; i += 250) {
        const part = payload.slice(i, i + 250);
        const cols = Object.keys(part[0]);
        const vals: unknown[] = [];
        const tuples = part.map((row) => `(${cols.map((k) => { vals.push(row[k]); return "$" + vals.length; }).join(",")})`);
        // `generation` is updated with coalesce: an empty source value must not
        // erase a generation that was already resolved for the card.
        const updatable = cols.filter((k) => !["primary_source", "source_id", "generation"].includes(k));
        await c.query(`insert into public.cars(${cols.join(",")}) values ${tuples.join(",")} on conflict(primary_source,source_id) do update set ${updatable.map((k) => `${k}=excluded.${k}`).join(",")},generation=coalesce(excluded.generation,cars.generation),updated_at=now()`, vals);
      }
    }

    console.log(JSON.stringify({
      dryRun,
      limit: limit || null,
      totalMatched: q.rowCount ?? 0,
      eligibleRows: rows.length,
      skipped: (q.rowCount ?? 0) - rows.length,
      prepared: payload.length,
      skippedByReason: skipReasons,
      unsupportedFuelValues,
      imported: dryRun ? 0 : payload.length,
      note: "Only verified queue rows; no images copied.",
    }, null, 2));
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
