export type AutomaticPowerReferenceRow = {
  configuration_key: string;
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  badge: string | null;
  badge_detail: string | null;
  year_from: number | null;
  year_to: number | null;
  power_hp: number | null;
  power_kw: number | null;
  source: string;
  status: "automatic" | "confirmed" | "retired";
};

export type AutomaticPowerReferenceInput = Pick<
  AutomaticPowerReferenceRow,
  "brand" | "model" | "fuel_type" | "engine_cc" | "drive_type" | "badge" | "badge_detail"
> & { year: number | null };

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sameConfiguration(input: AutomaticPowerReferenceInput, row: AutomaticPowerReferenceRow) {
  return (
    normalize(input.brand) === normalize(row.brand) &&
    normalize(input.model) === normalize(row.model) &&
    normalize(input.fuel_type) === normalize(row.fuel_type) &&
    input.engine_cc === row.engine_cc &&
    normalize(input.drive_type) === normalize(row.drive_type) &&
    normalize(input.badge) === normalize(row.badge) &&
    normalize(input.badge_detail) === normalize(row.badge_detail)
  );
}

function coversYear(year: number | null, row: AutomaticPowerReferenceRow) {
  if (row.year_from == null && row.year_to == null) return true;
  if (year == null) return false;
  return (row.year_from == null || year >= row.year_from) && (row.year_to == null || year <= row.year_to);
}

function yearRangeWidth(row: AutomaticPowerReferenceRow) {
  if (row.year_from == null || row.year_to == null) return Number.POSITIVE_INFINITY;
  return row.year_to - row.year_from;
}

/** Prefer the narrowest applicable year range; fail closed on conflicting ties. */
export function resolveAutomaticPowerReference(
  input: AutomaticPowerReferenceInput,
  rows: AutomaticPowerReferenceRow[],
): AutomaticPowerReferenceRow | null {
  const matches = rows.filter(
    (row) => row.status !== "retired" && row.power_hp != null && sameConfiguration(input, row) && coversYear(input.year, row),
  );
  if (!matches.length) return null;

  const narrowestWidth = Math.min(...matches.map(yearRangeWidth));
  const best = matches.filter((row) => yearRangeWidth(row) === narrowestWidth);
  const powers = new Set(best.map((row) => `${row.power_hp}:${row.power_kw ?? ""}`));
  return powers.size === 1 ? best[0] : null;
}
