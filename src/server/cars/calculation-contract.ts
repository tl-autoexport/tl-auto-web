/**
 * The single calculation/publication contract.
 *
 * The database already stores the contract fields on `cars`:
 * `calculation_power_status`, `calculation_power_kw`, `power_basis`,
 * `power_resolution_source`, `calculation_month`, `calculation_month_source`.
 * Writers used to bypass them and set only `price_rub` plus a free-form
 * `vehicle_specs.calculation_status`, which let the two drift apart.
 *
 * Everything that decides *how* those fields are filled, and *whether* a card
 * may be published, lives here so a writer cannot invent its own rule again.
 */

export const POWER_STATUSES = ["unreviewed", "matched", "approved", "review_required", "not_applicable"] as const;
export type PowerStatus = (typeof POWER_STATUSES)[number];

/** Statuses that mean the power is settled and a price may be shown. */
export const RESOLVED_POWER_STATUSES: readonly PowerStatus[] = ["matched", "approved"];

export const POWER_BASES = ["combustion_engine", "electric_30min", "parallel_sum"] as const;
export type PowerBasis = (typeof POWER_BASES)[number];

export const MONTH_SOURCES = ["registration_date", "source_listing", "fallback"] as const;
export type MonthSource = (typeof MONTH_SOURCES)[number];

/** June is the agreed fallback; it is always stored with its source. */
export const FALLBACK_MONTH = 6;

const ELECTRIC_FUELS = new Set(["electric"]);
const HYBRID_FUELS = new Set(["hybrid", "petrol_electric", "diesel_electric"]);

export function isResolvedPowerStatus(status: string | null | undefined): boolean {
  return status != null && (RESOLVED_POWER_STATUSES as readonly string[]).includes(status);
}

/** The legal power basis implied by the powertrain. */
export function powerBasisForFuel(fuelType: string | null | undefined): PowerBasis {
  if (fuelType && ELECTRIC_FUELS.has(fuelType)) return "electric_30min";
  if (fuelType && HYBRID_FUELS.has(fuelType)) return "parallel_sum";
  return "combustion_engine";
}

export type MonthInput = {
  /** First registration date, the most reliable source. */
  registrationDate?: string | null;
  /** Year and month carried by the listing itself. */
  listingYear?: number | null;
  listingMonth?: number | null;
};

/**
 * Resolves the month used by the RU calculation and records where it came from.
 * The June default is only used when nothing better exists, and it is returned
 * with the `fallback` source so the price is never mistaken for an exact one.
 */
export function resolveCalculationMonth(input: MonthInput): { month: number; source: MonthSource } {
  const registration = parseMonth(input.registrationDate ?? null, yearOf(input.registrationDate ?? null));
  if (registration != null) return { month: registration, source: "registration_date" };

  const listingMonth = input.listingMonth;
  if (listingMonth != null && Number.isInteger(listingMonth) && listingMonth >= 1 && listingMonth <= 12) {
    return { month: listingMonth, source: "source_listing" };
  }

  return { month: FALLBACK_MONTH, source: "fallback" };
}

function yearOf(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

function parseMonth(value: string | null, year: number | null): number | null {
  if (!value || year == null) return null;
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCMonth() + 1;
}

export type PublicationCandidate = {
  priceRub: number | null;
  hasSnapshot: boolean;
  calculationPowerStatus: string | null;
  calculationPowerKw: number | null;
  powerBasis: string | null;
  powerResolutionSource: string | null;
  calculationMonth: number | null;
  fuelType: string | null;
  hybridDvsPowerHp: number | null;
  /** Historic free-form marker; a `pending_*` value means a blocked import. */
  legacyCalculationStatus: string | null;
};

export type PublicationVerdict = { ok: true } | { ok: false; blockers: string[] };

/**
 * The only place that decides whether a calculated card may be published.
 * The catalogue audit and the publishers call this, so "the audit passed" and
 * "the publication is allowed" cannot disagree.
 */
export function evaluatePublication(candidate: PublicationCandidate): PublicationVerdict {
  const blockers: string[] = [];
  const basis = candidate.powerBasis;

  if (candidate.priceRub == null) blockers.push("price_missing");
  if (!candidate.hasSnapshot) blockers.push("snapshot_missing");
  if (!isResolvedPowerStatus(candidate.calculationPowerStatus)) blockers.push("power_not_resolved");
  if (candidate.calculationPowerKw == null) blockers.push("calculation_power_kw_missing");
  if (basis == null) blockers.push("power_basis_missing");
  if (!candidate.powerResolutionSource) blockers.push("power_resolution_source_missing");
  if (candidate.calculationMonth == null) blockers.push("calculation_month_missing");
  if (candidate.legacyCalculationStatus?.startsWith("pending_")) blockers.push("legacy_pending_marker");

  const expectedBasis = powerBasisForFuel(candidate.fuelType);
  if (basis != null && basis !== expectedBasis) blockers.push("power_basis_mismatch");
  if (expectedBasis === "electric_30min" && candidate.hybridDvsPowerHp != null) blockers.push("electric_has_ice_power");

  return blockers.length ? { ok: false, blockers } : { ok: true };
}
