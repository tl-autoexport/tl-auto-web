/**
 * Dry-run planner: what would be transferred from live Chestny into TL Auto.
 *
 * Read-only. It writes nothing unless CHESTNY_BACKFILL_WRITE=true, and it is meant
 * to be reviewed before that flag is ever used.
 *
 * The plan follows the approved architecture:
 *   * options            -> `car_options` with source='chestny';
 *   * inspection/history -> `car_condition_reports` with source='chestny' and a
 *                           Chestny-specific report_type, so Encar rows are untouched.
 *
 * Two display contracts drive the mapping, and both are verified here rather than
 * assumed:
 *   * `buildInspectionGroups`/`flattenInspectionItems` (page.tsx:904-949) read only
 *     `label_ru`/`status_ru`/`status_code`, so Korean inspection text must be
 *     translated or the block renders empty;
 *   * `buildInsuranceEvents` (page.tsx:1204-1251) reads `my_car_accident_list`,
 *     `other_car_accident_list` and `accidentHistoryResponse`, with events shaped as
 *     `accident_date`/`amount`/`wage`/`component`/`painting`.
 *
 * Acceptance is measured per block, not by presence: `report_status='ready'` with an
 * empty option list is explicitly counted as unusable.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { fetchStandardOptionCatalog, mapStandardOptions } from "../src/server/imports/encar";
import { translateOption, translateInspectionLabel, translateInspectionStatus } from "../src/server/normalization/display";

config({ path: ".env.local", override: true, quiet: true });
const tlUrl = process.env.SUPABASE_DB_URL;
const chestnyUrl = process.env.CHESTNY_SUPABASE_URL?.replace(/\/$/, "");
const chestnyKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
if (!tlUrl) throw new Error("SUPABASE_DB_URL is required");
if (!chestnyUrl || !chestnyKey) throw new Error("Chestny credentials are required");
const write = process.env.CHESTNY_BACKFILL_WRITE === "true";

type Row = Record<string, unknown>;
type TlCar = {
  id: string; source_id: string; no_options: boolean; no_meaningful_report: boolean; no_history: boolean;
};

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const obj = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? value as Row : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const numOrNull = (value: unknown): number | null => (value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value));
const hasContent = (value: unknown, depth = 0): boolean => {
  if (value == null || depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasContent(item, depth + 1));
  if (typeof value === "object") return Object.values(value as Row).some((item) => hasContent(item, depth + 1));
  return false;
};
const isCyrillic = (value: string | null) => Boolean(value && /[а-яё]/i.test(value));

async function chestnyIn(table: string, select: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const filter = `source_listing_id=in.(${chunk.map((id) => `"${id}"`).join(",")})`;
    for (let offset = 0; ; offset += 1000) {
      const url = `${chestnyUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filter}&limit=1000&offset=${offset}`;
      const response = await fetch(url, { headers: { apikey: chestnyKey!, Authorization: `Bearer ${chestnyKey}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`Chestny ${table} HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
      const page = await response.json() as Row[];
      out.push(...page);
      if (page.length < 1000) break;
    }
  }
  return out;
}

function historySummaryFrom(accident: Row) {
  const events = arr(accident.insuranceEvents).map((raw) => {
    const event = obj(raw);
    return {
      accident_date: str(event.date),
      amount: numOrNull(event.amountKrw),
      wage: numOrNull(event.laborKrw),
      component: numOrNull(event.partsKrw),
      painting: numOrNull(event.paintingKrw),
      operations: str(event.type) ? [String(event.type)] : [],
    };
  }).filter((event) => event.accident_date || event.amount != null);
  return {
    source: "chestny",
    available: accident.available === true,
    my_car_accident_count: numOrNull(accident.ownAccidentCount) ?? numOrNull(accident.accidentCount),
    my_car_accident_cost: numOrNull(accident.ownAccidentCostKrw),
    other_car_accident_cost: numOrNull(accident.otherAccidentCostKrw),
    owner_changed_count: numOrNull(accident.ownerChangeCount),
    loan_count: numOrNull(accident.loanCount),
    theft_count: numOrNull(accident.theftCount),
    total_loss_count: numOrNull(accident.totalLossCount),
    flood_part_loss_count: numOrNull(accident.floodPartLossCount),
    flood_total_loss_count: numOrNull(accident.floodTotalLossCount),
    other_accident_count: numOrNull(accident.otherAccidentCount),
    // The card already reads this key, so Chestny events appear without touching the UI.
    accidentHistoryResponse: events,
  };
}

function inspectionItemsFrom(summary: Row) {
  const groups: Array<{ label_ru: string; label_original: string; status_code: string | null; children: unknown[] }> = [];
  const checks = arr(summary.checks).map(obj).filter((check) => hasContent(check.title) || hasContent(check.status));
  for (const check of checks) {
    const original = str(check.title) ?? "";
    const statusOriginal = str(check.status);
    groups.push({
      label_ru: translateInspectionLabel(original) ?? original,
      label_original: original,
      status_code: null,
      children: statusOriginal ? [{
        label_ru: translateInspectionLabel(original) ?? original,
        label_original: original,
        status_ru: translateInspectionStatus(statusOriginal) ?? statusOriginal,
        status_original: statusOriginal,
        status_code: null,
      }] : [],
    });
  }
  const items = [
    ...groups,
    ...arr(summary.bodyFindings).map(obj).filter((finding) => hasContent(finding.title)).map((finding) => {
      const original = str(finding.title) ?? "";
      const status = obj(arr(finding.statuses)[0]);
      const statusOriginal = str(status.status) ?? str(status.title);
      return {
        label_ru: translateInspectionLabel(original) ?? original,
        label_original: original,
        status_code: str(finding.code),
        children: statusOriginal ? [{
          label_ru: translateInspectionLabel(original) ?? original,
          label_original: original,
          status_ru: translateInspectionStatus(statusOriginal) ?? statusOriginal,
          status_original: statusOriginal,
          status_code: str(finding.code),
        }] : [],
      };
    }),
  ].filter((group) => group.children.length > 0);
  return items;
}

async function main() {
  const db = new Client({ connectionString: tlUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const report: Record<string, unknown> = { write, tlWrites: 0, chestnyWrites: 0 };
  try {
    await db.query("begin read only");
    const cars = (await db.query<TlCar>(`
      select c.id, c.source_id,
             (not exists (select 1 from public.car_options o where o.car_id = c.id)) as no_options,
             (not exists (select 1 from public.car_condition_reports r
                          where r.car_id = c.id and r.items is not null and r.items <> '[]'::jsonb)) as no_meaningful_report,
             (c.accident_count is null and c.insurance_payout_count is null) as no_history
      from public.cars c
      where c.is_available and c.primary_source = 'chestny_prigon'
      order by c.source_id`)).rows;
    await db.query("rollback");

    const ids = cars.map((car) => car.source_id);
    const vehicles = await chestnyIn("vehicles", "source_listing_id,status,is_public", ids);
    const catalog = await chestnyIn("catalog_vehicles", "source_listing_id,image_urls,report_status,report_options,inspection_summary,accident_summary", ids);
    const vehicleBySource = new Map(vehicles.map((row) => [String(row.source_listing_id), row]));
    const catalogBySource = new Map(catalog.map((row) => [String(row.source_listing_id), row]));

    const optionCatalog = await fetchStandardOptionCatalog();
    const catalogCodes = new Set<string>();
    for (const option of optionCatalog.options ?? []) {
      if (option.optionCd) catalogCodes.add(option.optionCd);
      for (const sub of option.subOptions ?? []) if (sub.optionCd) catalogCodes.add(sub.optionCd);
    }

    const counts = {
      tlActiveChestny: cars.length,
      eligiblePublic: 0,
      skippedNotActiveOrNotPublic: 0,
    };
    const options = {
      cards: 0, cardsViaCodes: 0, cardsViaChoice: 0, cardsViaBoth: 0, cardsFillableVisible: 0,
      codesSeen: 0, codesKnown: 0, rowsTotal: 0, rowsDisplayable: 0, rowsInvisibleIfWritten: 0,
      skippedNoData: 0,
    };
    const history = { cards: 0, plannedRows: 0, availableFlag: 0, withCounters: 0, withEvents: 0, cleanHistory: 0, sourceSaysUnavailable: 0 };
    const inspection = { cards: 0, plannedRows: 0, checks: 0, bodyFindings: 0, labelTranslationMissing: 0, statusTranslationMissing: 0, skippedNoStructure: 0 };
    const invisibleOptionSample: Array<{ sourceId: string; name: string | null }> = [];
    const samples: Record<string, unknown> = {};

    for (const car of cars) {
      const vehicle = vehicleBySource.get(car.source_id);
      const meta = catalogBySource.get(car.source_id);
      if (!vehicle || String(vehicle.status) !== "active" || vehicle.is_public !== true) { counts.skippedNotActiveOrNotPublic++; continue; }
      counts.eligiblePublic++;
      const summary = obj(meta?.inspection_summary);
      const accident = obj(meta?.accident_summary);

      if (car.no_options) {
        options.cards++;
        const codes = arr(summary.standardOptionCodes).map(String);
        options.codesSeen += codes.length;
        options.codesKnown += codes.filter((code) => catalogCodes.has(code)).length;
        const fromCodes = codes.length ? mapStandardOptions(optionCatalog, codes).filter((row) => row.is_present === true) : [];
        const fromChoice = arr(meta?.report_options).map(obj).map((option, index) => ({
          category: "Дополнительные опции", source_code: null,
          name_original: str(option.name), name_ru: translateOption(str(option.name) ?? "") ?? null,
          value_original: null, value_ru: null, price_krw: numOrNull(option.priceKrw),
          description_original: str(option.description), description_ru: null,
          is_present: true, sort_order: 1000 + index,
        }));
        if (fromCodes.length) options.cardsViaCodes++;
        if (fromChoice.length) options.cardsViaChoice++;
        if (fromCodes.length && fromChoice.length) options.cardsViaBoth++;
        if (!fromCodes.length && !fromChoice.length) options.skippedNoData++;
        const rows = [...fromCodes, ...fromChoice];
        // `buildOptionGroups` (page.tsx:855-857) drops an option whose stored name is
        // null and whose Korean original does not translate, so those rows must not be
        // counted as fillable: writing them adds a row the customer never sees.
        let displayable = 0;
        for (const row of rows) {
          if (row.name_ru || translateOption(row.name_original)) displayable++;
          else if (invisibleOptionSample.length < 10) invisibleOptionSample.push({ sourceId: car.source_id, name: row.name_original });
        }
        options.rowsTotal += rows.length;
        options.rowsDisplayable += displayable;
        options.rowsInvisibleIfWritten += rows.length - displayable;
        if (displayable > 0) options.cardsFillableVisible++;
        if (!samples.options && displayable > 0) samples.options = { sourceId: car.source_id, rows: rows.filter((row) => row.name_ru || translateOption(row.name_original)).slice(0, 3) };
      }

      if (car.no_history) {
        history.cards++;
        const mapped = historySummaryFrom(accident);
        const counters = ["loan_count", "theft_count", "total_loss_count", "flood_part_loss_count", "flood_total_loss_count", "owner_changed_count", "my_car_accident_count", "other_accident_count"]
          .some((key) => Number(mapped[key as keyof typeof mapped] ?? 0) > 0);
        // Only `available=true` is a history report. Everything else is a source that
        // says it has no history, and it must not be turned into a clean record.
        if (!mapped.available) {
          history.sourceSaysUnavailable++;
        } else {
          history.availableFlag++;
          history.plannedRows++;
          if (counters) history.withCounters++;
          if (mapped.accidentHistoryResponse.length) history.withEvents++;
          if (!counters && !mapped.accidentHistoryResponse.length) history.cleanHistory++;
          if (!samples.history) samples.history = { sourceId: car.source_id, summary: mapped };
        }
      }

      if (car.no_meaningful_report) {
        inspection.cards++;
        const items = inspectionItemsFrom(summary);
        inspection.checks += arr(summary.checks).length;
        inspection.bodyFindings += arr(summary.bodyFindings).length;
        for (const check of arr(summary.checks).map(obj)) {
          const original = str(check.title) ?? "";
          if (original && !isCyrillic(translateInspectionLabel(original) ?? null)) inspection.labelTranslationMissing++;
          const statusOriginal = str(check.status) ?? "";
          if (statusOriginal && !isCyrillic(translateInspectionStatus(statusOriginal) ?? null)) inspection.statusTranslationMissing++;
        }
        if (!items.length) inspection.skippedNoStructure++;
        else {
          inspection.plannedRows++;
          inspection.plannedRows += 0;
          if (!samples.inspection) samples.inspection = { sourceId: car.source_id, items: items.slice(0, 3) };
        }
      }
    }

    report.summary = counts;
    report.options = options;
    report.history = history;
    report.inspection = inspection;
    report.samples = samples;
    report.writerImplemented = false;
    report.writerNote = "This script only plans. It has no write branch; CHESTNY_BACKFILL_WRITE must not be treated as an implemented transfer.";
    report.syncAccounting = {
      historySourceSaysUnavailable: history.sourceSaysUnavailable,
      historyConfirmedCleanNoEvents: history.cleanHistory,
      optionRowsRequiringTranslation: options.rowsInvisibleIfWritten,
      invisibleOptionSample,
    };
    report.requiredUiChanges = [
      "repository.ts:910 — add 'chestny_carhistory' and 'chestny_inspection' to the raw_payload report_type allowlist.",
      "page.tsx getCarHistory (1186-1202) — fall back to 'chestny_carhistory' after carhistory/encar_carhistory.",
      "page.tsx buildInspectionGroups (904-923) — fall back to 'chestny_inspection' when 'encar_inspection' has no items.",
      "No change needed for insurance events: buildInsuranceEvents already reads accidentHistoryResponse.",
    ];
    report.reportTypesToWrite = { options: "car_options source='chestny'", history: "car_condition_reports source='chestny' report_type='chestny_carhistory'", inspection: "car_condition_reports source='chestny' report_type='chestny_inspection'" };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
