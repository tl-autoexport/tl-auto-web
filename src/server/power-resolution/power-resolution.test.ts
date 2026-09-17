/**
 * Tests for the power-resolution matching and publication policy.
 *
 * They cover the six behaviours requested before any further publication:
 * model naming (Korean/English), generation and badge handling, a missing
 * drive axle, duplicate rules, the T3/T4 publication ban and the use of the
 * confirmed power instead of a legacy fallback.
 */

import assert from "node:assert/strict";
import { canonicalCandidates, canonicalGeneration, canonicalInput, canonicalModel } from "./canonical";
import { classifyDriveState } from "./drive-state";
import { evidenceTier, isPublishableTier, tierFromStored } from "./evidence-tiers";
import { decidePublication } from "./publication-gate";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "./resolver";

const KW_190PS = 139.7447625; // 190 * 0.73549875

type MatchOverrides = Partial<ApprovedPowerCandidate["match"]>;

function candidate(
  specId: string,
  calculationPowerKw: number,
  match: MatchOverrides = {},
  evidence: Partial<Pick<ApprovedPowerCandidate, "evidenceKind" | "evidenceReliability">> = {},
): ApprovedPowerCandidate {
  return {
    specId,
    specVersion: 1,
    calculationPowerKw,
    powerBasis: "combustion_engine",
    sourcePriority: 10,
    evidenceId: `ev-${specId}`,
    evidenceKind: evidence.evidenceKind ?? "manufacturer_document",
    evidenceVerificationStatus: "approved",
    evidenceReliability: evidence.evidenceReliability ?? "high",
    match: {
      id: `m-${specId}`,
      priority: 10,
      brand: "Mercedes-Benz",
      model: "A-Class",
      ...match,
    },
  };
}

function tierMap(specs: Array<[string, "T1" | "T2" | "T3" | "T4"]>) {
  return new Map(specs);
}

function kwMap(specs: Array<[string, number]>) {
  return new Map(specs);
}

function gateInput(
  resolution: ReturnType<typeof resolveApprovedPower>,
  overrides: Partial<Parameters<typeof decidePublication>[0]> = {},
) {
  return {
    resolution,
    confirmedSpecId: resolution.status === "matched" ? resolution.candidate.specId : null,
    confirmedHp: resolution.status === "matched" ? Math.round(resolution.candidate.calculationPowerKw * 1.359621617) : null,
    tierBySpecId: tierMap([["spec-a", "T2"]]),
    kwBySpecId: kwMap([["spec-a", KW_190PS]]),
    driveType: "2WD",
    registrationMonth: 6,
    photoCount: 5,
    hasRequiredSourceData: true,
    ...overrides,
  };
}

// --- 1. Korean and English model names ---------------------------------------
assert.equal(canonicalModel("티구안 2세대"), "Tiguan");
assert.equal(canonicalModel("Tiguan"), "Tiguan");
assert.equal(canonicalModel("파사트"), "Passat");
assert.equal(canonicalModel("골프"), "Golf");
assert.equal(canonicalModel("제타"), "Jetta");
assert.equal(canonicalModel("말리부"), "Malibu");
assert.equal(canonicalModel("avante"), "Elantra");
assert.equal(canonicalModel("GLB-Class"), "GLB");
assert.equal(canonicalModel("GLB-클래스 X247"), "GLB");
assert.equal(canonicalInput({ brand: "벤츠" }).brand, "Mercedes-Benz");

// --- 2. Generation and badge -------------------------------------------------
assert.equal(canonicalGeneration("X1 (U11)"), "U11");
assert.equal(canonicalGeneration("U11"), "U11");
assert.equal(canonicalGeneration("X1 (F48)"), "F48");
assert.notEqual(canonicalGeneration("X1 (F48)"), canonicalGeneration("X1 (U11)"));
assert.equal(canonicalGeneration("쏘나타 (DN8)"), "DN8");
assert.equal(canonicalGeneration("쏘나타 디 엣지(DN8)"), canonicalGeneration("쏘나타 (DN8)"));
assert.equal(canonicalGeneration("더 뉴 쏘렌토 4세대"), "더 뉴 쏘렌토 4세대");
assert.equal(canonicalInput({ trim: "GLB200 d 4MATIC" }).badge, "glb200 d 4matic");

