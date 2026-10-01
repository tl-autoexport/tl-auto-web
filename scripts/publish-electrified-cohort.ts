/** Publish only the frozen hybrid/EV allowlist for Encar run 21a687ee. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, resolveCalculationMonth, storedPowerFinality } from "../src/server/cars/calculation-contract";
import { normalizeColor, normalizePlate } from "../src/server/normalization/vehicles";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import { mapEncarOptions } from "../src/server/imports/encar-options";
import type { EncarOptionRow } from "../src/server/imports/encar-options";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const POWER_PATH = "data/power/electrified-21a687ee-power-reference.json";
const PLAN_PATH = "output/tl-auto-electrified-21a687ee-power-plan.json";
const READINESS_PATH = "output/tl-auto-electrified-21a687ee-incremental-readiness-v4.json";
const BASELINE_MANIFEST_PATH = "output/tl-auto-electrified-21a687ee-publication-manifest-v3.json";
const MANIFEST_PATH = process.env.TL_AUTO_ELECTRIFIED_PUBLICATION_MANIFEST ??
  "output/tl-auto-electrified-21a687ee-incremental-manifest-v4.json";
const REPORT_PATH = process.env.TL_AUTO_ELECTRIFIED_PUBLICATION_REPORT ??
  "output/tl-auto-electrified-21a687ee-publication-report.json";
const WRITE = process.env.TL_AUTO_ELECTRIFIED_PUBLICATION_WRITE === "true";
const PROBE = process.env.TL_AUTO_ELECTRIFIED_PUBLICATION_PROBE === "true";
const BATCH_SIZE = Number(process.env.TL_AUTO_ELECTRIFIED_PUBLICATION_BATCH_SIZE ?? 25);
const DB_URL = process.env.SUPABASE_DB_URL;
const KW_PER_PS = 0.73549875;

type Obj = Record<string, unknown>;
type PowerEntry = {
  sourceListingId: string; brand: string; model: string; year: number; fuelType: "hybrid" | "electric";
  sourceKind: string; sourceUrl: string; sourceNote: string; powerBasis: "parallel_sum" | "electric_30min";
  customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null;
  electric30MinPs: number | null; electric30MinKw: number | null;
  peakOrSystemPowerPs: number | null; grade: string | null; gradeDetail: string | null;
};
type Stage = {
  source_listing_id: string; queue_status: string; staging_status: string; source_url: string | null;
  fetched_at: string | null; candidate_snapshot: Obj | null; raw_payload: Obj | null;
};
type Prepared = {
  id: string; stage: Stage; car: Obj; calculation: ReturnType<typeof calculateRuVladivostok>;
  reviewedPriceRub: number;
  photos: Array<{ category: string; url: string }>; options: EncarOptionRow[];
};

const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: unknown): number | null => { const parsed = num(value); return parsed != null && parsed > 0 ? parsed : null; };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const imageUrl = (path: string) => /^https?:\/\//i.test(path) ? path : `https://ci.encar.com${path}`;
const vehicleHash = (value: string) => createHash("sha256")
  .update(value.toUpperCase().replace(/[^0-9A-Z가-힣]/g, ""))
  .digest("hex");

function photosFrom(payload: Obj) {
  const photos = obj(payload.detail).photos;
  if (!Array.isArray(photos)) return [];
  const unique = new Map<string, string>();
  for (const raw of photos) {
    const item = obj(raw), path = str(item.path);
    if (!path) continue;
    const type = String(item.type ?? item.code ?? "").toLowerCase();
    const category = /outer|thumbnail|exterior|외관/.test(type) ? "outer"
      : /inner|interior|실내/.test(type) ? "inner"
        : type === "option" ? "option" : "photo";
    const url = imageUrl(path);
    if (!unique.has(url) || category === "outer") unique.set(url, category);
  }
  return [...unique].map(([url, category]) => ({ url, category }))
    .sort((a, b) => Number(a.category !== "outer") - Number(b.category !== "outer"));
}

function optionsFrom(payload: Obj, catalog: Awaited<ReturnType<typeof fetchStandardOptionCatalog>>) {
  const detail = obj(payload.detail);
  const codes = Array.isArray(obj(detail.options).standard) ? (obj(detail.options).standard as unknown[]).map(String) : [];
  const selected = obj(detail.options).choice;
  return mapEncarOptions(catalog, codes, payload.choiceOptions, Array.isArray(selected) ? selected.map(String) : undefined);
}

async function main() {
  const optionCatalog = await fetchStandardOptionCatalog();
  if (!DB_URL) throw new Error("SUPABASE_DB_URL is required");
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 50) throw new Error("Batch size must be 1..50");
  const [powerText, planText, readinessText, publicationText, baselineText] = await Promise.all([
    readFile(POWER_PATH, "utf8"), readFile(PLAN_PATH, "utf8"), readFile(READINESS_PATH, "utf8"),
    readFile(MANIFEST_PATH, "utf8"), readFile(BASELINE_MANIFEST_PATH, "utf8"),
  ]);
  const power = JSON.parse(powerText) as { runId: string; entries: PowerEntry[]; unresolved: unknown[] };
  const plan = JSON.parse(planText) as { runId: string; candidates: Array<{ sourceListingId: string; configuration: Obj }> };
  const readiness = JSON.parse(readinessText) as {
    runId: string; rates: { asOf: string }; summary: { alreadyPublished: number; incrementalCandidates: number;
      readyForPublicationPreparation: number; blockedWithPower: number };
    results: Array<{ sourceListingId: string; ready: boolean; priceRub: number | null; blockers: string[] }>;
  };
  const frozen = JSON.parse(publicationText) as {
    runId: string; baselineExpected: number; expectedIncremental: number; totalAfterPublication: number;
    baselineManifestSha256: string; ratesAsOf: string; powerReportSha256: string; readinessReportSha256: string;
    entries: Array<{ sourceListingId: string; sourceKind: string; calculationPowerKw: number; fetchedAt: string; rawPayloadSha256: string }>;
  };
  const baseline = JSON.parse(baselineText) as { runId: string; expected: number; entries: Array<{ sourceListingId: string }> };
  const baselineIds = new Set(baseline.entries.map((entry) => entry.sourceListingId));
  const ids = readiness.results.map((row) => row.sourceListingId);
  const powerById = new Map(power.entries.map((entry) => [entry.sourceListingId, entry]));
  if (power.runId !== RUN_ID || plan.runId !== RUN_ID || readiness.runId !== RUN_ID || frozen.runId !== RUN_ID ||
      baseline.runId !== RUN_ID || baseline.expected !== 184 || baselineIds.size !== 184 ||
      power.entries.length !== 236 || power.unresolved.length !== 8 || frozen.baselineExpected !== 184 ||
      frozen.expectedIncremental !== 52 || frozen.totalAfterPublication !== 236 || frozen.entries.length !== 52 ||
      ids.length !== 52 || readiness.summary.alreadyPublished !== 184 || readiness.summary.incrementalCandidates !== 52 ||
      readiness.summary.readyForPublicationPreparation !== 52 || readiness.summary.blockedWithPower !== 0 ||
      readiness.results.some((row) => !row.ready || row.priceRub == null || row.blockers.length) ||
      sha256(baselineText) !== frozen.baselineManifestSha256 || sha256(powerText) !== frozen.powerReportSha256 ||
      sha256(readinessText) !== frozen.readinessReportSha256)
    throw new Error("Run membership, 184-entry frozen baseline, 52-entry readiness, or manifest hash changed");
  if (new Set(ids).size !== 52 || ids.some((id) => baselineIds.has(id)) ||
      ids.some((id) => !powerById.has(id)) || new Set(frozen.entries.map((entry) => entry.sourceListingId)).size !== 52)
    throw new Error("Duplicate, already-published, or missing ID in incremental frozen cohort");
  const frozenById = new Map(frozen.entries.map((entry) => [entry.sourceListingId, entry]));
  const candidateById = new Map(plan.candidates.map((candidate) => [candidate.sourceListingId, candidate]));
  const auditById = new Map(readiness.results.map((row) => [row.sourceListingId, row]));
  const publicationPowerEntries = ids.map((id) => powerById.get(id)!);

  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const stages = (await db.query<Stage>(`select q.source_listing_id,q.status queue_status,s.status staging_status,
        q.source_url,s.fetched_at,q.candidate_snapshot,s.raw_payload
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s
        on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [RUN_ID, ids])).rows;
    await db.query("rollback");
    if (stages.length !== 52) throw new Error(`Staging rows changed: ${stages.length}/52`);
    const stageById = new Map(stages.map((stage) => [stage.source_listing_id, stage]));
    const rates = await getCbrCalcRates();
    if (rates.asOf !== frozen.ratesAsOf || readiness.rates.asOf !== frozen.ratesAsOf)
      throw new Error(`Rate date changed (${rates.asOf} vs frozen ${frozen.ratesAsOf}); rerun readiness and prepare a new manifest`);

    const prepared: Prepared[] = [];
    for (const powerEntry of publicationPowerEntries) {
      const id = powerEntry.sourceListingId, stage = stageById.get(id), candidate = candidateById.get(id);
      const frozenEntry = frozenById.get(id), audit = auditById.get(id);
      if (!stage || !candidate || !frozenEntry || !audit) throw new Error(`Missing run-scoped inputs for ${id}`);
      if (frozenEntry.sourceKind !== powerEntry.sourceKind || frozenEntry.calculationPowerKw !== powerEntry.calculationPowerKw ||
          !stage.fetched_at || new Date(stage.fetched_at).toISOString() !== frozenEntry.fetchedAt || !stage.raw_payload ||
          sha256(JSON.stringify(stage.raw_payload)) !== frozenEntry.rawPayloadSha256)
        throw new Error(`Frozen source snapshot changed for ${id}`);
      if (stage.queue_status !== "succeeded" || stage.staging_status !== "succeeded" || !stage.source_url)
        throw new Error(`Enrichment snapshot is not complete for ${id}`);

      const configRow = candidate.configuration;
      const payload = obj(stage.raw_payload), detail = obj(payload.detail), ad = obj(detail.advertisement);
      const manage = obj(detail.manage), spec = obj(detail.spec), category = obj(detail.category);
      const year = positive(configRow.year), engineCc = positive(configRow.engineCc ?? spec.displacement);
      const priceUnits = positive(ad.price), priceKrw = priceUnits == null ? null : Math.round(priceUnits * 10_000);
      const registeredAt = str(manage.registDateTime);
      const month = resolveCalculationMonth({ registrationDate: registeredAt });
      const photos = photosFrom(payload), options = optionsFrom(payload, optionCatalog);
      if (ad.status !== "ADVERTISE" || manage.dummy === true || ad.salesStatus === "CONTRACT")
        throw new Error(`Saved Encar snapshot is not publishable for ${id}`);
      if (!year || !engineCc || !priceKrw || !photos.some((photo) => photo.category === "outer"))
        throw new Error(`Core fields/photo are missing for ${id}`);
      if (powerEntry.fuelType !== configRow.fuelType ||
          (powerEntry.fuelType === "hybrid" && (powerEntry.powerBasis !== "parallel_sum" ||
            powerEntry.enginePowerPs == null || powerEntry.electricMotorPowerPs == null || powerEntry.electricMotorPowerKw == null ||
            powerEntry.electric30MinPs != null ||
            Math.abs(powerEntry.customsPowerPs - (powerEntry.enginePowerPs + powerEntry.electricMotorPowerPs)) > 0.0002 ||
            Math.abs(powerEntry.calculationPowerKw - Number((powerEntry.enginePowerPs * KW_PER_PS + powerEntry.electricMotorPowerKw).toFixed(4))) > 0.0002)) ||
          (powerEntry.fuelType === "electric" && (powerEntry.powerBasis !== "electric_30min" || powerEntry.enginePowerPs != null ||
            powerEntry.electric30MinPs == null || powerEntry.electricMotorPowerKw != null ||
            Math.abs(powerEntry.calculationPowerKw - Number((powerEntry.electric30MinPs * KW_PER_PS).toFixed(4))) > 0.0002)))
        throw new Error(`Power basis/components failed validation for ${id}`);

      const hybridDvsPowerHp = powerEntry.fuelType === "hybrid" ? powerEntry.enginePowerPs : null;
      const hybridElectricPowerKw = powerEntry.fuelType === "hybrid"
        ? powerEntry.electricMotorPowerKw! : null;
      const hybridSequential = powerEntry.fuelType === "hybrid" ? false : null;
      const hybridDvsAbove = powerEntry.fuelType === "hybrid"
        ? Number(powerEntry.enginePowerPs) > Number(powerEntry.electricMotorPowerPs) : null;
      const calculation = calculateRuVladivostok({
        priceKrw, year, month: month.month, engineCc, fuelType: powerEntry.fuelType,
        powerKw: powerEntry.calculationPowerKw,
        ...(powerEntry.fuelType === "hybrid" ? {
          hybridDvsPowerHp: Number(hybridDvsPowerHp), hybridDvsPowerKw: Number((Number(hybridDvsPowerHp) * KW_PER_PS).toFixed(4)),
          hybridElectricPowerKw: Number(hybridElectricPowerKw), hybridDvsAboveElectric30Min: Boolean(hybridDvsAbove), hybridSequential: false,
        } : {}),
        destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
        ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails,
      });
      const priceRub = Math.round(calculation.totalRub);
      const gate = evaluatePublication({ priceRub, hasSnapshot: true, calculationPowerStatus: "matched",
        calculationPowerKw: powerEntry.calculationPowerKw, powerBasis: powerEntry.powerBasis,
        powerResolutionSource: `${powerEntry.sourceKind}:${powerEntry.sourceUrl}`, calculationMonth: month.month,
        fuelType: powerEntry.fuelType, hybridDvsPowerHp, powerConfidence: "automatic",
        calculationPowerSpecId: null, legacyCalculationStatus: null });
      if (!gate.ok || gate.finality !== "preliminary") throw new Error(`Publication gate/finality failed for ${id}`);
      if (audit.priceRub == null)
        throw new Error(`Reviewed TKS price is missing for ${id}`);

      const vehicleNo = normalizePlate(detail.vehicleNo) || null;
      const displayPower = powerEntry.fuelType === "electric"
        ? (positive(powerEntry.peakOrSystemPowerPs) ?? powerEntry.customsPowerPs)
        : powerEntry.customsPowerPs;
      const powerMeta = { sourceKind: powerEntry.sourceKind, sourceUrl: powerEntry.sourceUrl,
        note: powerEntry.sourceNote, basis: powerEntry.powerBasis, calculationPowerKw: powerEntry.calculationPowerKw,
        customsPowerPs: powerEntry.customsPowerPs, enginePowerPs: powerEntry.enginePowerPs,
        electric30MinPs: powerEntry.electric30MinPs, peakOrSystemPowerPs: powerEntry.peakOrSystemPowerPs,
        runId: RUN_ID, preliminary: true };
      const car: Obj = {
        primary_source: "encar", source_kind: "encar", source_id: id, source_url: stage.source_url,
        enrichment_status: "source_only", encar_enrichment_status: "applied", is_available: true, sale_status: null,
        published_at: str(manage.firstAdvertisedDateTime), published_at_source: str(manage.firstAdvertisedDateTime) ? "source_payload" : "unknown",
        catalog_added_at: new Date().toISOString(), source_updated_at: str(manage.modifyDateTime), last_seen_at: new Date().toISOString(),
        brand: powerEntry.brand, model: powerEntry.model, generation: str(configRow.generation),
        grade: str(category.gradeEnglishName), trim: str(category.gradeDetailEnglishName),
        badge: str(configRow.badge), badge_detail: str(configRow.trim), year, registration_year: year,
        registration_month: month.month, registration_date: null,
        mileage_km: positive(spec.mileage), price_krw: priceKrw, price_rub: priceRub,
        // cars.power_hp is an integer column; preserve precise calculation power in kW/evidence.
        engine_cc: engineCc, power_hp: Math.round(displayPower), power_source: powerEntry.sourceKind,
        power_confidence: "automatic", power_finality: storedPowerFinality({ powerConfidence: "automatic",
          calculationPowerKw: powerEntry.calculationPowerKw, powerResolutionSource: `${powerEntry.sourceKind}:${powerEntry.sourceUrl}` }),
        power_resolution_note: `Preliminary run-scoped ${powerEntry.powerBasis} evidence from ${powerEntry.sourceKind}; ${powerEntry.sourceUrl}`,
        fuel_type: powerEntry.fuelType, transmission: str(spec.transmissionName), drive_type: str(configRow.driveType),
        color: normalizeColor(str(spec.colorName)), body_type: str(spec.bodyName),
        vehicle_no_masked: vehicleNo, vin_masked: str(detail.vin), media_count: photos.length,
        vehicle_specs: { source: "encar", enrichment_run_id: RUN_ID, power_confidence: "automatic",
          power_basis: powerEntry.powerBasis, electrified_power_evidence: powerMeta,
          seats: positive(spec.seatCount), encar_full_gallery_count: photos.length,
          encar_options_count: options.length },
        calculation_power_status: "matched", calculation_power_spec_id: null, calculation_power_spec_version: null,
        calculation_power_kw: Number(powerEntry.calculationPowerKw.toFixed(4)), power_basis: powerEntry.powerBasis,
        power_resolution_source: `${powerEntry.sourceKind}:${powerEntry.sourceUrl}`,
        calculation_month: month.month, calculation_month_source: month.source,
        hybrid_dvs_power_hp: hybridDvsPowerHp, hybrid_electric_power_kw: hybridElectricPowerKw,
        hybrid_dvs_above_electric_30min: hybridDvsAbove, hybrid_sequential: hybridSequential,
      };
      prepared.push({ id, stage, car, calculation, reviewedPriceRub: audit.priceRub, photos, options });
    }

    const idsWithPlate = prepared.flatMap((item) => item.car.vehicle_no_masked ?
      [{ id: item.id, hash: vehicleHash(String(item.car.vehicle_no_masked)) }] : []);
    if (new Set(idsWithPlate.map((item) => item.hash)).size !== idsWithPlate.length)
      throw new Error("Duplicate vehicle number inside the frozen cohort");
    const hashes = idsWithPlate.map((item) => item.hash);
    if (hashes.length) {
      const duplicates = await db.query<{ source_id: string; primary_source: string }>(
        `select source_id,primary_source from public.cars where is_available=true and vehicle_no_hash=any($1::text[])`, [hashes]);
      const targetSet = new Set(ids);
      for (const duplicate of duplicates.rows) {
        if (!targetSet.has(duplicate.source_id)) throw new Error(`Active vehicle-number duplicate outside cohort: ${duplicate.primary_source}:${duplicate.source_id}`);
      }
    }
    const existing = await db.query<{ source_id: string; run_id: string | null; snapshots: number; media: number; calculations: number }>(`
      select c.source_id,c.vehicle_specs->>'enrichment_run_id' run_id,
        (select count(*)::int from public.source_snapshots s where s.source='encar' and s.source_id=c.source_id) snapshots,
        (select count(*)::int from public.car_media m where m.car_id=c.id) media,
        (select count(*)::int from public.calc_snapshots x where x.car_id=c.id) calculations
      from public.cars c where c.primary_source='encar' and c.source_id=any($1::text[])`, [ids]);
    const already = new Set<string>();
    for (const row of existing.rows) {
      if (row.run_id !== RUN_ID || row.snapshots < 1 || row.media < 1 || row.calculations < 1)
        throw new Error(`Existing listing is incomplete or belongs to a different publication: ${row.source_id}`);
      already.add(row.source_id);
    }
    const pending = prepared.filter((item) => !already.has(item.id));
    const summary = {
      dryRun: !WRITE, probe: PROBE, runId: RUN_ID, expectedAllowlist: 52, priorPublishedBaseline: 184,
      selected: prepared.length, alreadyPublished: already.size, toInsert: pending.length,
      hybrid: prepared.filter((item) => item.car.fuel_type === "hybrid").length,
      electric: prepared.filter((item) => item.car.fuel_type === "electric").length,
      preliminaryPrices: prepared.filter((item) => item.car.power_finality === "provisional").length,
      sourcePhotos: prepared.reduce((sum, item) => sum + item.photos.length, 0),
      optionRows: prepared.reduce((sum, item) => sum + item.options.length, 0),
      priceRubTotal: prepared.reduce((sum, item) => sum + Number(item.car.price_rub), 0),
      pricesDifferentFromPriorRateSnapshot: prepared.filter((item) => Number(item.car.price_rub) !== item.reviewedPriceRub).length,
      totalDeltaFromPriorRateSnapshotRub: prepared.reduce((sum, item) => sum + Number(item.car.price_rub) - item.reviewedPriceRub, 0),
      maxAbsoluteDeltaFromPriorRateSnapshotRub: Math.max(0, ...prepared.map((item) =>
        Math.abs(Number(item.car.price_rub) - item.reviewedPriceRub))),
      ratesAsOf: rates.asOf, tksVersion: prepared[0]?.calculation.calcVersion,
      encarRequests: 0, databaseWrites: 0,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!WRITE) return;
    if (!pending.length) {
      await writeFile(REPORT_PATH, `${JSON.stringify({ ...summary, completed: true, newlyPublished: 0 }, null, 2)}\n`);
      return;
    }

    let newlyPublished = 0;
    const selected = PROBE ? pending.slice(0, 1) : pending;
    for (let offset = 0; offset < selected.length; offset += BATCH_SIZE) {
      const batch = selected.slice(offset, offset + BATCH_SIZE);
      await db.query("begin");
      try {
        await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-electrified-publication-21a687ee'))");
        const batchIds = batch.map((item) => item.id);
        const raced = await db.query<{ source_id: string }>(
          `select source_id from public.cars where primary_source='encar' and source_id=any($1::text[]) for update`, [batchIds]);
        if (raced.rows.length) throw new Error(`Rows appeared during publication: ${raced.rows.map((row) => row.source_id).join(",")}`);
        for (const item of batch) {
          const carValues = Object.values(item.car).map((value) => value && typeof value === "object" ? JSON.stringify(value) : value);
          const columns = Object.keys(item.car);
          const inserted = await db.query<{ id: string }>(
            `insert into public.cars(${columns.join(",")}) values (${columns.map((_, index) => `$${index + 1}`).join(",")}) returning id`, carValues);
          const carId = inserted.rows[0]?.id;
          if (!carId) throw new Error(`Car insert did not return id: ${item.id}`);
          await db.query(`insert into public.source_snapshots(source,source_id,source_url,payload,fetched_at,parser_version,status)
            values ('encar',$1,$2,$3,$4,'encar-electrified-21a687ee-v1','ok')`,
          [item.id, item.stage.source_url, JSON.stringify(item.stage.raw_payload), item.stage.fetched_at]);
          await db.query(`insert into public.car_media(car_id,source,media_type,category,url,thumbnail_url,sort_order,is_primary,legal_mode)
            select $1,'encar','image',p.category,p.url,p.url,p.sort_order,p.is_primary,'external_url'
            from jsonb_to_recordset($2::jsonb) as p(category text,url text,sort_order integer,is_primary boolean)`,
          [carId, JSON.stringify(item.photos.map((photo, index) => ({ ...photo, sort_order: index, is_primary: index === 0 })))]);
          if (item.options.length) await db.query(`insert into public.car_options(car_id,source,category,source_code,name_original,name_ru,value_original,value_ru,price_krw,description_original,description_ru,is_present,sort_order)
            select $1,'encar',o.category,o.source_code,o.name_original,o.name_ru,o.value_original,o.value_ru,o.price_krw,o.description_original,o.description_ru,true,o.sort_order
            from jsonb_to_recordset($2::jsonb) as o(category text,source_code text,name_original text,name_ru text,value_original text,value_ru text,price_krw bigint,description_original text,description_ru text,sort_order integer)`,
          [carId, JSON.stringify(item.options.map((option, index) => ({ ...option, sort_order: 1000 + index })))]);
          await db.query(`insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,
              car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
            values ($1,'RU','Владивосток','individual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [carId, item.calculation.calcVersion, JSON.stringify({ ...item.car, runId: RUN_ID }),
            JSON.stringify({ ...item.calculation.rates, customsRates: item.calculation.customsRates,
              rateDetails: item.calculation.rateDetails, asOf: item.calculation.ratesAsOf, source: item.calculation.ratesSource }),
            JSON.stringify(item.calculation), Math.round(item.calculation.carPriceRub), Math.round(item.calculation.dutyRub),
            Math.round(item.calculation.feesRub), Math.round(item.calculation.utilRub), Math.round(item.calculation.freightRub),
            Math.round(item.calculation.brokerRub), Math.round(item.calculation.totalRub)]);
          newlyPublished++;
        }
        const verify = await db.query<{ cars: number; snapshots: number; media: number; calculations: number }>(`
          select (select count(*)::int from public.cars where primary_source='encar' and source_id=any($1::text[]) and is_available) cars,
            (select count(distinct s.source_id)::int from public.source_snapshots s where s.source='encar' and s.source_id=any($1::text[])) snapshots,
            (select count(distinct m.car_id)::int from public.car_media m join public.cars c on c.id=m.car_id
              where c.primary_source='encar' and c.source_id=any($1::text[])) media,
            (select count(distinct x.car_id)::int from public.calc_snapshots x join public.cars c on c.id=x.car_id
              where c.primary_source='encar' and c.source_id=any($1::text[])) calculations`, [batchIds]);
        const result = verify.rows[0];
        if (result.cars !== batch.length || result.snapshots !== batch.length || result.media !== batch.length || result.calculations !== batch.length)
          throw new Error(`Transaction verification failed: ${JSON.stringify(result)}`);
        if (PROBE) {
          await db.query("rollback");
          newlyPublished = 0;
          console.log(JSON.stringify({ probeRolledBack: true, checked: batch.length, writesPersisted: 0 }));
          break;
        }
        await db.query("commit");
        console.log(JSON.stringify({ event: "batch_committed", completed: Math.min(offset + batch.length, selected.length), total: selected.length }));
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    const finalReport = { ...summary, dryRun: false, probe: PROBE, completed: !PROBE,
      newlyPublished, databaseWrites: newlyPublished, output: REPORT_PATH };
    await writeFile(REPORT_PATH, `${JSON.stringify(finalReport, null, 2)}\n`);
    console.log(JSON.stringify(finalReport, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
