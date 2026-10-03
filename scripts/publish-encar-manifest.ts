import { persistCatalogNamingPg } from "../src/server/catalog/persist-catalog-naming";
import { catalogDriveType, normalizeTransmissionType } from "../src/server/normalization/drivetrain";
/** Publish an audited Encar allowlist in recoverable transactions. */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import type { CalcRateSnapshot } from "../src/server/calc/rates";
import { evaluatePublication, powerBasisForFuel, resolveCalculationMonth, storedPowerFinality } from "../src/server/cars/calculation-contract";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";
import { normalizeColor, normalizePlate } from "../src/server/normalization/vehicles";
import { translateInspectionLabel, translateInspectionStatus } from "../src/server/normalization/display";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import { mapEncarOptions } from "../src/server/imports/encar-options";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.TL_AUTO_PUBLICATION_MANIFEST ?? "output/tl-auto-encar-publication-manifest.json";
const planPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const preliminaryPath = process.env.TL_AUTO_PRELIMINARY_CALCULATION ?? "output/tl-auto-new-encar-preliminary-calculation-dry-run.json";
const readinessPath = process.env.TL_AUTO_PUBLICATION_READINESS ?? "output/tl-auto-new-encar-publication-readiness.json";
const prepare = process.env.TL_AUTO_PUBLICATION_PREPARE === "true";
const write = process.env.TL_AUTO_PUBLICATION_WRITE === "true";
const probe = process.env.TL_AUTO_PUBLICATION_PROBE === "true";
const batchSize = Number(process.env.TL_AUTO_PUBLICATION_BATCH_SIZE ?? 100);
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Obj = Record<string, unknown>;
type PlanRow = { sourceListingId: string; status: string; configuration: Obj; power?: Obj };
type Plan = { runId: string; candidates: PlanRow[] };
type Stage = { source_listing_id: string; source_url: string | null; queue_status: string; staging_status: string; fetched_at: string | null; raw_payload: Obj | null };
type Spec = { id: string; version: number; status: string; calculation_power_kw: string; power_basis: string; evidence_id: string };
type Manifest = { runId: string; expected: number; reportHash: string; planHash: string; preliminaryHash: string;
  entries: Array<{ id: string; powerClass: "approved" | "preliminary"; fetchedAt: string; payloadHash: string }> };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };
const imageUrl = (path: string) => path.startsWith("http") ? path : `https://ci.encar.com${path}`;
const KW_PER_HP = 0.73549875;
const vehicleNoHash = (value: string) => createHash("sha256")
  .update(value.toUpperCase().replace(/[^0-9A-Z가-힣]/g, ""))
  .digest("hex");

function automaticInput(c: PlanRow) {
  const x = c.configuration;
  return {
    brand: str(x.brand) ?? "", model: str(x.model) ?? "", fuel_type: str(x.fuelType) ?? "",
    engine_cc: positive(x.engineCc), drive_type: str(x.driveType), badge: str(x.badge),
    badge_detail: str(x.trim), year: positive(x.year), source_listing_id: c.sourceListingId,
  };
}

function gallery(payload: Obj) {
  const photos = obj(payload.detail).photos;
  if (!Array.isArray(photos)) return [];
  const unique = new Map<string, { url: string; category: string }>();
  for (const raw of photos) {
    const photo = obj(raw);
    const path = str(photo.path);
    if (!path) continue;
    const url = imageUrl(path);
    const type = String(photo.type ?? "").toLowerCase();
    const category = ["outer", "inner", "option", "thumbnail"].includes(type) ? type : "photo";
    const existing = unique.get(url);
    if (!existing) unique.set(url, { url, category });
    else if (category === "outer") existing.category = "outer";
  }
  return [...unique.values()].sort((a, b) => Number(a.category !== "outer") - Number(b.category !== "outer"));
}

function choiceOptions(payload: Obj, catalog: Awaited<ReturnType<typeof fetchStandardOptionCatalog>>) {
  const detail = obj(payload.detail);
  const codes = Array.isArray(obj(detail.options).standard) ? (obj(detail.options).standard as unknown[]).map(String) : [];
  const selected = obj(detail.options).choice;
  return mapEncarOptions(catalog, codes, payload.choiceOptions, Array.isArray(selected) ? selected.map(String) : undefined);
}

