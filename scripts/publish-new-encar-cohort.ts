/** Publish the explicitly reviewed new-Encar run from saved, enriched source data. */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, powerBasisForFuel, resolveCalculationMonth, storedPowerFinality } from "../src/server/cars/calculation-contract";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";
import { normalizeColor, normalizePlate } from "../src/server/normalization/vehicles";
import { categorizeOption, translateOption, translateInspectionLabel, translateInspectionStatus } from "../src/server/normalization/display";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const originalRunId = "f7e9cca4-33ca-4813-9152-b6d4f42045b9";
const refreshRunId = "517423db-ff15-4501-b91e-2ddc9921364a";
const unavailable = new Set("42630525 42640035 42677453 42683656 42686983 42725570 42743052 42743599 42750391 42752267 42769945 42775415 42779210 42785381".split(" "));
const expectedCandidates = 311;
const expectedNewCars = 302;
const write = process.env.TL_AUTO_NEW_ENCAR_PUBLISH === "true";
const probe = process.env.TL_AUTO_NEW_ENCAR_PUBLISH_PROBE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Obj = Record<string, unknown>;
type PlanRow = { sourceListingId: string; status: string; configuration: Obj; power?: Obj };
type Plan = { runId: string; candidates: PlanRow[] };
type Stage = { source_listing_id: string; source_url: string | null; queue_status: string; staging_status: string; fetched_at: string | null; raw_payload: Obj | null };
type Spec = { id: string; version: number; status: string; calculation_power_kw: string; power_basis: string; evidence_id: string };

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
    badge_detail: str(x.trim), year: positive(x.year),
  };
}

function gallery(payload: Obj) {
  const photos = obj(payload.detail).photos;
  if (!Array.isArray(photos)) return [];
  const unique = new Set<string>();
  return photos.flatMap((raw) => {
    const photo = obj(raw);
    const path = str(photo.path);
    if (!path) return [];
    const url = imageUrl(path);
    if (unique.has(url)) return [];
    unique.add(url);
    const type = String(photo.type ?? "").toLowerCase();
    return [{ url, category: ["outer", "inner", "option", "thumbnail"].includes(type) ? type : "photo" }];
  }).sort((a, b) => Number(a.category !== "outer") - Number(b.category !== "outer"));
}

