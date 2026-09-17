/**
 * Drive axle states.
 *
 * The resolver treats a missing axle as compatible with any rule, because the
 * power output usually does not depend on it. That permissiveness is fine for
 * finding a candidate but not for publishing or for reporting: an unknown axle
 * must never be presented as a confirmed one, and a rule that requires a
 * specific axle must not silently accept a card that has a different one.
 *
 * drive_confirmed - the card carries an axle and it is compatible with the rule
 *                   (or the rule does not constrain the axle at all);
 * drive_pending   - the card has no axle at all; nothing was assumed;
 * drive_conflict  - the rule requires an axle the card contradicts.
 */

import { normalizeDrive } from "../normalization/vehicles";

export type DriveState = "drive_confirmed" | "drive_pending" | "drive_conflict";

const TWO_WHEEL = new Set(["2WD", "2wd", "FWD", "RWD", "전륜", "후륜"]);

function family(value: string | null): "two" | "four" | "other" | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (text.includes("4wd") || text.includes("awd") || text.includes("4x4") || text.includes("사륜")) return "four";
  if (TWO_WHEEL.has(value) || text.includes("2wd")) return "two";
  return "other";
}

export function classifyDriveState(reference: string | null | undefined, actual: string | null | undefined): DriveState {
  const actualDrive = normalizeDrive(actual) ?? (actual ? String(actual) : null);
  if (!actualDrive) return "drive_pending";

  const referenceDrive = normalizeDrive(reference) ?? (reference ? String(reference) : null);
  if (!referenceDrive) return "drive_confirmed";

  const referenceFamily = family(referenceDrive);
  const actualFamily = family(actualDrive);
  if (!referenceFamily || !actualFamily) return "drive_confirmed";
  return referenceFamily === actualFamily ? "drive_confirmed" : "drive_conflict";
}
