import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { displayModelName } from "../src/server/catalog/display-model";
import { evaluatePublication, storedPowerFinality } from "../src/server/cars/calculation-contract";
import { tierFromStored, type EvidenceTier } from "../src/server/power-resolution/evidence-tiers";
import { decidePublication } from "../src/server/power-resolution/publication-gate";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.CHESTNY_ENRICHED_PUBLISH_DRY_RUN !== "false";
const publishStatus = process.env.CHESTNY_ENRICHED_PUBLISH_STATUS ?? "power_confirmed";
const autoHomeApprovedOnly = process.env.CHESTNY_ENRICHED_PUBLISH_AUTOHOME_APPROVED_ONLY === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

/**
 * Publisher contract.
 *
 * Power may only come from an approved, locally confirmed rule. Staging rows
 * carry that binding in `raw_payload.power_confirmation`, written by
 * `resolve-auto-candidate-power.ts`. This script never re-derives power from
 * the legacy manifest or from a displacement map, and it never invents a drive
 * axle: rows without a confirmed drive or registration month are excluded
 * instead of being published with an assumption. Every exclusion is reported
 * so a batch cannot silently shrink (decision D4).
 */

type StageRow = {
  source_listing_id: string; source_url: string | null; manufacturer: string | null; model: string | null;
  generation: string | null; trim: string | null;
  model_year: number | null; first_registration_date: string | null; mileage_km: number | null;
  price_krw: number | null; engine_cc: number | null; fuel_type: string | null; transmission: string | null;
  drive_type: string | null; exterior_color: string | null; body_type: string | null; location: string | null;
  vin_masked: string | null; image_urls: unknown; raw_payload: Record<string, unknown> | null;
};

type RefRow = {
  spec_id: string; spec_version: number; spec_key: string; calculation_power_kw: number; power_basis: string;
  source_priority: number; evidence_id: string; evidence_kind: string; source_uri: string | null;
  source_title: string | null; evidence_note: string | null; evidence_reliability: string | null;
  evidence_tier: string | null;
  match_id: string; match_priority: number; brand: string | null; model: string | null; generation: string | null;
  trim: string | null; badge_normalized: string | null; model_code: string | null; engine_code: string | null;
  fuel_type: string | null; drive_type: string | null; production_year_from: number | null;
  production_year_to: number | null; engine_cc_from: number | null; engine_cc_to: number | null;
};

/** Model names are written through the shared mapping so every writer agrees. */
const displayModel = displayModelName;

/** External gallery only; duplicates and non-http entries are dropped, order kept. */
const galleryUrls = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of value) {
    const url = typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
};

function registrationMonth(firstRegistrationDate: string | null, modelYear: number | null) {
  if (!firstRegistrationDate) return null;
  const date = new Date(firstRegistrationDate);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  if (modelYear != null && year < modelYear - 1) return null;
  return date.getUTCMonth() + 1;
}

