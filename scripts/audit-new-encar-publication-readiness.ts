/** Read-only readiness audit for the 305 approved + preliminary Encar cohort. */
import { Client } from "pg";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { evaluatePublication, resolveCalculationMonth } from "../src/server/cars/calculation-contract";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID;
const dbUrl = process.env.SUPABASE_DB_URL;
const powerPlanPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
const preliminaryPath = process.env.TL_AUTO_PRELIMINARY_CALCULATION ?? "output/tl-auto-new-encar-preliminary-calculation-dry-run.json";
if (!runId || !dbUrl) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID and SUPABASE_DB_URL are required");

type Json = Record<string, unknown>;
type PowerCandidate = { sourceListingId: string; status: string; configuration: Json; power?: Json };
type PreliminaryCandidate = { sourceListingId: string; preliminaryPowerHp: number; powerReferenceSource: string; estimatedTotalRub: number };
type StagingRow = { source_listing_id: string; source_url: string | null; queue_status: string; candidate_snapshot: Json | null; result: Json | null; staging_status: string; raw_payload: Json | null; fetched_at: string | null; existing_car_id: string | null };
type Ref = AutomaticPowerReferenceRow;

const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const positive = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const KW_PER_HP = 1 / 1.3596216173;

async function main() {
  const powerPlan = JSON.parse(await readFile(powerPlanPath, "utf8")) as { runId?: string; candidates?: PowerCandidate[] };
  const preliminary = JSON.parse(await readFile(preliminaryPath, "utf8")) as { runId?: string; calculations?: PreliminaryCandidate[] };
  if (powerPlan.runId !== runId || preliminary.runId !== runId) throw new Error("Input report runId mismatch");
  const approved = (powerPlan.candidates ?? []).filter((row) => row.status === "approved_match");
  const preliminaryRows = preliminary.calculations ?? [];
  const approvedById = new Map(approved.map((row) => [row.sourceListingId, row]));
  const preliminaryById = new Map(preliminaryRows.map((row) => [row.sourceListingId, row]));
  const ids = [...new Set([...approvedById.keys(), ...preliminaryById.keys()])];
  if (ids.length !== approved.length + preliminaryRows.length) throw new Error("Approved and preliminary cohorts overlap");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const [stagingResult, referencesResult] = await Promise.all([
      db.query<StagingRow>(`select q.source_listing_id,q.source_url,q.status queue_status,q.candidate_snapshot,q.result,
          s.status staging_status,s.raw_payload,s.fetched_at,c.id existing_car_id
        from public.encar_enrichment_queue q
        join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
        left join public.cars c on c.primary_source='encar' and c.source_id=q.source_listing_id
        where q.run_id=$1 and q.source_listing_id=any($2::text[])`, [runId, ids]),
      db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
          year_from,year_to,power_hp,power_kw,source,status
        from public.vehicle_power_automatic_reference where status='automatic'`),
    ]);
    const stagedById = new Map(stagingResult.rows.map((row) => [row.source_listing_id, row]));
    const refs = referencesResult.rows;
    const rates = await getCbrCalcRates();
    const cars: Array<Record<string, unknown>> = [];
    const enrichment = new Map<string, Record<string, number>>();
    const freshnessHours: number[] = [];

    for (const id of ids) {
      const row = stagedById.get(id);
      const issues: string[] = [];
      const plannedApproved = approvedById.get(id);
      const plannedPreliminary = preliminaryById.get(id);
      if (!row) {
        cars.push({ sourceListingId: id, powerClass: plannedApproved ? "approved" : "preliminary", ready: false, blockers: ["staging_row_missing"] });
        continue;
      }
      const payload = obj(row.raw_payload);
      const detail = obj(payload.detail);
      const spec = obj(detail.spec);
      const advertisement = obj(detail.advertisement);
      const config = plannedApproved?.configuration ?? (powerPlan.candidates ?? []).find((candidate) => candidate.sourceListingId === id)?.configuration ?? {};
      const snapshot = obj(row.candidate_snapshot);
      const priceUnits = positive(advertisement.price);
      const priceKrw = priceUnits == null ? null : Math.round(priceUnits * 10_000);
      const year = positive(config.year ?? snapshot.year);
      const engineCc = positive(config.engineCc ?? spec.displacement);
      const fuelType = String(config.fuelType ?? spec.fuelName ?? "").trim() || null;
      const mileage = spec.mileage;
      const photos = Array.isArray(detail.photos) ? detail.photos.map(obj) : [];
      const hasExterior = photos.some((photo) => /outer|thumbnail|exterior|외관/i.test(String(photo.type ?? photo.code ?? "")) && Boolean(photo.path));
      const registeredAt = typeof obj(detail.manage).registDateTime === "string" ? String(obj(detail.manage).registDateTime) : null;
      const month = resolveCalculationMonth({ registrationDate: registeredAt });

      if (row.queue_status !== "succeeded" || row.staging_status !== "succeeded") issues.push("enrichment_not_succeeded");
      if (!row.source_url) issues.push("source_url_missing");
      if (String(advertisement.status ?? advertisement.salesStatus ?? "") !== "ADVERTISE") issues.push("source_not_confirmed_active_in_saved_snapshot");
      if (priceKrw == null) issues.push("price_missing");
      if (year == null) issues.push("model_year_missing");
      if (mileage == null || !Number.isFinite(Number(mileage)) || Number(mileage) < 0) issues.push("mileage_missing_or_invalid");
      if (engineCc == null) issues.push("engine_displacement_missing");
      if (!fuelType) issues.push("fuel_type_missing");
      if (!photos.length) issues.push("gallery_missing");
      if (!hasExterior) issues.push("exterior_photo_missing");
      if (row.existing_car_id) issues.push("already_in_cars");

      const fetched = Date.parse(String(payload.fetchedAt ?? row.fetched_at ?? ""));
      const ageHours = Number.isFinite(fetched) ? Math.max(0, (Date.now() - fetched) / 3_600_000) : null;
      if (ageHours != null) freshnessHours.push(ageHours);

      const probes = obj(obj(row.result).probes);
      for (const [name, probeValue] of Object.entries(probes)) {
        const classification = String(obj(probeValue).classification ?? "unknown");
        const perStatus = enrichment.get(name) ?? {};
        perStatus[classification] = (perStatus[classification] ?? 0) + 1;
        enrichment.set(name, perStatus);
      }

      let confidence: string | null = null;
      let specId: string | null = null;
      let powerSource: string | null = null;
      let powerHp: number | null = null;
      let powerKw: number | null = null;
      let basis: string | null = null;
      if (plannedApproved) {
        const power = obj(plannedApproved.power);
        confidence = String(power.confidence ?? "high");
        specId = String(power.specId ?? "") || null;
        powerSource = `tl_auto_approved_reference:${String(power.evidenceTier ?? "unknown")}`;
        powerKw = positive(power.calculationPowerKw);
        powerHp = powerKw == null ? null : powerKw / KW_PER_HP;
        basis = typeof power.powerBasis === "string" ? power.powerBasis : null;
        if (!specId) issues.push("approved_spec_id_missing");
      } else if (plannedPreliminary) {
        const input = {
          brand: String(config.brand ?? ""), model: String(config.model ?? ""),
          fuel_type: fuelType ?? "", engine_cc: engineCc,
          drive_type: config.driveType == null ? null : String(config.driveType),
          badge: config.badge == null ? null : String(config.badge),
          badge_detail: config.trim == null ? null : String(config.trim),
          year,
        };
        const reference = resolveAutomaticPowerReference(input, refs);
        if (!reference || reference.power_hp == null) {
          issues.push("preliminary_power_reference_no_longer_resolves_uniquely");
        } else {
          confidence = "automatic";
          powerHp = Number(reference.power_hp);
          powerKw = positive(reference.power_kw) ?? powerHp * KW_PER_HP;
          powerSource = reference.source;
          basis = "combustion_engine";
        }
      }
      if (powerKw == null || powerHp == null || !powerSource) issues.push("power_contract_fields_missing");

      let calcRub: number | null = null;
      let contract: ReturnType<typeof evaluatePublication> | null = null;
      if (priceKrw != null && year != null && engineCc != null && fuelType && powerKw != null && powerHp != null && powerSource && basis) {
        try {
          const calculation = calculateRuVladivostok({
            priceKrw, year, month: month.month, engineCc, fuelType,
            ...(plannedApproved ? { powerKw } : { powerHp }),
            destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
            ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails,
          });
          calcRub = Math.round(calculation.totalRub);
          contract = evaluatePublication({
            priceRub: calcRub, hasSnapshot: true,
            calculationPowerStatus: plannedApproved ? "approved" : "matched",
            calculationPowerKw: powerKw, powerBasis: basis,
            powerResolutionSource: powerSource, calculationMonth: month.month,
            fuelType, hybridDvsPowerHp: null, powerConfidence: confidence,
            calculationPowerSpecId: specId, legacyCalculationStatus: null,
          });
          if (!contract.ok) issues.push(...contract.blockers.map((blocker) => `publication_gate:${blocker}`));
        } catch (error) {
          issues.push(`calculation_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        issues.push("calculation_input_incomplete");
      }

      if (ageHours == null) issues.push("source_snapshot_timestamp_missing");
      else if (ageHours > 48) issues.push("source_snapshot_older_than_48h_refresh_before_publish");
      cars.push({
        sourceListingId: id, powerClass: plannedApproved ? "approved" : "preliminary",
        powerConfidence: confidence, powerSource, powerHp: powerHp == null ? null : Number(powerHp.toFixed(1)),
        powerKw: powerKw == null ? null : Number(powerKw.toFixed(4)), estimatedTotalRub: calcRub,
        calculationMonth: month.month, calculationMonthSource: month.source,
        mileageKm: mileage == null ? null : Number(mileage), photoCount: photos.length,
        hasExteriorPhoto: hasExterior, snapshotAgeHours: ageHours == null ? null : Number(ageHours.toFixed(1)),
        finality: contract?.ok ? contract.finality : null,
        ready: issues.length === 0, blockers: [...new Set(issues)],
      });
    }

    const readyRows = cars.filter((row) => row.ready);
    const blockers: Record<string, number> = {};
    for (const row of cars) for (const blocker of row.blockers as string[]) blockers[blocker] = (blockers[blocker] ?? 0) + 1;
    const report = {
      generatedAt: new Date().toISOString(), runId, readOnly: true,
      databaseWrites: 0, encarRequests: 0, publicCatalogChanged: false,
      policy: "Pre-publication readiness only; approved power remains final, automatic references remain preliminary; no cars inserted or published",
      rateSnapshot: { asOf: rates.asOf, source: rates.source },
      summary: {
        target: ids.length, approvedPower: approved.length, preliminaryPower: preliminaryRows.length,
        ready: readyRows.length, blocked: cars.length - readyRows.length,
        readyApproved: readyRows.filter((row) => row.powerClass === "approved").length,
        readyPreliminary: readyRows.filter((row) => row.powerClass === "preliminary").length,
        estimatedTotalRub: cars.reduce((sum, row) => sum + Number(row.estimatedTotalRub ?? 0), 0),
        minSnapshotAgeHours: freshnessHours.length ? Number(Math.min(...freshnessHours).toFixed(1)) : null,
        maxSnapshotAgeHours: freshnessHours.length ? Number(Math.max(...freshnessHours).toFixed(1)) : null,
        calculationMonthSources: Object.fromEntries([...new Set(cars.map((row) => String(row.calculationMonthSource)))].map((source) => [source, cars.filter((row) => row.calculationMonthSource === source).length])),
      },
      blockers,
      optionalEnrichmentProbeStatuses: Object.fromEntries(enrichment),
      cars,
    };
    const output = "output/tl-auto-new-encar-publication-readiness.json";
    await mkdir("output", { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, cars: undefined, output }, null, 2));
    await db.query("rollback");
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
