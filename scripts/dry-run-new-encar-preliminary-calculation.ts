/**
 * Read-only calculation preview for new Encar listings with a preliminary
 * automatic-power reference. Does not insert cars, snapshots, or prices.
 */
import { Client } from "pg";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";
import { resolveCalculationMonth } from "../src/server/cars/calculation-contract";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID;
const dbUrl = process.env.SUPABASE_DB_URL;
const planPath = process.env.TL_AUTO_POWER_PLAN ?? "output/tl-auto-new-encar-power-plan.json";
if (!runId) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID is required");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Json = Record<string, unknown>;
type PlanCandidate = { sourceListingId: string; status: string; configuration: Json };
type StagingRow = { source_listing_id: string; candidate_snapshot: Json | null; raw_payload: Json | null };
type ReferenceRow = AutomaticPowerReferenceRow;

const obj = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const positive = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function main() {
  const plan = JSON.parse(await readFile(planPath, "utf8")) as { runId?: string; candidates?: PlanCandidate[] };
  if (plan.runId !== runId) throw new Error(`Power plan runId mismatch: expected ${runId}, got ${plan.runId ?? "missing"}`);
  const targets = (plan.candidates ?? []).filter((candidate) => candidate.status === "unmatched");
  const ids = [...new Set(targets.map((candidate) => candidate.sourceListingId))];
  if (!ids.length) throw new Error("No unmatched candidates found in the power plan");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const [refsResult, stagingResult] = await Promise.all([
      db.query<ReferenceRow>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
          year_from,year_to,power_hp,power_kw,source,status
        from public.vehicle_power_automatic_reference where status = 'automatic'`),
      db.query<StagingRow>(`select q.source_listing_id,q.candidate_snapshot,s.raw_payload
        from public.encar_enrichment_queue q
        join public.encar_enrichment_staging s on s.run_id=q.run_id and s.source_listing_id=q.source_listing_id
        where q.run_id=$1 and q.status='succeeded' and q.source_listing_id = any($2::text[])
        order by q.source_listing_id`, [runId, ids]),
    ]);
    const stagingById = new Map(stagingResult.rows.map((row) => [row.source_listing_id, row]));
    const rates = await getCbrCalcRates();
    const calculations: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const candidate of targets) {
      const config = candidate.configuration;
      const input = {
        brand: String(config.brand ?? ""), model: String(config.model ?? ""),
        fuel_type: String(config.fuelType ?? ""), engine_cc: positive(config.engineCc),
        drive_type: config.driveType == null ? null : String(config.driveType),
        badge: config.badge == null ? null : String(config.badge),
        badge_detail: config.trim == null ? null : String(config.trim),
        year: positive(config.year),
      };
      const reference = resolveAutomaticPowerReference(input, refsResult.rows);
      if (!reference) {
        skipped.push({ sourceListingId: candidate.sourceListingId, reason: "no_unique_preliminary_power_reference" });
        continue;
      }
      const staging = stagingById.get(candidate.sourceListingId);
      if (!staging) {
        skipped.push({ sourceListingId: candidate.sourceListingId, reason: "succeeded_staging_row_missing" });
        continue;
      }
      const payload = obj(staging.raw_payload);
      const detail = obj(payload.detail);
      const advertisement = obj(detail.advertisement);
      const priceUnits = positive(advertisement.price);
      const priceKrw = priceUnits == null ? null : Math.round(priceUnits * 10_000);
      if (priceKrw == null) {
        skipped.push({ sourceListingId: candidate.sourceListingId, reason: "encar_advertisement_price_missing_or_invalid" });
        continue;
      }
      const manage = obj(detail.manage);
      const month = resolveCalculationMonth({ registrationDate: typeof manage.registDateTime === "string" ? manage.registDateTime : null });
      const year = positive(config.year);
      const engineCc = positive(config.engineCc);
      if (!year || !engineCc || reference.power_hp == null) {
        skipped.push({ sourceListingId: candidate.sourceListingId, reason: "required_calculation_input_missing" });
        continue;
      }
      const calc = calculateRuVladivostok({
        priceKrw, year, month: month.month, engineCc, powerHp: Number(reference.power_hp),
        fuelType: typeof config.fuelType === "string" ? config.fuelType : undefined,
        destinationCity: "Владивосток", rates: rates.rates, customsRates: rates.customsRates,
        ratesAsOf: rates.asOf, ratesSource: rates.source, rateDetails: rates.rateDetails,
      });
      calculations.push({
        sourceListingId: candidate.sourceListingId,
        brand: input.brand, model: input.model, year,
        listingPriceKrw: priceKrw,
        preliminaryPowerHp: Number(reference.power_hp),
        powerReferenceSource: reference.source,
        calculationMonth: month.month,
        calculationMonthSource: month.source,
        estimatedTotalRub: Math.round(calc.totalRub),
        breakdownRub: {
          carPrice: calc.carPriceRub, customsDuty: calc.dutyRub, excise: calc.exciseRub,
          vat: calc.vatRub, customsFees: calc.feesRub, utilization: calc.utilRub,
          KoreaExpenses: calc.koreaExpensesRub, broker: calc.brokerRub,
          delivery: calc.deliveryRub, service: calc.serviceFeeRub,
        },
        confidence: "preliminary",
      });
    }

    const report = {
      generatedAt: new Date().toISOString(), runId, readOnly: true,
      encarRequests: 0, databaseWrites: 0, publicCatalogChanged: false,
      policy: "Only plan-unmatched listings with a unique status=automatic reference; preliminary estimates only; no publication",
      input: { originalUnmatched: targets.length, stagingRowsFound: stagingById.size, activePowerReferences: refsResult.rowCount ?? 0 },
      rates: { asOf: rates.asOf, source: rates.source },
      counts: {
        calculated: calculations.length,
        skipped: skipped.length,
        fallbackMonth: calculations.filter((row) => row.calculationMonthSource === "fallback").length,
        estimatedTotalRub: calculations.reduce((sum, row) => sum + Number(row.estimatedTotalRub), 0),
        minEstimateRub: calculations.length ? Math.min(...calculations.map((row) => Number(row.estimatedTotalRub))) : null,
        maxEstimateRub: calculations.length ? Math.max(...calculations.map((row) => Number(row.estimatedTotalRub))) : null,
        byPowerReferenceSource: Object.fromEntries([...new Set(calculations.map((row) => String(row.powerReferenceSource)))].map((source) => [source, calculations.filter((row) => row.powerReferenceSource === source).length])),
      },
      calculations, skipped,
    };
    await mkdir("output", { recursive: true });
    const output = "output/tl-auto-new-encar-preliminary-calculation-dry-run.json";
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, calculations: undefined, skipped: undefined, output }, null, 2));
    await db.query("rollback");
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exit(1); });
