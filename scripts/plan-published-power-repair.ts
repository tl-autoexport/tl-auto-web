import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { hpFromKw } from "../src/server/power-resolution/publication-gate";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Read-only repair plan for published cards whose power disagrees with the
 * approved reference. It reports, per card, the live value, the approved value
 * and the resulting price so the change can be approved before any write.
 *
 * The three price columns isolate the causes:
 *   priceBefore                - what is live now;
 *   priceAfterPowerOnly        - corrected power, month still June (power effect only);
 *   priceAfterPowerAndMonth    - corrected power and the real registration month.
 *
 * No Encar requests, no database writes, public catalog untouched.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

function monthFromDate(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return date.getUTCMonth() + 1;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const rateSnapshot = await getCbrCalcRates();

    const refs = await db.query(`select spec.id spec_id,spec.version spec_version,spec.spec_key,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.reliability,
        matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
      where spec.status='approved' and evidence.verification_status='approved'`);

    const cars = await db.query(`select c.id,c.source_id,c.brand,c.model,c.year,c.engine_cc,c.fuel_type,c.drive_type,c.power_hp,
        c.price_rub,c.registration_date,c.vehicle_specs,
        s.generation staging_generation,s.trim staging_trim,s.price_krw staging_price_krw,s.raw_payload staging_payload
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id=c.source_id
      where c.primary_source='chestny_prigon' and c.is_available=true`);

    const candidates: ApprovedPowerCandidate[] = canonicalCandidates(refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(r.source_priority),
      evidenceId: r.evidence_id, evidenceKind: r.evidence_kind as ApprovedPowerCandidate["evidenceKind"],
      evidenceVerificationStatus: "approved",
      evidenceReliability: (r.reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: Number(r.match_priority), brand: String(r.brand ?? ""), model: String(r.model ?? ""),
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));

    const plan: Array<Record<string, unknown>> = [];
    let skippedNoFuel = 0;

    for (const car of cars.rows) {
      const payload = (car.staging_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? car.staging_trim;

      const input = canonicalInput({
        brand: car.brand, model: car.model, generation: car.staging_generation, trim: grade,
        fuelType: car.fuel_type, driveType: car.drive_type, year: car.year, engineCc: car.engine_cc,
      });
      const resolution = resolveApprovedPower(input, candidates);
      if (resolution.status !== "matched") continue;

      const referenceHp = hpFromKw(Number(resolution.candidate.calculationPowerKw));
      if (car.power_hp == null || Math.abs(car.power_hp - referenceHp) <= 1) continue;
      if (!car.price_rub || !car.year || !car.engine_cc || !input.fuelType) { skippedNoFuel++; continue; }

      const baseInput = {
        priceKrw: 0, year: car.year, engineCc: car.engine_cc, fuelType: input.fuelType ?? undefined,
        destinationCity: "Владивосток", rates: rateSnapshot.rates, customsRates: rateSnapshot.customsRates,
        ratesAsOf: rateSnapshot.asOf, ratesSource: rateSnapshot.source, rateDetails: rateSnapshot.rateDetails,
      };
      const registrationMonth = monthFromDate(car.registration_date);
      const priceKrw = Number(car.staging_price_krw ?? payload.priceKrw ?? 0);
      if (!priceKrw) { skippedNoFuel++; continue; }

      const powerOnly = calculateRuVladivostok({ ...baseInput, priceKrw, month: 6, powerHp: referenceHp });
      const powerAndMonth = calculateRuVladivostok({ ...baseInput, priceKrw, month: registrationMonth ?? 6, powerHp: referenceHp });

      plan.push({
        sourceId: car.source_id,
        brand: car.brand, model: car.model, year: car.year, engineCc: car.engine_cc, trim: grade ?? null,
        storedHp: car.power_hp,
        referenceHp,
        deltaHp: referenceHp - car.power_hp,
        specKey: refs.rows.find((r) => r.spec_id === resolution.candidate.specId)?.spec_key ?? null,
        registrationMonth,
        priceBefore: Math.round(Number(car.price_rub)),
        priceAfterPowerOnly: Math.round(powerOnly.totalRub),
        priceAfterPowerAndMonth: Math.round(powerAndMonth.totalRub),
      });
    }

    const delta = (from: string, to: string) =>
      plan.reduce((sum, item) => sum + (Number(item[to]) - Number(item[from])), 0);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      publicCatalogChanged: false,
      rateAsOf: rateSnapshot.asOf,
      cardsToRepair: plan.length,
      skipped: skippedNoFuel,
      totals: {
        priceDeltaFromPowerRub: delta("priceBefore", "priceAfterPowerOnly"),
        priceDeltaFromPowerAndMonthRub: delta("priceBefore", "priceAfterPowerAndMonth"),
        raised: plan.filter((item) => Number(item.priceAfterPowerAndMonth) > Number(item.priceBefore)).length,
        lowered: plan.filter((item) => Number(item.priceAfterPowerAndMonth) < Number(item.priceBefore)).length,
      },
      plan,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