function inspectionReport(payload: Obj) {
  const inspection = obj(payload.inspection);
  if (!Object.keys(inspection).length) return null;
  const summary = obj(payload.inspectionSummary);
  const master = obj(inspection.master);
  const detail = obj(master.detail);
  const formats = Array.isArray(inspection.formats) ? inspection.formats : [];
  const items = Array.isArray(inspection.inners) ? inspection.inners.map((node) => {
    const item = obj(node), type = obj(item.type), status = obj(item.statusType);
    return { code: str(type.code), label_original: str(type.title), label_ru: translateInspectionLabel(str(type.title)),
      status_code: str(status.code), status_original: str(status.title), status_ru: translateInspectionStatus(str(status.title)),
      description_original: str(item.description), price: num(item.price), children: Array.isArray(item.children) ? item.children : [] };
  }) : [];
  return { summary: { formats, has_structured_report: formats.includes("TABLE"), inspection_date: str(master.registrationDate),
    supply_number: str(master.supplyNum), accident: master.accdient ?? null, simple_repair: master.simpleRepair ?? null,
    inspector_name: str(summary.inspName) ?? str(detail.inspName), body_findings_count: Array.isArray(inspection.outers) ? inspection.outers.length : 0,
    body_findings: Array.isArray(summary.outerSummarys) ? summary.outerSummarys : [] }, items, raw_payload: { inspection, summary } };
}