// Both sides must be canonicalised, otherwise the same car is counted twice.
{
  const rules = canonicalCandidates([
    candidate("spec-glb", KW_190PS, { model: "GLB", badgeNormalized: "GLB200 d", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
  ]);
  const card = canonicalInput({ brand: "벤츠", model: "GLB-클래스 X247", trim: "GLB200 d", year: 2021, engineCc: 1950, fuelType: "gasoline" });
  const matched = resolveApprovedPower(card, rules);
  assert.equal(matched.status, "matched");
  assert.equal(matched.status === "matched" && matched.candidate.specId, "spec-glb");
}

// A generation-limited rule must not accept a different generation.
{
  const rules = canonicalCandidates([
    candidate("spec-u11", KW_190PS, { model: "X1", generation: "X1 (U11)", productionYearFrom: 2023, productionYearTo: 2025, engineCcFrom: 1990, engineCcTo: 2005 }),
  ]);
  const car = canonicalInput({ brand: "BMW", model: "X1", generation: "X1 (F48)", year: 2024, engineCc: 1998, fuelType: "gasoline" });
  assert.equal(resolveApprovedPower(car, rules).status, "review_required");
}

// --- 3. Missing drive axle ---------------------------------------------------
{
  const rules = canonicalCandidates([
    candidate("spec-4wd", KW_190PS, { model: "GLB", driveType: "4WD", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
  ]);
  const withoutDrive = canonicalInput({ brand: "Mercedes-Benz", model: "GLB", year: 2021, engineCc: 1950, fuelType: "gasoline" });
  const resolution = resolveApprovedPower(withoutDrive, rules);
  // The resolver treats a missing axle as compatible; the publication gate is
  // what refuses to publish it.
  assert.equal(resolution.status, "matched");
  assert.equal(withoutDrive.driveType, null);
  const decision = decidePublication(gateInput(resolution, {
    driveType: null,
    tierBySpecId: tierMap([["spec-4wd", "T2"]]),
    kwBySpecId: kwMap([["spec-4wd", KW_190PS]]),
  }));
  assert.deepEqual(decision, { status: "exclude", reason: "drive_pending" });

  const conflicting = canonicalInput({ brand: "Mercedes-Benz", model: "GLB", year: 2021, engineCc: 1950, fuelType: "gasoline", driveType: "2WD" });
  assert.equal(resolveApprovedPower(conflicting, rules).status, "review_required");
}

// --- 4. Duplicate rules ------------------------------------------------------
{
  const duplicates = canonicalCandidates([
    candidate("spec-dup-1", KW_190PS, { model: "GLB", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
    candidate("spec-dup-2", KW_190PS, { model: "GLB", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
  ]);
  const card = canonicalInput({ brand: "Mercedes-Benz", model: "GLB", year: 2021, engineCc: 1950, fuelType: "gasoline" });
  const resolution = resolveApprovedPower(card, duplicates);
  assert.equal(resolution.status, "review_required");
  assert.ok(resolution.candidates.length > 1);
  const decision = decidePublication(gateInput(resolution, {
    confirmedSpecId: "spec-dup-1",
    tierBySpecId: tierMap([["spec-dup-1", "T2"], ["spec-dup-2", "T2"]]),
    kwBySpecId: kwMap([["spec-dup-1", KW_190PS], ["spec-dup-2", KW_190PS]]),
  }));
  assert.deepEqual(decision, { status: "exclude", reason: "power_no_longer_matches" });
}

// --- 5. Evidence tiers and the T3/T4 ban ------------------------------------
assert.equal(evidenceTier({ specKey: "x-provisional", sourceUri: "https://www.kia.com/a.pdf" }), "T4");
assert.equal(evidenceTier({ specKey: "x", note: "Do not treat this row as exact model-year official evidence", sourceUri: "https://www.kia.com/a.pdf" }), "T4");
assert.equal(evidenceTier({ specKey: "x", sourceUri: "https://autocatalogarchive.com/a.pdf" }), "T3");
assert.equal(evidenceTier({ specKey: "x", sourceUri: "https://www.press.bmwgroup.com/a" }), "T2");
assert.equal(evidenceTier({ specKey: "x", sourceUri: "https://www.hyundai.com/kr/spec" }), "T1");
// Accepted aggregators publish on their own, by explicit owner decision.
assert.equal(evidenceTier({ specKey: "x", sourceUri: "https://www.drom.ru/catalog/kia/ev6/500069/" }), "T2");
assert.equal(evidenceTier({ specKey: "x", sourceUri: null }), "T4");
assert.equal(tierFromStored("T3", { specKey: "x", sourceUri: "https://www.hyundai.com/a" }), "T3");
assert.equal(tierFromStored(null, { specKey: "x", sourceUri: "https://www.hyundai.com/a" }), "T1");

// --- 5b. Drive states --------------------------------------------------------
assert.equal(classifyDriveState("4WD", "4WD"), "drive_confirmed");
assert.equal(classifyDriveState("4WD", "2WD"), "drive_conflict");
assert.equal(classifyDriveState(null, "2WD"), "drive_confirmed");
assert.equal(classifyDriveState("4WD", null), "drive_pending");
assert.equal(classifyDriveState(null, null), "drive_pending");
assert.equal(isPublishableTier("T1", false), true);
assert.equal(isPublishableTier("T2", false), true);
assert.equal(isPublishableTier("T3", false), false);
assert.equal(isPublishableTier("T3", true), true);
assert.equal(isPublishableTier("T4", true), false);

{
  const rules = canonicalCandidates([
    candidate("spec-t4", KW_190PS, { model: "GLB", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
  ]);
  const card = canonicalInput({ brand: "Mercedes-Benz", model: "GLB", year: 2021, engineCc: 1950, fuelType: "gasoline" });
  const resolution = resolveApprovedPower(card, rules);
  const decision = decidePublication(gateInput(resolution, {
    tierBySpecId: tierMap([["spec-t4", "T4"]]),
    kwBySpecId: kwMap([["spec-t4", KW_190PS]]),
  }));
  assert.deepEqual(decision, { status: "exclude", reason: "tier_T4_not_publishable" });
}

// T3 becomes publishable only with a T1/T2 specification of the same output.
{
  const rules = canonicalCandidates([
    candidate("spec-t3", KW_190PS, { model: "GLB", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
    candidate("spec-t2", KW_190PS, { model: "GLB", engineCcFrom: 1940, engineCcTo: 1960, productionYearFrom: 2019, productionYearTo: 2024 }),
  ]);
  const card = canonicalInput({ brand: "Mercedes-Benz", model: "GLB", year: 2021, engineCc: 1950, fuelType: "gasoline" });
  const resolution = resolveApprovedPower(card, rules);
  assert.equal(resolution.status, "review_required"); // equal specificity, so a human must decide
  const corroborated = decidePublication(gateInput(resolution, {
    confirmedSpecId: "spec-t3",
    tierBySpecId: tierMap([["spec-t3", "T3"], ["spec-t2", "T2"]]),
    kwBySpecId: kwMap([["spec-t3", KW_190PS], ["spec-t2", KW_190PS]]),
  }));
  assert.equal(corroborated.status, "exclude"); // ambiguity still blocks, by design
}

// --- 6. Confirmed power is used, legacy values are rejected ------------------
{
  const rules = canonicalCandidates([
    candidate("spec-a220", KW_190PS, { model: "A-Class", badgeNormalized: "a220 sedan", engineCcFrom: 1985, engineCcTo: 2005, productionYearFrom: 2018, productionYearTo: 2025 }),
  ]);
  const card = canonicalInput({ brand: "Mercedes-Benz", model: "A-Class", trim: "A220 Sedan", year: 2020, engineCc: 1991, fuelType: "gasoline", driveType: "2WD" });
  const resolution = resolveApprovedPower(card, rules);
  assert.equal(resolution.status, "matched");

  const published = decidePublication(gateInput(resolution, {
    confirmedSpecId: "spec-a220",
    tierBySpecId: tierMap([["spec-a220", "T2"]]),
    kwBySpecId: kwMap([["spec-a220", KW_190PS]]),
  }));
  assert.deepEqual(published, { status: "publish", specId: "spec-a220", hp: 190, tier: "T2", confidence: "high", driveState: "drive_confirmed" });

  // The legacy 224 PS value must not be published for this card: the approved
  // specification states 190 PS, so the stored confirmation is rejected.
  const legacyValue = decidePublication(gateInput(resolution, {
    confirmedSpecId: "spec-a220",
    confirmedHp: 224,
    tierBySpecId: tierMap([["spec-a220", "T2"]]),
    kwBySpecId: kwMap([["spec-a220", KW_190PS]]),
  }));
  assert.deepEqual(legacyValue, { status: "exclude", reason: "confirmation_value_mismatch" });

  // A confirmation pointing at a different specification is rejected.
  const conflict = decidePublication(gateInput(resolution, {
    confirmedSpecId: "spec-other",
    tierBySpecId: tierMap([["spec-a220", "T2"], ["spec-other", "T2"]]),
    kwBySpecId: kwMap([["spec-a220", KW_190PS], ["spec-other", KW_190PS]]),
  }));
  assert.deepEqual(conflict, { status: "exclude", reason: "confirmation_conflict" });

  // A card without any confirmation is never published from a legacy fallback.
  const unconfirmed = decidePublication(gateInput(resolution, {
    confirmedSpecId: null,
    tierBySpecId: tierMap([["spec-a220", "T2"]]),
    kwBySpecId: kwMap([["spec-a220", KW_190PS]]),
  }));
  assert.deepEqual(unconfirmed, { status: "exclude", reason: "no_power_confirmation" });

  // Missing month and missing photos are separate gates, not assumptions.
  assert.deepEqual(
    decidePublication(gateInput(resolution, {
      confirmedSpecId: "spec-a220", registrationMonth: null,
      tierBySpecId: tierMap([["spec-a220", "T2"]]), kwBySpecId: kwMap([["spec-a220", KW_190PS]]),
    })),
    { status: "exclude", reason: "month_pending" },
  );
  assert.deepEqual(
    decidePublication(gateInput(resolution, {
      confirmedSpecId: "spec-a220", photoCount: 0,
      tierBySpecId: tierMap([["spec-a220", "T2"]]), kwBySpecId: kwMap([["spec-a220", KW_190PS]]),
    })),
    { status: "exclude", reason: "no_valid_photos" },
  );
}

console.log("power resolution and publication policy tests passed");
