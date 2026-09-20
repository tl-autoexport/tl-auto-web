import assert from "node:assert/strict";
import { canonicalDriveGroup, canonicalEngineCc, driveGroupsCompatible } from "../power-resolution/canonical";
import { matchCardGroup, type AutoHomeSpec, type CardGroup } from "./autohome-match";

// --- displacement ------------------------------------------------------------
assert.equal(canonicalEngineCc("1598"), 1598);
assert.equal(canonicalEngineCc("1.6"), 1600);
assert.equal(canonicalEngineCc("1.598L"), 1598);
assert.equal(canonicalEngineCc("1.6T"), 1600);
assert.equal(canonicalEngineCc("1,598 cc"), 1598);
assert.equal(canonicalEngineCc("1998cc"), 1998);
assert.equal(canonicalEngineCc("1.6升"), 1600);
// A value that cannot be read stays unknown instead of becoming a match.
assert.equal(canonicalEngineCc(""), null);
assert.equal(canonicalEngineCc("diesel"), null);
assert.equal(canonicalEngineCc("12"), null);

// --- drive -------------------------------------------------------------------
assert.equal(canonicalDriveGroup("2WD"), "TWO_WHEEL_GENERIC");
assert.equal(canonicalDriveGroup("FWD"), "FWD");
assert.equal(canonicalDriveGroup("前驱"), "FWD");
assert.equal(canonicalDriveGroup("前置前驱"), "FWD");
assert.equal(canonicalDriveGroup("전륜"), "FWD");
assert.equal(canonicalDriveGroup("RWD"), "RWD");
assert.equal(canonicalDriveGroup("후륜"), "RWD");
assert.equal(canonicalDriveGroup("AWD"), "AWD");
assert.equal(canonicalDriveGroup("4WD"), "AWD");
assert.equal(canonicalDriveGroup("四驱"), "AWD");
assert.equal(canonicalDriveGroup("4륜"), "AWD");
assert.equal(canonicalDriveGroup("사륜구동"), "AWD");
assert.equal(canonicalDriveGroup(null), null);

// A missing or generic layout never blocks; two explicit different ones do.
assert.equal(driveGroupsCompatible(null, "RWD"), true);
assert.equal(driveGroupsCompatible("TWO_WHEEL_GENERIC", "RWD"), true);
assert.equal(driveGroupsCompatible("AWD", null), true);
assert.equal(driveGroupsCompatible("FWD", "RWD"), false);
assert.equal(driveGroupsCompatible("AWD", "FWD"), false);

// --- matching ladder ---------------------------------------------------------
const group: CardGroup = { model_year: 2021, engine_cc: 1598, fuel_type: "가솔린", drive_type: "2WD", trim: "1.6 T-GDi Prestige" };
const spec = (overrides: Partial<AutoHomeSpec> = {}): AutoHomeSpec => ({
  year: 2021, name: "1.6 T-GDi", engineGroup: "1598", drive: "前置前驱", powerHp: 180, specId: "s1", ...overrides,
});

const unique = matchCardGroup(group, [spec()]);
assert.equal(unique.status, "high_confidence");
assert.deepEqual(unique.powers, [180]);
assert.equal(unique.yearTier, "within_1");
assert.equal(unique.failedFeature, null);

// A spec outside the displacement tolerance is rejected, the correct one stays:
// one usable candidate means a confident match, not a failure.
const otherEngine = matchCardGroup(group, [spec({ specId: "s1" }), spec({ specId: "s2", powerHp: 204, name: "2.0 T-GDi", engineGroup: "1998" })]);
assert.equal(otherEngine.status, "high_confidence");
assert.deepEqual(otherEngine.powers, [180]);
assert.equal(otherEngine.rejectionCounts.engine_cc, 1);

// Same displacement, two different powers: ambiguous, never a guess.
const sameCcAmbiguous = matchCardGroup(group, [spec({ specId: "s1" }), spec({ specId: "s2", powerHp: 204 })]);
assert.equal(sameCcAmbiguous.status, "ambiguous");
assert.equal(sameCcAmbiguous.failedFeature, "multiple_powers");
assert.deepEqual(sameCcAmbiguous.powers.sort((a, b) => a - b), [180, 204]);

// The rear-wheel layout must not accept a front-wheel specification.
const rear = matchCardGroup({ ...group, drive_type: "후륜" }, [spec()]);
assert.equal(rear.status, "no_match");
assert.equal(rear.failedFeature, "drive");

// An unknown layout is compatible with anything.
const unknownDrive = matchCardGroup({ ...group, drive_type: null }, [spec({ drive: "后驱" })]);
assert.equal(unknownDrive.status, "high_confidence");

// A year outside the window is a failure, and the reason is recorded.
const wrongYear = matchCardGroup(group, [spec({ year: 2024 })]);
assert.equal(wrongYear.status, "no_match");
assert.equal(wrongYear.failedFeature, "year");
assert.equal(wrongYear.rejectionCounts.year, 1);

// Widening to two years only when everything else matched and it resolves to one.
const widened = matchCardGroup(group, [spec({ year: 2023 })]);
assert.equal(widened.status, "review");
assert.equal(widened.yearTier, "within_2");

// Widening must still be unique: two powers inside the wider window stay
// ambiguous instead of picking one.
const widenedAmbiguous = matchCardGroup(group, [spec({ year: 2023 }), spec({ year: 2023, powerHp: 204 })]);
assert.equal(widenedAmbiguous.status, "ambiguous");
assert.equal(widenedAmbiguous.failedFeature, "multiple_powers");
assert.equal(widenedAmbiguous.yearTier, "within_2");

// A stated badge family that contradicts the specification blocks the match.
const badgeConflict = matchCardGroup({ ...group, trim: "2.0 TDI Premium" }, [spec()]);
assert.equal(badgeConflict.status, "no_match");
assert.equal(badgeConflict.failedFeature, "trim_conflict");
// A silent specification does not block a stated badge.
const silentSpec = matchCardGroup({ ...group, trim: "1.6 T-GDi Premium" }, [spec({ name: "Prestige", engineGroup: "1598" })]);
assert.equal(silentSpec.status, "high_confidence");

// Fuel conflict blocks, matching fuel passes, absent fuel in the source passes.
// Fuel conflict blocks when everything else fits; the reason is recorded.
const fuelConflict = matchCardGroup(group, [spec({ name: "柴油", engineGroup: "1598" })]);
assert.equal(fuelConflict.status, "no_match");
assert.equal(fuelConflict.failedFeature, "fuel");
const fuelAbsent = matchCardGroup(group, [spec({ name: "Prestige", engineGroup: "1598" })]);
assert.equal(fuelAbsent.status, "high_confidence");

console.log("autohome matching ladder tests passed");