function choiceOptions(payload: Obj) {
  const options = payload.choiceOptions;
  if (!Array.isArray(options)) return [];
  return options.flatMap((raw) => {
    const option = obj(raw);
    const name = str(option.optionName);
    if (!name) return [];
    const translated = translateOption(name);
    return [{ category: categorizeOption(name, translated), name_original: name, name_ru: translated,
      price_krw: num(option.price), is_present: true }];
  });
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

async function loadJson(path: string): Promise<Plan> {
  return JSON.parse(await readFile(path, "utf8")) as Plan;
}

async function main() {
  const original = await loadJson("output/tl-auto-new-encar-power-plan-original-500.json");
  const refreshed = await loadJson("output/tl-auto-new-encar-power-plan.json");
  if (original.runId !== originalRunId || refreshed.runId !== refreshRunId) throw new Error("Power plan run IDs do not match the approved cohort");
  const originalById = new Map(original.candidates.map((row) => [row.sourceListingId, row]));
  const refreshedById = new Map(refreshed.candidates.map((row) => [row.sourceListingId, row]));
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let committed = false;
  try {
    await db.query("begin");
    await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-new-encar-publication'))");
    const refs = (await db.query<AutomaticPowerReferenceRow>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status
      from public.vehicle_power_automatic_reference where status='automatic'`)).rows;
    const originalPower = new Map<string, "approved" | "preliminary">();
    for (const row of original.candidates) {
      if (row.status === "approved_match") originalPower.set(row.sourceListingId, "approved");
      else if (row.status === "unmatched" && resolveAutomaticPowerReference(automaticInput(row), refs)?.power_hp != null)
        originalPower.set(row.sourceListingId, "preliminary");
    }
    if (originalPower.size !== 491) throw new Error(`Expected 491 original power candidates, got ${originalPower.size}`);
    const base = (await db.query<Stage>(`select q.source_listing_id,q.source_url,q.status queue_status,s.status staging_status,s.fetched_at,s.raw_payload
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [originalRunId, [...originalPower.keys()]])).rows;
    const fresh = (await db.query<Stage>(`select q.source_listing_id,q.source_url,q.status queue_status,s.status staging_status,s.fetched_at,s.raw_payload
      from public.encar_enrichment_queue q join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
      where q.run_id=$1`, [refreshRunId])).rows;
    const stages = new Map([...base, ...fresh].map((row) => [row.source_listing_id, row]));
    if (base.length !== 491 || fresh.length !== 74) throw new Error(`Staging changed: base=${base.length} refresh=${fresh.length}`);
    const freshPreliminary = new Set<string>();
    const prepared: Array<{ id: string; row: Stage; plan: PlanRow; class: "approved" | "preliminary"; reference: AutomaticPowerReferenceRow | null }> = [];
    const exclusions = { dummy: 0, contract: 0, sourcePowerChanged: 0, unavailable: 0 };
    for (const [id, oldClass] of originalPower) {
      const row = stages.get(id);
      if (!row?.raw_payload) throw new Error(`Missing staged payload: ${id}`);
      const detail = obj(row.raw_payload.detail);
      if (obj(detail.manage).dummy === true) { exclusions.dummy++; continue; }
      if (obj(detail.advertisement).salesStatus === "CONTRACT") { exclusions.contract++; continue; }
      const newer = refreshedById.get(id);
      const plan = newer ?? originalById.get(id)!;
      const powerClass = newer ? newer.status === "approved_match" ? "approved" : "preliminary" : oldClass;
      const reference = powerClass === "preliminary" ? resolveAutomaticPowerReference(automaticInput(plan), refs) : null;
      if (powerClass === "preliminary" && reference?.power_hp == null) {
        if (!newer) throw new Error(`Original preliminary power no longer resolves: ${id}`);
        exclusions.sourcePowerChanged++;
        continue;
      }
      if (newer && powerClass === "preliminary") freshPreliminary.add(id);
      if (unavailable.has(id)) { exclusions.unavailable++; continue; }
      prepared.push({ id, row, plan, class: powerClass, reference });
    }
    if (prepared.length !== expectedCandidates || Object.values(exclusions).reduce((a, b) => a + b, 0) !== 180 || freshPreliminary.size < 1)
      throw new Error(`Cohort drift: prepared=${prepared.length}, exclusions=${JSON.stringify(exclusions)}`);
    const ids = prepared.map((item) => item.id);
    const existing = await db.query<{ source_id: string }>(`select source_id from public.cars where primary_source='encar' and source_id=any($1::text[])`, [ids]);
    if (existing.rows.length) throw new Error(`${existing.rows.length} selected cars already exist; publication requires an unchanged cohort`);
    const rates = await getCbrCalcRates();
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
      const photos = gallery(payload), options = choiceOptions(payload), inspection = inspectionReport(payload);
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
      if (!verdict.ok || verdict.finality !== (powerFinality === "final" ? "final" : "preliminary")) throw new Error(`Publication contract failed: ${id}: ${JSON.stringify(verdict)}`);
      const sourceDate = str(manage.firstAdvertisedDateTime);
      const vehicleNo = normalizePlate(detail.vehicleNo) || null;
      const car: Obj = { primary_source: "encar", source_kind: "encar", source_id: id, source_url: row.source_url,
        enrichment_status: "source_only", encar_enrichment_status: "applied", is_available: true,
        published_at: sourceDate, published_at_source: sourceDate ? "source_payload" : "unknown", catalog_added_at: new Date().toISOString(),
        source_updated_at: str(manage.modifyDateTime), last_seen_at: new Date().toISOString(),
        brand, model, year, registration_year: year, mileage_km: num(spec.mileage), price_krw: priceKrw, price_rub: priceRub,
        engine_cc: engineCc, power_hp: powerHp, power_source: source, power_confidence: powerConfidence, power_finality: powerFinality,
        power_resolution_note: item.class === "approved" ? `Approved TL Auto spec ${approvedSpec?.id}` : "Preliminary automatic reference; exact trim power to be confirmed",
        fuel_type: fuel, drive_type: str(c.driveType), color: normalizeColor(spec.colorName), body_type: str(spec.bodyName),
        grade: str(category.gradeEnglishName), trim: str(category.gradeDetailEnglishName), badge: str(c.badge), badge_detail: str(c.trim),
        vehicle_no_masked: vehicleNo, vin_masked: str(detail.vin), media_count: photos.length,
        vehicle_specs: { source: "encar", seats: num(spec.seatCount), power_confidence: powerConfidence,
          encar_options_count: Array.isArray(obj(detail.options).standard) ? (obj(detail.options).standard as unknown[]).length : 0,
          encar_standard_option_codes: obj(detail.options).standard ?? [], encar_full_gallery_count: photos.length,
          enrichment_run_id: refreshedById.has(id) ? refreshRunId : originalRunId },
        calculation_power_status: item.class === "approved" ? "approved" : "matched",
        calculation_power_spec_id: approvedSpec?.id ?? null, calculation_power_spec_version: approvedSpec?.version ?? null,
        calculation_power_kw: Number(powerKw.toFixed(4)), power_basis: basis, power_resolution_source: source,
        calculation_month: month.month, calculation_month_source: month.source };
      planned.push({ item, car, calc, photos, options, inspection });
    }
    const vehicleNumbers = planned.map((p) => str(p.car.vehicle_no_masked)).filter((p): p is string => Boolean(p));
    const hashes = vehicleNumbers.map(vehicleNoHash);
    if (new Set(hashes).size !== hashes.length) throw new Error("Duplicate vehicle numbers within publication cohort");
    const existingHashes = await db.query<{ vehicle_no_hash: string }>(`select distinct vehicle_no_hash from public.cars where vehicle_no_hash=any($1::text[]) and is_available=true`, [hashes]);
    const duplicateHashes = new Set(existingHashes.rows.map((row) => row.vehicle_no_hash));
    const toPublish = planned.filter((p) => !duplicateHashes.has(vehicleNoHash(String(p.car.vehicle_no_masked ?? ""))));
    if (planned.length !== expectedCandidates || toPublish.length !== expectedNewCars || duplicateHashes.size !== 9)
      throw new Error(`Existing-catalog overlap changed: candidates=${planned.length}, new=${toPublish.length}, overlapping plates=${duplicateHashes.size}`);
    const report = { dryRun: !write, runIds: [originalRunId, refreshRunId], selected: toPublish.length,
      alreadyInCatalogByPlate: duplicateHashes.size,
      approved: toPublish.filter((p) => p.item.class === "approved").length,
      preliminary: toPublish.filter((p) => p.item.class === "preliminary").length,
      excluded: exclusions, photos: toPublish.reduce((n, p) => n + p.photos.length, 0),
      choiceOptions: toPublish.reduce((n, p) => n + p.options.length, 0),
      inspectionReports: toPublish.filter((p) => p.inspection).length,
      priceRubSum: toPublish.reduce((n, p) => n + Number(p.car.price_rub), 0) };
    if (!write) { console.log(JSON.stringify(report, null, 2)); await db.query("rollback"); return; }
    const toInsert = probe ? toPublish.slice(0, 1) : toPublish;
    for (let index = 0; index < toInsert.length; index++) {
      const p = toInsert[index];
      const columns = Object.keys(p.car);
      const values = Object.values(p.car).map((value) => value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value);
      const insert = await db.query<{ id: string }>(`insert into public.cars(${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")}) returning id`, values);
      const carId = insert.rows[0].id;
      await db.query(`insert into public.source_snapshots(source,source_id,source_url,payload,fetched_at,parser_version,status) values ('encar',$1,$2,$3,$4,'encar-staged-full-20260924','ok')`,
        [p.item.id, p.item.row.source_url, JSON.stringify(p.item.row.raw_payload), p.item.row.fetched_at]);
      await db.query(`insert into public.car_media(car_id,source,media_type,category,url,thumbnail_url,sort_order,is_primary,legal_mode)
        select $1,'encar','image',p.category,p.url,p.url,p.sort_order,p.is_primary,'external_url'
        from jsonb_to_recordset($2::jsonb) as p(category text,url text,sort_order integer,is_primary boolean)`,
        [carId, JSON.stringify(p.photos.map((photo, i) => ({ ...photo, sort_order: i, is_primary: i === 0 })))]);
      if (p.options.length) await db.query(`insert into public.car_options(car_id,source,category,name_original,name_ru,price_krw,is_present,sort_order)
        select $1,'encar',o.category,o.name_original,o.name_ru,o.price_krw,true,o.sort_order
        from jsonb_to_recordset($2::jsonb) as o(category text,name_original text,name_ru text,price_krw bigint,sort_order integer)`,
        [carId, JSON.stringify(p.options.map((option, i) => ({ ...option, sort_order: 1000 + i })))]);
      if (p.inspection) await db.query(`insert into public.car_condition_reports(car_id,source,report_type,summary,items,raw_payload) values ($1,'encar','encar_inspection',$2,$3,$4)`,
        [carId, JSON.stringify(p.inspection.summary), JSON.stringify(p.inspection.items), JSON.stringify(p.inspection.raw_payload)]);
      await db.query(`insert into public.calc_snapshots(car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
        values ($1,'RU','Владивосток','individual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [carId, p.calc.calcVersion, JSON.stringify(p.car), JSON.stringify({ ...p.calc.rates, details: p.calc.rateDetails }), JSON.stringify(p.calc),
          Math.round(p.calc.carPriceRub), Math.round(p.calc.dutyRub), Math.round(p.calc.feesRub), Math.round(p.calc.utilRub),
          Math.round(p.calc.freightRub), Math.round(p.calc.brokerRub), Math.round(p.calc.totalRub)]);
      if ((index + 1) % 25 === 0) console.log(JSON.stringify({ event: "transaction_prepared", cars: index + 1, total: toInsert.length }));
    }
    if (probe) {
      await db.query("rollback");
      console.log(JSON.stringify({ probe: true, insertedInTransaction: toInsert.length, committed: false }));
      return;
    }
    const verify = await db.query<{ cars: string; snapshots: string; media: string }>(`select
      (select count(*) from public.cars where primary_source='encar' and source_id=any($1::text[]) and is_available=true)::text cars,
      (select count(distinct s.car_id) from public.calc_snapshots s join public.cars c on c.id=s.car_id where c.primary_source='encar' and c.source_id=any($1::text[]))::text snapshots,
      (select count(distinct m.car_id) from public.car_media m join public.cars c on c.id=m.car_id where c.primary_source='encar' and c.source_id=any($1::text[]))::text media`, [ids]);
    const v = verify.rows[0];
    if (Number(v.cars) !== expectedNewCars || Number(v.snapshots) !== expectedNewCars || Number(v.media) !== expectedNewCars) throw new Error(`Pre-commit verification failed: ${JSON.stringify(v)}`);
    await db.query("commit");
    committed = true;
    console.log(JSON.stringify({ ...report, committed, verified: v }, null, 2));
  } catch (error) {
    if (!committed) await db.query("rollback").catch(() => undefined);
    throw error;
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