type PreparedItem = {
  row: StageRow;
  hp: number;
  month: number;
  images: string[];
  drive: string;
  driveState: string;
  fuel: string | null;
  tier: EvidenceTier;
  confidence: string;
  specId: string;
  specVersion: number;
  specPowerBasis: string;
  calculationPowerKw: number | null;
  evidenceId: string;
  specKey: string;
  specificationTitle: string | null;
  calc: ReturnType<typeof calculateRuVladivostok>;
  priceRub: number;
};

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // One verified rate bundle is used for the complete publication batch.
    // Never let this path fall through to the static calculator defaults.
    const rateSnapshot = await getCbrCalcRates();

    const refs = await client.query<RefRow>(`select spec.id spec_id,spec.version spec_version,spec.spec_key,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
          evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.reliability evidence_reliability,evidence.evidence_tier,
          matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec
        join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved' and spec.customs_power_hp is not null`);
    const rows = await client.query<StageRow>(`
        select source_listing_id,source_url,manufacturer,model,generation,trim,model_year,first_registration_date,mileage_km,
          price_krw,engine_cc,fuel_type,transmission,drive_type,exterior_color,body_type,location,vin_masked,image_urls,raw_payload
        from public.chestny_catalog_staging
        where source_status='active' and promotion_status=$1 and raw_payload ? 'encar_enrichment'
          and ($2::boolean = false or (
            raw_payload ? 'autohome_power_candidate'
            and raw_payload->'autohome_power_candidate'->>'review_status' = 'approved'
          ))
        order by source_listing_id
      `, [publishStatus, autoHomeApprovedOnly]);

    const refBySpecId = new Map<string, RefRow>();
    for (const ref of refs.rows) if (!refBySpecId.has(ref.spec_id)) refBySpecId.set(ref.spec_id, ref);

    const candidates: ApprovedPowerCandidate[] = canonicalCandidates(refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(r.source_priority),
      evidenceId: r.evidence_id, evidenceKind: r.evidence_kind as ApprovedPowerCandidate["evidenceKind"],
      evidenceVerificationStatus: "approved",
      evidenceReliability: (r.evidence_reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: Number(r.match_priority), brand: String(r.brand ?? ""), model: String(r.model ?? ""),
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));

    const tierBySpecId = new Map<string, EvidenceTier>();
    const kwBySpecId = new Map<string, number>();
    for (const ref of refs.rows) {
      tierBySpecId.set(ref.spec_id, tierFromStored(ref.evidence_tier, {
        specKey: ref.spec_key, sourceKind: ref.evidence_kind, sourceTitle: ref.source_title,
        sourceUri: ref.source_uri, note: ref.evidence_note,
      }));
      kwBySpecId.set(ref.spec_id, Number(ref.calculation_power_kw));
    }

    const excludedByReason: Record<string, number> = {};
    const sampleExclusions: Array<{ id: string; reason: string }> = [];
    const exclude = (id: string, reason: string) => {
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
      if (sampleExclusions.length < 15) sampleExclusions.push({ id, reason });
    };

    const eligible: PreparedItem[] = [];
    const tierBreakdown: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };

    for (const row of rows.rows) {
      const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
      const confirmation = payload.power_confirmation as Record<string, unknown> | undefined;
      if (!confirmation || typeof confirmation !== "object") { exclude(row.source_listing_id, "no_power_confirmation"); continue; }

      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? row.trim;

      // Re-resolve the card against the approved reference; the gate then
      // requires the confirmed specification to remain the unique winner.
      const input = canonicalInput({
        brand: row.manufacturer, model: row.model, generation: row.generation, trim: grade,
        fuelType: row.fuel_type, driveType: row.drive_type, year: row.model_year, engineCc: row.engine_cc,
      });
      let resolution = resolveApprovedPower(input, candidates);
      // An alternative public source may be explicitly approved by the
      // project owner. In that case the stored confirmation is the reviewed
      // binding: validate the card against that one approved specification
      // instead of rejecting it merely because another broad rule overlaps.
      const confirmationConfidence = String(confirmation.confidence ?? "");
      if (
        confirmation.spec_id &&
        (confirmationConfidence === "exact_autohome_configuration" ||
          confirmationConfidence === "owner_approved_alternative_autohome")
      ) {
        const confirmedCandidates = candidates.filter((candidate) => candidate.specId === String(confirmation.spec_id));
        const confirmedInput = canonicalInput({
          brand: row.manufacturer, model: row.model, generation: row.generation, trim: row.trim,
          fuelType: row.fuel_type, driveType: row.drive_type, year: row.model_year, engineCc: row.engine_cc,
        });
        const confirmedResolution = resolveApprovedPower(confirmedInput, confirmedCandidates);
        if (confirmedResolution.status === "matched") {
          resolution = confirmedResolution;
        } else if (confirmedCandidates.length) {
          const fields = (confirmation.match_fields ?? {}) as Record<string, unknown>;
          const years = Array.isArray(fields.years) ? fields.years.map(Number) : [];
          const engineRange = Array.isArray(fields.engine_cc) ? fields.engine_cc.map(Number) : [];
          const exactStoredBinding =
            String(fields.generation ?? "") === String(row.generation ?? "") &&
            String(fields.trim ?? "") === String(row.trim ?? "") &&
            String(fields.fuel_type ?? "") === String(row.fuel_type ?? "") &&
            String(fields.drive_type ?? "") === String(row.drive_type ?? "") &&
            years.length === 2 && row.model_year != null && row.model_year >= years[0] && row.model_year <= years[1] &&
            engineRange.length === 2 && row.engine_cc != null && row.engine_cc >= engineRange[0] && row.engine_cc <= engineRange[1];
          if (exactStoredBinding) {
            resolution = {
              status: "matched",
              confidence: "high",
              candidate: confirmedCandidates[0],
              candidates: confirmedCandidates,
              reason: "owner_approved_alternative_source_binding",
            };
          }
        }
      }
      const images = galleryUrls(row.image_urls);
      const month = registrationMonth(row.first_registration_date, row.model_year);
      const hasRequiredSourceData = Boolean(
        row.price_krw && row.model_year && row.mileage_km != null && row.mileage_km >= 0 &&
        row.engine_cc && input.fuelType,
      );

      const decision = decidePublication({
        resolution,
        confirmedSpecId: confirmation.spec_id == null ? null : String(confirmation.spec_id),
        confirmedHp: confirmation.power_hp == null ? null : Number(confirmation.power_hp),
        tierBySpecId, kwBySpecId,
        driveType: input.driveType,
        registrationMonth: month,
        photoCount: images.length,
        hasRequiredSourceData,
      });
      if (decision.status === "exclude") { exclude(row.source_listing_id, decision.reason); continue; }

      const ref = refBySpecId.get(decision.specId);
      if (!ref || !input.driveType || month == null) {
        // The gate already validated these; keep a defensive guard so a future
        // gate change cannot silently publish an incomplete card.
        exclude(row.source_listing_id, "internal_gate_inconsistency");
        continue;
      }

      const hp = decision.hp;
      const drive = input.driveType;
      const tier = decision.tier;
      const calculationPowerKw = kwBySpecId.get(decision.specId) ?? null;

      const calc = calculateRuVladivostok({
        priceKrw: row.price_krw as number,
        year: row.model_year as number,
        month,
        engineCc: row.engine_cc as number,
        powerHp: hp,
        fuelType: input.fuelType ?? undefined,
        destinationCity: "Владивосток",
        rates: rateSnapshot.rates,
        customsRates: rateSnapshot.customsRates,
        ratesAsOf: rateSnapshot.asOf,
        ratesSource: rateSnapshot.source,
        rateDetails: rateSnapshot.rateDetails,
      });

      // Final contract check with the real price: the publisher must not create a
      // card the catalogue audit would reject.
      const contractVerdict = evaluatePublication({
        priceRub: Math.round(calc.totalRub),
        hasSnapshot: true,
        calculationPowerStatus: "approved",
        calculationPowerKw,
        powerBasis: ref.power_basis,
        powerResolutionSource: `tl_auto_approved_reference:${tier}`,
        calculationMonth: month,
        fuelType: input.fuelType,
        hybridDvsPowerHp: null,
        powerConfidence: decision.confidence,
        calculationPowerSpecId: decision.specId,
        legacyCalculationStatus: null,
      });
      if (!contractVerdict.ok) {
        exclude(row.source_listing_id, `contract_${contractVerdict.blockers[0]}`);
        continue;
      }

      const item: PreparedItem = {
        row, hp, month, images, drive, fuel: input.fuelType, tier,
        confidence: decision.confidence,
        driveState: decision.driveState,
        specId: decision.specId, specVersion: ref.spec_version, specPowerBasis: ref.power_basis,
        calculationPowerKw,
        evidenceId: ref.evidence_id, specKey: ref.spec_key,
        specificationTitle: ref.source_title,
        calc, priceRub: Math.round(calc.totalRub),
      };
      eligible.push(item);
      tierBreakdown[tier] = (tierBreakdown[tier] ?? 0) + 1;
    }

    if (!dryRun && eligible.length) {
      await client.query("begin");
      try {
        const carIds: Array<{ id: string; item: PreparedItem }> = [];
        for (const item of eligible) {
          const { row, hp, drive, month, tier, confidence, specId, evidenceId, specKey, specificationTitle } = item;
          // Evidence below T1/T2 stays provisional even when the gate reported a
          // confirmed confidence; the value may be shown, never as final.
          const powerFinality = storedPowerFinality({ powerConfidence: confidence,
            calculationPowerKw: item.calculationPowerKw, powerResolutionSource: `tl_auto_approved_reference:${tier}`,
            calculationPowerSpecId: specId, evidenceTier: tier });
          if (powerFinality == null) throw new Error(`Power finality not resolvable: ${row.source_listing_id}`);
          const metadata = {
            source: "chestny_prigon",
            power_resolution: "approved_evidence_confirmation",
            power_spec_key: specKey,
            power_spec_id: specId,
            power_evidence_id: evidenceId,
            evidence_tier: tier,
            drive_resolution: "source",
            drive_state: item.driveState,
            source_specification: specificationTitle,
            registration_month_source: "first_registration_date",
          };
          const result = await client.query<{ id: string }>(`
            insert into public.cars(primary_source,source_kind,source_id,source_url,enrichment_status,is_available,sale_status,published_at,source_updated_at,last_seen_at,
              brand,model,year,registration_year,registration_date,registration_month,mileage_km,price_krw,price_rub,engine_cc,power_hp,power_source,power_confidence,power_resolution_note,
              fuel_type,transmission,drive_type,color,body_type,seller_region,vin_masked,vehicle_specs,generation,
              calculation_power_status,calculation_power_spec_id,calculation_power_spec_version,calculation_power_kw,power_basis,power_resolution_source,calculation_month,calculation_month_source,power_finality,
              published_at_source,catalog_added_at,encar_enrichment_status)
            values ('chestny_prigon','chestny_prigon',$1,$2,'source_only',true,null,null,now(),now(),
              $3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,'tl_auto_approved_reference',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$28,
              'approved',$23,$24,$25,$26,$27,$7,'registration_date',$29,
              'unknown',now(),'absent')
            on conflict(primary_source,source_id) do update set source_url=excluded.source_url,enrichment_status=excluded.enrichment_status,is_available=true,sale_status=null,published_at=coalesce(cars.published_at,now()),
              source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at,brand=excluded.brand,model=excluded.model,year=excluded.year,registration_year=excluded.registration_year,
              registration_date=excluded.registration_date,registration_month=excluded.registration_month,mileage_km=excluded.mileage_km,price_krw=excluded.price_krw,price_rub=excluded.price_rub,engine_cc=excluded.engine_cc,power_hp=excluded.power_hp,
              power_source=excluded.power_source,power_confidence=excluded.power_confidence,power_resolution_note=excluded.power_resolution_note,fuel_type=excluded.fuel_type,transmission=excluded.transmission,
              drive_type=excluded.drive_type,color=excluded.color,body_type=excluded.body_type,seller_region=excluded.seller_region,vin_masked=excluded.vin_masked,vehicle_specs=excluded.vehicle_specs,
              generation=coalesce(excluded.generation, cars.generation),
              calculation_power_status=excluded.calculation_power_status,calculation_power_spec_id=excluded.calculation_power_spec_id,calculation_power_spec_version=excluded.calculation_power_spec_version,
              calculation_power_kw=excluded.calculation_power_kw,power_basis=excluded.power_basis,power_resolution_source=excluded.power_resolution_source,
              calculation_month=excluded.calculation_month,calculation_month_source=excluded.calculation_month_source,power_finality=excluded.power_finality,
              published_at_source=coalesce(cars.published_at_source, excluded.published_at_source),
              catalog_added_at=coalesce(cars.catalog_added_at, excluded.catalog_added_at),
              encar_enrichment_status=excluded.encar_enrichment_status,updated_at=now()
            returning id
          `, [row.source_listing_id, row.source_url, row.manufacturer, displayModel(row.model), row.model_year,
            row.first_registration_date, month, row.mileage_km, row.price_krw, item.priceRub, row.engine_cc, hp,
            confidence, `Подтверждено локальным справочником TL Auto: ${specKey}; tier=${tier}.`,
            item.fuel, row.transmission, drive, row.exterior_color, row.body_type, row.location, row.vin_masked,
            JSON.stringify(metadata),
            specId, item.specVersion, item.calculationPowerKw, item.specPowerBasis,
            `tl_auto_approved_reference:${tier}`, row.generation, powerFinality]);
          carIds.push({ id: result.rows[0].id, item });
        }

        const ids = carIds.map((entry) => entry.id);
        if (ids.length) await client.query(`delete from public.car_media where source='chestny_prigon' and car_id = any($1::uuid[])`, [ids]);
        const media = carIds.flatMap(({ id, item }) => item.images.map((url, index) => [id, url, index, index === 0]));
        for (let i = 0; i < media.length; i += 500) {
          const values: unknown[] = [];
          const tuples = media.slice(i, i + 500).map((entry, index) => {
            const base = index * 4; values.push(...entry);
            return `($${base + 1},'chestny_prigon','image','outer',$${base + 2},$${base + 2},$${base + 3},$${base + 4},'external_url')`;
          });
          await client.query(`insert into public.car_media(car_id,source,media_type,category,url,thumbnail_url,sort_order,is_primary,legal_mode) values ${tuples.join(",")}`, values);
        }

        if (ids.length) await client.query(`delete from public.calc_snapshots where car_id = any($1::uuid[])`, [ids]);
        for (let offset = 0; offset < carIds.length; offset += 100) {
          const values: unknown[] = [];
          const tuples = carIds.slice(offset, offset + 100).map(({ id, item }, index) => {
            const base = index * 12; const { calc, row, hp, month } = item;
            values.push(id, calc.calcVersion,
              JSON.stringify({ priceKrw: row.price_krw, year: row.model_year, month, engineCc: row.engine_cc, powerHp: hp, fuelType: item.fuel, destinationCity: "Владивосток" }),
              JSON.stringify({ ...calc.rates, details: calc.rateDetails }), JSON.stringify(calc), Math.round(calc.carPriceRub), Math.round(calc.dutyRub), Math.round(calc.feesRub), Math.round(calc.utilRub), Math.round(calc.freightRub), Math.round(calc.brokerRub), Math.round(calc.totalRub));
            return `($${base + 1},'RU','Владивосток','individual',$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12})`;
          });
          await client.query(`insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub) values ${tuples.join(",")}`, values);
        }

        await client.query(`update public.chestny_catalog_staging set promotion_status='published', promotion_note='Published from locally confirmed power evidence; drive and month taken from source.', updated_at=now() where source_listing_id = any($1::text[])`,
          [eligible.map((item) => item.row.source_listing_id)]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun,
      publishStatus,
      sourceRows: rows.rowCount,
      prepared: eligible.length,
      eligible: eligible.length,
      excluded: rows.rowCount == null ? 0 : rows.rowCount - eligible.length,
      excludedByReason,
      tierBreakdown,
      sampleExclusions,
      mediaRows: eligible.reduce((sum, item) => sum + item.images.length, 0),
      powerResolution: "approved_evidence_confirmation",
      legacyManifestUsed: false,
      driveFallbackUsed: false,
      autoHomeApprovedOnly,
      encarRequests: 0,
      publicCatalogChanged: !dryRun,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
