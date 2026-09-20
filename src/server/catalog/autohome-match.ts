import { normalizeFuel } from "../normalization/vehicles";
import { canonicalDriveGroup, canonicalEngineCc, driveGroupsCompatible, type DriveGroup } from "../power-resolution/canonical";

/**
 * Matching ladder for AutoHome specifications against a catalogue card group.
 *
 * The ladder is deliberately ordered: engine group and drive layout first, then
 * the year, and only as a last resort a wider year window that must still yield
 * a single power. Reviewing the card year first, or simply widening the window
 * for everyone, would attach the power of a different model year — and our own
 * power reference shows that power changes within one generation (Carnival KA4
 * 202 vs 194, Mohave 260 / 249 / 257), so the year is a real discriminator.
 *
 * A match is never confirmed by trim wording: trim tokens can only block, never
 * grant confidence. Anything unreadable (an unparsable displacement, an unknown
 * layout) neither blocks nor confirms; it is simply recorded in the diagnostics,
 * which is what keeps the rule lenient without inventing a power.
 */
export type AutoHomeSpec = {
  year: number | string | null;
  name: string;
  engineGroup: string;
  drive: string | null;
  powerHp: number | string | null;
  specId: string | null;
};

export type CardGroup = {
  model_year: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  drive_type: string | null;
  trim: string | null;
};

export type MatchFailure =
  | "year"
  | "engine_cc"
  | "drive"
  | "fuel"
  | "trim_conflict"
  | "multiple_powers";

export type MatchStatus = "high_confidence" | "review" | "ambiguous" | "no_match";
export type YearTier = "within_1" | "within_2" | null;

export type MatchResult = {
  status: MatchStatus;
  powers: number[];
  usable: AutoHomeSpec[];
  yearTier: YearTier;
  matchedFeatures: string[];
  failedFeature: MatchFailure | null;
  rejectionCounts: Record<MatchFailure, number>;
};

export const CC_TOLERANCE = 80;

/** Badge families are mutually exclusive; a conflict between them blocks. */
const BADGE_FAMILIES: Array<{ name: string; markers: RegExp }> = [
  { name: "diesel", markers: /tdi|crdi|d4hb|d4ha|2\.2d|3\.0d/i },
  { name: "petrol_turbo", markers: /t-?gdi|tgdi|tsi|tfsi|turbo|2\.0t|1\.6t/i },
  { name: "petrol_naturally_aspirated", markers: /mpi|gdi\b/i },
];

function specText(spec: AutoHomeSpec) {
  return `${spec.name ?? ""} ${spec.engineGroup ?? ""}`;
}

/** `normalizeFuel` returns the raw text when it recognises nothing, so only a
 * value from this set counts as a stated fuel. Otherwise a label such as
 * `1.6 T-GDi` would be compared as if it were a fuel and block every match. */
const KNOWN_FUELS = new Set(["gasoline", "diesel", "electric", "hybrid", "lpg", "other"]);

function knownFuel(value: unknown): string | null {
  const normalized = normalizeFuel(value);
  return normalized && KNOWN_FUELS.has(normalized) ? normalized : null;
}

function specFuel(spec: AutoHomeSpec): string | null {
  const text = specText(spec);
  const normalized = knownFuel(text);
  if (normalized) return normalized;
  if (/汽油/.test(text)) return "gasoline";
  if (/柴油/.test(text)) return "diesel";
  if (/电动/.test(text)) return "electric";
  if (/混合/.test(text)) return "hybrid";
  return null;
}

function badgeFamilyOf(text: string): string | null {
  for (const family of BADGE_FAMILIES) if (family.markers.test(text)) return family.name;
  return null;
}

/** The trim may only block: a stated badge family that contradicts the spec. */
function trimConflict(trim: string | null, spec: AutoHomeSpec): boolean {
  const family = badgeFamilyOf(trim ?? "");
  if (!family) return false;
  const specFamily = badgeFamilyOf(specText(spec));
  return specFamily != null && specFamily !== family;
}

