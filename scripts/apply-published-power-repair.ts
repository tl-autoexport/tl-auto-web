import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { hpFromKw } from "../src/server/power-resolution/publication-gate";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Applies the approved repair for published cards whose power disagrees with
 * the approved reference, and recalculates their prices with the real
 * registration month.
 *
 * Read-only by default. Set POWER_REPAIR_WRITE=true to apply.
 * No Encar requests. Only the affected cards are touched.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.POWER_REPAIR_WRITE === "true";
const expected = Number(process.env.POWER_REPAIR_EXPECT ?? 169);
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

function monthFromDate(value: string | null): { month: number | null; source: string } {
  if (!value) return { month: null, source: "unknown_june_placeholder" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { month: null, source: "unknown_june_placeholder" };
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return { month: null, source: "unknown_june_placeholder" };
  return { month: date.getUTCMonth() + 1, source: "first_registration_date" };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
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

    type Repair = {
      carId: string; sourceId: string; hp: number; previousHp: number; confidence: string; specId: string; specKey: string;
      evidenceId: string; priceRub: number; priceBefore: number; calculation: ReturnType<typeof calculateRuVladivostok>;
      inputs: Record<string, unknown>;
    };
    const repairs: Repair[] = [];

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

      const hp = hpFromKw(Number(resolution.candidate.calculationPowerKw));
      if (car.power_hp == null || Math.abs(car.power_hp - hp) <= 1) continue;

      const priceKrw = Number(car.staging_price_krw ?? payload.priceKrw ?? 0);
      if (!priceKrw || !car.year || !car.engine_cc || !input.fuelType) continue;

      const { month, source: monthSource } = monthFromDate(car.registration_date);
      const calc = calculateRuVladivostok({
        priceKrw, year: car.year, month: month ?? 6, engineCc: car.engine_cc, powerHp: hp,
        fuelType: input.fuelType ?? undefined, destinationCity: "Владивосток",
        rates: rateSnapshot.rates, customsRates: rateSnapshot.customsRates, ratesAsOf: rateSnapshot.asOf,
        ratesSource: rateSnapshot.source, rateDetails: rateSnapshot.rateDetails,
      });

      repairs.push({
        carId: car.id, sourceId: car.source_id, hp, previousHp: car.power_hp, confidence: resolution.confidence,
        specId: resolution.candidate.specId,
        specKey: refs.rows.find((r) => r.spec_id === resolution.candidate.specId)?.spec_key ?? "unknown",
        evidenceId: resolution.candidate.evidenceId, priceRub: Math.round(calc.totalRub),
        priceBefore: Math.round(Number(car.price_rub ?? 0)), calculation: calc,
        inputs: { priceKrw, year: car.year, month: month ?? 6, monthSource, engineCc: car.engine_cc, powerHp: hp, fuelType: input.fuelType, destinationCity: "Владивосток" },
      });
    }

    if (repairs.length !== expected) {
      throw new Error(`Repair set mismatch: ${repairs.length} cards, expected ${expected}. Aborting without writing.`);
    }

    let written = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const repair of repairs) {
          await db.query(
            `update public.cars
                set power_hp=$2, power_source='tl_auto_approved_reference', power_confidence=$3,
                    price_rub=$4, vehicle_specs = coalesce(vehicle_specs,'{}'::jsonb) || $5::jsonb, updated_at=now()
              where id=$1`,
            [repair.carId, repair.hp, repair.confidence, repair.priceRub, JSON.stringify({
              power_repair: {
                spec_key: repair.specKey, spec_id: repair.specId, evidence_id: repair.evidenceId,
                previous_power_hp: repair.previousHp, applied_at: new Date().toISOString(),
              },
              registration_month_source: repair.inputs.monthSource,
            })],
          );
          await db.query(`delete from public.calc_snapshots where car_id=$1`, [repair.carId]);
          const calc = repair.calculation;
          await db.query(
            `insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
             values ($1,'RU','Владивосток','individual',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
            [repair.carId, calc.calcVersion, JSON.stringify(repair.inputs),
              JSON.stringify({ ...calc.rates, details: calc.rateDetails }), JSON.stringify(calc),
              Math.round(calc.carPriceRub), Math.round(calc.dutyRub), Math.round(calc.feesRub),
              Math.round(calc.utilRub), Math.round(calc.freightRub), Math.round(calc.brokerRub), repair.priceRub],
          );
          written++;
        }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    const beforeTotal = repairs.reduce((sum, item) => sum + item.priceBefore, 0);
    const afterTotal = repairs.reduce((sum, item) => sum + item.priceRub, 0);
    console.log(JSON.stringify({
      dryRun: !write,
      rateAsOf: rateSnapshot.asOf,
      cardsToRepair: repairs.length,
      written,
      priceBeforeTotalRub: beforeTotal,
      priceAfterTotalRub: afterTotal,
      priceDeltaRub: afterTotal - beforeTotal,
      raised: repairs.filter((item) => item.priceRub > item.priceBefore).length,
      lowered: repairs.filter((item) => item.priceRub < item.priceBefore).length,
      samples: repairs.slice(0, 5).map((item) => ({
        sourceId: item.sourceId, specKey: item.specKey, hp: item.hp,
        priceBefore: item.priceBefore, priceAfter: item.priceRub,
      })),
      encarRequests: 0,
      publicCatalogChanged: write,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