async function main() {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Batch size must be between 1 and 100");
  const [planText, preliminaryText, reportText] = await Promise.all([
    readFile(planPath, "utf8"), readFile(preliminaryPath, "utf8"), readFile(readinessPath, "utf8"),
  ]);
  const plan = JSON.parse(planText) as Plan;
  const preliminary = JSON.parse(preliminaryText) as { runId: string; calculations: Array<{ sourceListingId: string; preliminaryPowerHp: number }> };
const report = JSON.parse(reportText) as { runId: string; rateSnapshot: CalcRateSnapshot; summary: { target: number; ready: number; blocked: number }; cars: Array<{ sourceListingId: string; powerClass: "approved" | "preliminary"; ready: boolean }> };
  if (!plan.runId || plan.runId !== preliminary.runId || plan.runId !== report.runId ||
      report.summary.target !== report.summary.ready || report.summary.blocked !== 0 ||
      report.cars.length !== report.summary.target || report.cars.some((car) => !car.ready)) {
    throw new Error("Readiness reports do not describe one fully ready run");
  }
  const approvedById = new Map(plan.candidates.filter((row) => row.status === "approved_match").map((row) => [row.sourceListingId, row]));
  const preliminaryIds = new Set(preliminary.calculations.map((row) => row.sourceListingId));
  const planById = new Map(plan.candidates.map((row) => [row.sourceListingId, row]));
  const reportIds = new Set(report.cars.map((car) => car.sourceListingId));
  if (reportIds.size !== report.cars.length || preliminaryIds.size !== preliminary.calculations.length ||
      report.cars.some((car) => car.powerClass === "approved" ? !approvedById.has(car.sourceListingId) :
        !preliminaryIds.has(car.sourceListingId) || !planById.has(car.sourceListingId))) {
    throw new Error("Readiness allowlist contains duplicates or lacks power evidence");
  }
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const ids = report.cars.map((car) => car.sourceListingId);
    const stageRows = (await db.query<Stage>(`select q.source_listing_id,q.source_url,q.status queue_status,s.status staging_status,s.fetched_at,s.raw_payload
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [plan.runId, ids])).rows;
    const stages = new Map(stageRows.map((row) => [row.source_listing_id, row]));
    if (stageRows.length !== ids.length) throw new Error(`Staging missing: ${stageRows.length}/${ids.length}`);
    const manifest: Manifest = {
      runId: plan.runId, expected: ids.length,
      reportHash: hash(reportText), planHash: hash(planText), preliminaryHash: hash(preliminaryText),
      entries: report.cars.map((car) => {
        const row = stages.get(car.sourceListingId);
        if (!row?.raw_payload || !row.fetched_at || row.queue_status !== "succeeded" || row.staging_status !== "succeeded")
          throw new Error(`Staging is incomplete for ${car.sourceListingId}`);
        return { id: car.sourceListingId, powerClass: car.powerClass, fetchedAt: row.fetched_at,
          payloadHash: hash(JSON.stringify(row.raw_payload)) };
      }),
    };
    if (prepare) {
      // A manifest is immutable once prepared; rerunning preparation must not
      // silently replace the allowlist used by an in-progress publication.
      try {
        const previous = await readFile(manifestPath, "utf8");
        if (previous !== `${JSON.stringify(manifest, null, 2)}\n`) throw new Error(`Existing manifest differs: ${manifestPath}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      }
      console.log(JSON.stringify({ prepared: true, runId: manifest.runId, expected: manifest.expected, manifestPath }));
      return;
    }
    const catalogPath = process.env.TL_AUTO_STANDARD_OPTION_CATALOG?.trim();
    const optionCatalog: Awaited<ReturnType<typeof fetchStandardOptionCatalog>> = catalogPath
      ? JSON.parse(await readFile(catalogPath, "utf8"))
      : await fetchStandardOptionCatalog();
    if (!Array.isArray(optionCatalog.options) || !optionCatalog.options.length)
      throw new Error("Standard option catalog is empty or invalid");
    const saved = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (JSON.stringify(saved) !== JSON.stringify(manifest)) throw new Error("Manifest or source reports changed after preparation");
    const refs = (await db.query<AutomaticPowerReferenceRow>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status
      from public.vehicle_power_automatic_reference where status='automatic'`)).rows;
    const prepared: Array<{ id: string; row: Stage; plan: PlanRow; class: "approved" | "preliminary"; reference: AutomaticPowerReferenceRow | null }> = [];
    for (const entry of saved.entries) {
      const id = entry.id;
      const row = stages.get(id)!;
      const detail = obj(obj(row.raw_payload).detail);
      if (obj(detail.manage).dummy === true || obj(detail.advertisement).salesStatus === "CONTRACT")
        throw new Error(`Source flags changed for ${id}`);
      const planned = planById.get(id)!;
      const reference = entry.powerClass === "preliminary" ? resolveAutomaticPowerReference(automaticInput(planned), refs) : null;
      if (entry.powerClass === "preliminary" && reference?.power_hp == null) throw new Error(`Preliminary power no longer resolves: ${id}`);
      prepared.push({ id, row, plan: planned, class: entry.powerClass, reference });
    }
    if (prepared.length !== saved.expected) throw new Error("Manifest cardinality changed");
    const existing = await db.query<{ source_id: string }>(`select source_id from public.cars where primary_source='encar' and source_id=any($1::text[])`, [ids]);
    const existingIds = new Set(existing.rows.map((row) => row.source_id));
    const rates = report.rateSnapshot;
    if (!rates?.asOf || !rates.rates || !rates.customsRates || !rates.rateDetails ||
        ![rates.rates.krwRub, rates.rates.usdRub, rates.rates.eurRub, rates.rates.kztRub,
          rates.customsRates.krwRub, rates.customsRates.eurRub].every((value) => Number.isFinite(Number(value))))
      throw new Error("Readiness report lacks the exact validated rate snapshot; rerun readiness and prepare a new manifest");
    const specIds = [...new Set(prepared.filter((p) => p.class === "approved").map((p) => str(obj(p.plan.power).specId)!))];
    const specs = new Map((await db.query<Spec>(`select id,version,status,calculation_power_kw,power_basis,evidence_id from public.vehicle_power_specs where id=any($1::uuid[])`, [specIds])).rows.map((row) => [row.id, row]));
    const planned: Array<{ item: typeof prepared[number]; car: Obj; calc: ReturnType<typeof calculateRuVladivostok>; photos: ReturnType<typeof gallery>; options: ReturnType<typeof choiceOptions>; inspection: ReturnType<typeof inspectionReport> }> = [];
    for (const item of prepared) {
      const { id, row, plan, reference } = item;
      const payload = obj(row.raw_payload), detail = obj(payload.detail), ad = obj(detail.advertisement), spec = obj(detail.spec), manage = obj(detail.manage), category = obj(detail.category);
      if (row.queue_status !== "succeeded" || row.staging_status !== "succeeded" || ad.status !== "ADVERTISE") throw new Error(`Source no longer staged as active: ${id}`);
      const c = plan.configuration;
      const year = positive(c.year), engineCc = positive(c.engineCc ?? spec.displacement), priceUnits = positive(ad.price);
      const fuel = str(c.fuelType), brand = str(c.brand), model = str(c.model);
      const photos = gallery(payload), options = choiceOptions(payload, optionCatalog), inspection = inspectionReport(payload);
      if (!year || !engineCc || !priceUnits || !fuel || !brand || !model || !row.source_url || !photos.some((p) => p.category === "outer"))
        throw new Error(`Core source data incomplete: ${id}`);
      const month = resolveCalculationMonth({ registrationDate: str(manage.registDateTime) });
      const plannedPower = obj(plan.power);
      const approvedSpec = item.class === "approved" ? specs.get(str(plannedPower.specId) ?? "") : null;
      if (item.class === "approved" && (!approvedSpec || approvedSpec.status !== "approved" || Math.abs(Number(approvedSpec.calculation_power_kw) - Number(plannedPower.calculationPowerKw)) > 0.0001))
        throw new Error(`Approved specification changed: ${id}`);
      const powerKw = item.class === "approved" ? positive(plannedPower.calculationPowerKw) : positive(reference?.power_kw) ?? (positive(reference?.power_hp) ?? 0) * KW_PER_HP;
      const powerHp = item.class === "approved" ? Math.round((powerKw ?? 0) / KW_PER_HP) : Math.round(Number(reference?.power_hp));
      const basis = item.class === "approved" ? str(plannedPower.powerBasis) : powerBasisForFuel(fuel);
      const evidenceTier = str(plannedPower.evidenceTier);
      const source = item.class === "approved" ? `tl_auto_approved_reference:${evidenceTier ?? "unknown"}` : str(reference?.source);
      if (!powerKw || !powerHp || !basis || !source) throw new Error(`Power not resolved: ${id}`);
      const powerConfidence = item.class === "approved" ? "high" : "automatic";
      // A claimed confidence cannot promote weak evidence: anything below T1/T2
      // stays provisional, which is how three T3 cards were published as final.
      const powerFinality = storedPowerFinality({ powerConfidence, calculationPowerKw: powerKw,
        powerResolutionSource: source, calculationPowerSpecId: approvedSpec?.id ?? null, evidenceTier });
      if (powerFinality == null) throw new Error(`Power finality not resolvable: ${id}`);
      const priceKrw = Math.round(priceUnits * 10_000);
      const calc = calculateRuVladivostok({ priceKrw, year, month: month.month, engineCc, fuelType: fuel,
        ...(item.class === "approved" ? { powerKw } : { powerHp }), destinationCity: "Владивосток",
        rates: rates.rates, customsRates: rates.customsRates, ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails });
      const priceRub = Math.round(calc.totalRub);
      const verdict = evaluatePublication({ priceRub, hasSnapshot: true, calculationPowerStatus: item.class === "approved" ? "approved" : "matched",
        calculationPowerKw: powerKw, powerBasis: basis, powerResolutionSource: source, calculationMonth: month.month,
        fuelType: fuel, hybridDvsPowerHp: null, powerConfidence,
        calculationPowerSpecId: approvedSpec?.id ?? null, legacyCalculationStatus: null });
      // The publication gate checks completeness. Stored finality additionally
      // downgrades T3 evidence to provisional even if confidence says "high".
      if (!verdict.ok) throw new Error(`Publication contract failed: ${id}: ${JSON.stringify(verdict)}`);
      const sourceDate = str(manage.firstAdvertisedDateTime);
      const vehicleNo = normalizePlate(detail.vehicleNo) || null;
      const car: Obj = { primary_source: "encar", source_kind: "encar", source_id: id, source_url: row.source_url,
        enrichment_status: "source_only", encar_enrichment_status: "applied", is_available: true,
        published_at: sourceDate, published_at_source: sourceDate ? "source_payload" : "unknown", catalog_added_at: new Date().toISOString(),
        source_updated_at: str(manage.modifyDateTime), last_seen_at: new Date().toISOString(),
        brand, model, year, registration_year: year, mileage_km: num(spec.mileage), price_krw: priceKrw, price_rub: priceRub,
        engine_cc: engineCc, power_hp: powerHp, power_source: source, power_confidence: powerConfidence, power_finality: powerFinality,
        power_resolution_note: item.class === "approved" ? `Approved TL Auto spec ${approvedSpec?.id}` : "Preliminary automatic reference; exact trim power to be confirmed",
        fuel_type: fuel, transmission: normalizeTransmissionType(spec.transmissionName), drive_type: catalogDriveType(c.driveType), color: normalizeColor(spec.colorName), body_type: str(spec.bodyName),
        grade: str(category.gradeEnglishName), trim: str(category.gradeDetailEnglishName), badge: str(c.badge), badge_detail: str(c.trim),
        vehicle_no_masked: vehicleNo, vin_masked: str(detail.vin), media_count: photos.length,
        vehicle_specs: { source: "encar", seats: num(spec.seatCount), power_confidence: powerConfidence,
          encar_options_count: Array.isArray(obj(detail.options).standard) ? (obj(detail.options).standard as unknown[]).length : 0,
          encar_standard_option_codes: obj(detail.options).standard ?? [], encar_full_gallery_count: photos.length,
          enrichment_run_id: saved.runId },
        calculation_power_status: item.class === "approved" ? "approved" : "matched",
        calculation_power_spec_id: approvedSpec?.id ?? null, calculation_power_spec_version: approvedSpec?.version ?? null,
        calculation_power_kw: Number(powerKw.toFixed(4)), power_basis: basis, power_resolution_source: source,
        calculation_month: month.month, calculation_month_source: month.source };
      planned.push({ item, car, calc, photos, options, inspection });
    }
    const vehicleNumbers = planned.map((p) => str(p.car.vehicle_no_masked)).filter((p): p is string => Boolean(p));
    const hashes = vehicleNumbers.map(vehicleNoHash);
    if (new Set(hashes).size !== hashes.length) throw new Error("Duplicate vehicle numbers within publication cohort");
    const existingHashes = await db.query<{ source_id: string; primary_source: string; vehicle_no_hash: string }>(
      `select source_id,primary_source,vehicle_no_hash from public.cars where vehicle_no_hash=any($1::text[]) and is_available=true`, [hashes]);
    for (const row of existingHashes.rows) {
      if (row.primary_source !== "encar" || !reportIds.has(row.source_id))
        throw new Error(`Active vehicle-number duplicate outside manifest: ${row.source_id}`);
    }
    if (planned.length !== saved.expected) throw new Error("Prepared row count changed");
    const publicationReport = { dryRun: !write, runId: saved.runId, selected: planned.length, alreadyPublished: existingIds.size,
      approved: planned.filter((p) => p.item.class === "approved").length,
      preliminary: planned.filter((p) => p.item.class === "preliminary").length,
      photos: planned.reduce((n, p) => n + p.photos.length, 0),
      choiceOptions: planned.reduce((n, p) => n + p.options.length, 0),
      inspectionReports: planned.filter((p) => p.inspection).length,
      priceRubSum: planned.reduce((n, p) => n + Number(p.car.price_rub), 0) };
    console.log(JSON.stringify(publicationReport));
    if (!write) return;
    let newlyPublished = 0;
    const selected = probe ? planned.slice(0, 1) : planned;
    for (let offset = 0; offset < selected.length; offset += batchSize) {
      const batch = selected.slice(offset, offset + batchSize);
      await db.query("begin");
      try {
        await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-new-encar-publication'))");
        const batchIds = batch.map((p) => p.item.id);
        const present = await db.query<{ source_id: string; id: string; run_id: string | null; snapshots: string; media: string; source_snapshots: string }>(`
          select c.source_id,c.id,c.vehicle_specs->>'enrichment_run_id' run_id,
            (select count(*)::text from public.calc_snapshots s where s.car_id=c.id) snapshots,
            (select count(*)::text from public.car_media m where m.car_id=c.id) media,
            (select count(*)::text from public.source_snapshots s where s.source='encar' and s.source_id=c.source_id) source_snapshots
          from public.cars c where c.primary_source='encar' and c.source_id=any($1::text[]) for update of c`, [batchIds]);
        const completed = new Set<string>();
        for (const car of present.rows) {
          if (car.run_id !== saved.runId || Number(car.snapshots) < 1 || Number(car.media) < 1 || Number(car.source_snapshots) < 1)
            throw new Error(`Existing Encar card is incomplete or belongs to another run: ${car.source_id}`);
          completed.add(car.source_id);
        }
        for (const p of batch) {
          if (completed.has(p.item.id)) continue;
      const columns = Object.keys(p.car);
      const values = Object.values(p.car).map((value) => value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value);
      const insert = await db.query<{ id: string }>(`insert into public.cars(${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")}) returning id`, values);
      const carId = insert.rows[0].id;
      await db.query(`insert into public.source_snapshots(source,source_id,source_url,payload,fetched_at,parser_version,status) values ('encar',$1,$2,$3,$4,'encar-staged-full-20260924','ok')`,
        [p.item.id, p.item.row.source_url, JSON.stringify(p.item.row.raw_payload), p.item.row.fetched_at]);
      await persistCatalogNamingPg(db,carId);
      await db.query(`insert into public.car_media(car_id,source,media_type,category,url,thumbnail_url,sort_order,is_primary,legal_mode)
        select $1,'encar','image',p.category,p.url,p.url,p.sort_order,p.is_primary,'external_url'
        from jsonb_to_recordset($2::jsonb) as p(category text,url text,sort_order integer,is_primary boolean)`,
        [carId, JSON.stringify(p.photos.map((photo, i) => ({ ...photo, sort_order: i, is_primary: i === 0 })))]);
      if (p.options.length) await db.query(`insert into public.car_options(car_id,source,category,source_code,name_original,name_ru,value_original,value_ru,price_krw,description_original,description_ru,is_present,sort_order)
        select $1,'encar',o.category,o.source_code,o.name_original,o.name_ru,o.value_original,o.value_ru,o.price_krw,o.description_original,o.description_ru,true,o.sort_order
        from jsonb_to_recordset($2::jsonb) as o(category text,source_code text,name_original text,name_ru text,value_original text,value_ru text,price_krw bigint,description_original text,description_ru text,sort_order integer)`,
        [carId, JSON.stringify(p.options.map((option, i) => ({ ...option, sort_order: 1000 + i })))]);
      if (p.inspection) await db.query(`insert into public.car_condition_reports(car_id,source,report_type,summary,items,raw_payload) values ($1,'encar','encar_inspection',$2,$3,$4)`,
        [carId, JSON.stringify(p.inspection.summary), JSON.stringify(p.inspection.items), JSON.stringify(p.inspection.raw_payload)]);
      await db.query(`insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
        values ($1,'RU','Владивосток','individual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [carId, p.calc.calcVersion, JSON.stringify(p.car), JSON.stringify({ ...p.calc.rates, details: p.calc.rateDetails }), JSON.stringify(p.calc),
          Math.round(p.calc.carPriceRub), Math.round(p.calc.dutyRub), Math.round(p.calc.feesRub), Math.round(p.calc.utilRub),
          Math.round(p.calc.freightRub), Math.round(p.calc.brokerRub), Math.round(p.calc.totalRub)]);
          newlyPublished++;
        }
        const verify = await db.query<{ cars: string; snapshots: string; media: string; source_snapshots: string }>(`select
      (select count(*) from public.cars where primary_source='encar' and source_id=any($1::text[]) and is_available=true)::text cars,
      (select count(distinct s.car_id) from public.calc_snapshots s join public.cars c on c.id=s.car_id where c.primary_source='encar' and c.source_id=any($1::text[]))::text snapshots,
      (select count(distinct m.car_id) from public.car_media m join public.cars c on c.id=m.car_id where c.primary_source='encar' and c.source_id=any($1::text[]))::text media,
      (select count(distinct s.source_id) from public.source_snapshots s where s.source='encar' and s.source_id=any($1::text[]))::text source_snapshots`, [batchIds]);
        const v = verify.rows[0];
        if (Number(v.cars) !== batch.length || Number(v.snapshots) !== batch.length || Number(v.media) !== batch.length || Number(v.source_snapshots) !== batch.length)
          throw new Error(`Batch verification failed: ${JSON.stringify(v)}`);
        if (probe) {
          await db.query("rollback");
          console.log(JSON.stringify({ probe: true, tested: batch.length, committed: false }));
          return;
        }
        await db.query("commit");
        console.log(JSON.stringify({ event: "batch_committed", completed: Math.min(offset + batch.length, selected.length), total: selected.length, newlyPublished }));
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    console.log(JSON.stringify({ completed: true, runId: saved.runId, expected: saved.expected, newlyPublished }));
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