function uniquePower(specs: AutoHomeSpec[]): number | null {
  const powers = [...new Set(specs.map((spec) => Number(spec.powerHp)).filter((power) => Number.isFinite(power) && power > 0))];
  return powers.length === 1 ? powers[0] : null;
}

function withinYearWindow(group: CardGroup, spec: AutoHomeSpec, window: number) {
  if (!group.model_year || !spec.year) return true;
  return Math.abs(Number(spec.year) - Number(group.model_year)) <= window;
}

type StageOutcome = { usable: AutoHomeSpec[]; rejectionCounts: Record<MatchFailure, number>; matched: string[] };

function stage(group: CardGroup, specs: AutoHomeSpec[], window: number): StageOutcome {
  const rejectionCounts: Record<MatchFailure, number> = {
    year: 0, engine_cc: 0, drive: 0, fuel: 0, trim_conflict: 0, multiple_powers: 0,
  };
  const matched: string[] = [];
  const cardCc = group.engine_cc == null ? null : canonicalEngineCc(group.engine_cc);
  const cardDrive: DriveGroup = canonicalDriveGroup(group.drive_type);
  const cardFuel = knownFuel(group.fuel_type);

  const usable = specs.filter((spec) => {
    if (!withinYearWindow(group, spec, window)) { rejectionCounts.year++; return false; }

    // Engine group: displacement when the card states one and the source can be
    // read. An unreadable source value is not treated as a match.
    if (cardCc != null) {
      const specCc = canonicalEngineCc(specText(spec));
      if (specCc == null) { rejectionCounts.engine_cc++; return false; }
      if (Math.abs(specCc - cardCc) > CC_TOLERANCE) { rejectionCounts.engine_cc++; return false; }
      matched.push("engine_cc");
    }

    if (!driveGroupsCompatible(cardDrive, canonicalDriveGroup(spec.drive))) { rejectionCounts.drive++; return false; }
    if (cardDrive != null) matched.push("drive");

    const drive = specFuel(spec);
    if (cardFuel && drive && cardFuel !== drive) { rejectionCounts.fuel++; return false; }
    if (cardFuel && drive) matched.push("fuel");

    if (trimConflict(group.trim, spec)) { rejectionCounts.trim_conflict++; return false; }

    matched.push("year");
    return true;
  });

  return { usable, rejectionCounts, matched: [...new Set(matched)] };
}

export function matchCardGroup(group: CardGroup, specs: AutoHomeSpec[]): MatchResult {
  const narrow = stage(group, specs, 1);
  let tier: YearTier = "within_1";
  let chosen = narrow;

  // Widening the year is the last resort: only when the correct window produced
  // no single power. If the wider window holds several powers the result is
  // ambiguous with a reason, never a silent no_match, so the diagnostics show
  // that candidates were found but could not be told apart.
  if (uniquePower(narrow.usable) == null) {
    const wider = stage(group, specs, 2);
    if (wider.usable.length > 0) { chosen = wider; tier = "within_2"; }
  }

  const powers = [...new Set(chosen.usable.map((spec) => Number(spec.powerHp)).filter((power) => Number.isFinite(power) && power > 0))];

  if (chosen.usable.length === 0) {
    return {
      status: "no_match", powers: [], usable: [], yearTier: null, matchedFeatures: [],
      failedFeature: dominantFailure(chosen.rejectionCounts), rejectionCounts: chosen.rejectionCounts,
    };
  }
  if (powers.length > 1) {
    return {
      status: "ambiguous", powers, usable: chosen.usable, yearTier: tier,
      matchedFeatures: chosen.matched, failedFeature: "multiple_powers", rejectionCounts: chosen.rejectionCounts,
    };
  }
  return {
    status: tier === "within_1" ? "high_confidence" : "review",
    powers, usable: chosen.usable, yearTier: tier, matchedFeatures: chosen.matched,
    failedFeature: null, rejectionCounts: chosen.rejectionCounts,
  };
}

function dominantFailure(counts: Record<MatchFailure, number>): MatchFailure | null {
  const entries = Object.entries(counts).filter(([key]) => key !== "multiple_powers") as Array<[MatchFailure, number]>;
  const sorted = entries.sort((left, right) => right[1] - left[1]);
  return sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : null;
}
