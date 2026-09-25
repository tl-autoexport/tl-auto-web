/**
 * Shared Chestny -> TL Auto block mapping.
 *
 * Used by both the dry-run planner and the writer, so the two can never drift:
 * a change to how an option, an inspection item or a history event is built lands
 * in one place.
 *
 * Two display contracts are encoded here, because a row that does not satisfy them
 * is stored but invisible:
 *   * `buildOptionGroups` (page.tsx:855-857) drops an option whose `name_ru` is null
 *     and whose Korean original `translateOption` cannot translate;
 *   * `flattenInspectionItems` (page.tsx:925-949) reads only `label_ru`/`status_ru`.
 */
import { mapStandardOptions, type EncarOptionCatalog, type EncarOptionRow } from "../imports/encar";
import { translateInspectionLabel, translateInspectionStatus, translateOption } from "../normalization/display";

export type ChestnyRow = Record<string, unknown>;

export const asRow = (value: unknown): ChestnyRow =>
  value && typeof value === "object" && !Array.isArray(value) ? value as ChestnyRow : {};
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asText = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
export const asNumberOrNull = (value: unknown): number | null =>
  value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value);

export function hasContent(value: unknown, depth = 0): boolean {
  if (value == null || depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasContent(item, depth + 1));
  if (typeof value === "object") return Object.values(value as ChestnyRow).some((item) => hasContent(item, depth + 1));
  return false;
}

/** Whether `buildOptionGroups` would actually render this row. */
export function isOptionRowDisplayable(row: Pick<EncarOptionRow, "name_ru" | "name_original">): boolean {
  return Boolean(row.name_ru) || Boolean(translateOption(row.name_original));
}

/** Options carried by Encar standard-option codes that Chestny already stores. */
export function optionRowsFromCodes(catalog: EncarOptionCatalog, codes: string[]): EncarOptionRow[] {
  if (!codes.length) return [];
  return mapStandardOptions(catalog, codes).filter((row) => row.is_present === true);
}

/** Options that Chestny stores directly, with a price and description but no code. */
export function optionRowsFromChoice(reportOptions: unknown): EncarOptionRow[] {
  return asArray(reportOptions).map((raw, index) => {
    const option = asRow(raw);
    const name = asText(option.name);
    return {
      category: "Дополнительные опции",
      source_code: null,
      name_original: name,
      name_ru: translateOption(name ?? "") ?? null,
      value_original: null,
      value_ru: null,
      price_krw: asNumberOrNull(option.priceKrw),
      description_original: asText(option.description),
      description_ru: null,
      is_present: true,
      sort_order: 1000 + index,
    } satisfies EncarOptionRow;
  });
}

/**
 * Chestny accident summary in the vocabulary the card already reads
 * (`buildInsuranceEvents`, page.tsx:1204-1251). Events go to
 * `accidentHistoryResponse`, which the card reads, so no UI rework is needed for
 * the list itself.
 */
export function historySummaryFrom(accident: ChestnyRow) {
  const events = asArray(accident.insuranceEvents).flatMap((raw) => {
    const event = asRow(raw);
    const date = asText(event.date);
    const amount = asNumberOrNull(event.amountKrw);
    if (!date && amount == null) return [];
    const type = asText(event.type);
    return [{
      accident_date: date,
      amount,
      wage: asNumberOrNull(event.laborKrw),
      component: asNumberOrNull(event.partsKrw),
      painting: asNumberOrNull(event.paintingKrw),
      operations: type ? [type] : [],
    }];
  });
  return {
    source: "chestny",
    available: accident.available === true,
    my_car_accident_count: asNumberOrNull(accident.ownAccidentCount) ?? asNumberOrNull(accident.accidentCount),
    my_car_accident_cost: asNumberOrNull(accident.ownAccidentCostKrw),
    other_car_accident_cost: asNumberOrNull(accident.otherAccidentCostKrw),
    owner_changed_count: asNumberOrNull(accident.ownerChangeCount),
    loan_count: asNumberOrNull(accident.loanCount),
    theft_count: asNumberOrNull(accident.theftCount),
    total_loss_count: asNumberOrNull(accident.totalLossCount),
    flood_part_loss_count: asNumberOrNull(accident.floodPartLossCount),
    flood_total_loss_count: asNumberOrNull(accident.floodTotalLossCount),
    other_accident_count: asNumberOrNull(accident.otherAccidentCount),
    accidentHistoryResponse: events,
  };
}

export type HistorySummary = ReturnType<typeof historySummaryFrom>;

/** A history report may only be written when the source says the history exists. */
export function historyIsAvailable(accident: ChestnyRow): boolean {
  return accident.available === true;
}

/** Whether a confirmed-clean history should be stated as such instead of as zeros. */
export function historyIsConfirmedClean(summary: HistorySummary): boolean {
  const counters = [
    summary.loan_count, summary.theft_count, summary.total_loss_count, summary.flood_part_loss_count,
    summary.flood_total_loss_count, summary.owner_changed_count, summary.my_car_accident_count,
    summary.other_accident_count,
  ];
  return summary.available && counters.every((value) => Number(value ?? 0) === 0)
    && summary.accidentHistoryResponse.length === 0;
}

/**
 * Inspection groups in the shape `buildInspectionGroups`/`flattenInspectionItems`
 * consume: a group needs `label_ru` and at least one child with `label_ru` (and a
 * `status_ru` to be shown as a status line).
 */
export function inspectionItemsFrom(summary: ChestnyRow) {
  const children = (original: string, statusOriginal: string | null, code: string | null) => {
    if (!statusOriginal) return [];
    const label = translateInspectionLabel(original) ?? original;
    return [{
      label_ru: label,
      label_original: original,
      status_ru: translateInspectionStatus(statusOriginal) ?? statusOriginal,
      status_original: statusOriginal,
      status_code: code,
    }];
  };

  const checks = asArray(summary.checks).flatMap((raw) => {
    const check = asRow(raw);
    const original = asText(check.title);
    if (!original) return [];
    const status = asText(check.status);
    const items = children(original, status, null);
    if (!items.length) return [];
    return [{ label_ru: items[0].label_ru, label_original: original, status_code: null, children: items }];
  });

  const findings = asArray(summary.bodyFindings).flatMap((raw) => {
    const finding = asRow(raw);
    const original = asText(finding.title);
    if (!original) return [];
    const firstStatus = asRow(asArray(finding.statuses)[0]);
    const status = asText(firstStatus.status) ?? asText(firstStatus.title);
    const items = children(original, status, asText(finding.code));
    if (!items.length) return [];
    return [{ label_ru: items[0].label_ru, label_original: original, status_code: asText(finding.code), children: items }];
  });

  return [...checks, ...findings];
}
