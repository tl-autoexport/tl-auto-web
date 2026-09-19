import assert from "node:assert/strict";
import {
  evaluatePublication,
  isResolvedPowerStatus,
  powerBasisForFuel,
  resolveCalculationMonth,
  type PublicationCandidate,
} from "./calculation-contract";

// --- month resolution --------------------------------------------------------
assert.deepEqual(resolveCalculationMonth({ registrationDate: "2021-07-15" }), { month: 7, source: "registration_date" });
// An implausible registration date must not be trusted as an exact month.
assert.deepEqual(resolveCalculationMonth({ registrationDate: "1870-07-15" }), { month: 6, source: "fallback" });
assert.deepEqual(resolveCalculationMonth({ registrationDate: null, listingMonth: 11 }), { month: 11, source: "source_listing" });
assert.deepEqual(resolveCalculationMonth({ registrationDate: null, listingMonth: 13 }), { month: 6, source: "fallback" });
assert.deepEqual(resolveCalculationMonth({}), { month: 6, source: "fallback" });
// The fallback is labelled, never silent.
assert.equal(resolveCalculationMonth({}).source, "fallback");

// --- power basis -------------------------------------------------------------
assert.equal(powerBasisForFuel("electric"), "electric_30min");
assert.equal(powerBasisForFuel("hybrid"), "parallel_sum");
assert.equal(powerBasisForFuel("gasoline"), "combustion_engine");
assert.equal(powerBasisForFuel(null), "combustion_engine");

// --- statuses ----------------------------------------------------------------
assert.equal(isResolvedPowerStatus("matched"), true);
assert.equal(isResolvedPowerStatus("approved"), true);
assert.equal(isResolvedPowerStatus("unreviewed"), false);
assert.equal(isResolvedPowerStatus("review_required"), false);

// --- publication gate --------------------------------------------------------
const base: PublicationCandidate = {
  priceRub: 3_000_000,
  hasSnapshot: true,
  calculationPowerStatus: "approved",
  calculationPowerKw: 139.7448,
  powerBasis: "combustion_engine",
  powerResolutionSource: "tl_auto_approved_reference",
  calculationMonth: 7,
  fuelType: "gasoline",
  hybridDvsPowerHp: null,
  legacyCalculationStatus: "calculated_from_staging",
};

assert.deepEqual(evaluatePublication(base), { ok: true });
assert.deepEqual(evaluatePublication({ ...base, priceRub: null }), { ok: false, blockers: ["price_missing"] });
assert.deepEqual(evaluatePublication({ ...base, hasSnapshot: false }), { ok: false, blockers: ["snapshot_missing"] });
assert.deepEqual(evaluatePublication({ ...base, calculationPowerStatus: "unreviewed" }), { ok: false, blockers: ["power_not_resolved"] });
assert.deepEqual(evaluatePublication({ ...base, powerBasis: null }), { ok: false, blockers: ["power_basis_missing"] });
assert.deepEqual(evaluatePublication({ ...base, calculationMonth: null }), { ok: false, blockers: ["calculation_month_missing"] });
assert.deepEqual(evaluatePublication({ ...base, powerResolutionSource: null }), { ok: false, blockers: ["power_resolution_source_missing"] });

// An electric card must be on the 30-minute basis and must not carry ICE power.
assert.deepEqual(evaluatePublication({ ...base, fuelType: "electric", powerBasis: "combustion_engine" }), {
  ok: false, blockers: ["power_basis_mismatch"],
});
assert.deepEqual(evaluatePublication({ ...base, fuelType: "electric", powerBasis: "electric_30min", hybridDvsPowerHp: 150 }), {
  ok: false, blockers: ["electric_has_ice_power"],
});
assert.deepEqual(evaluatePublication({ ...base, fuelType: "electric", powerBasis: "electric_30min" }), { ok: true });

// A stale import marker keeps the card blocked even when everything else holds.
assert.deepEqual(evaluatePublication({ ...base, legacyCalculationStatus: "pending_official_ev_tariff" }), {
  ok: false, blockers: ["legacy_pending_marker"],
});
// Historical calculated markers are provenance only and must not block.
assert.deepEqual(evaluatePublication({ ...base, legacyCalculationStatus: "calculated_external_ev_tariff" }), { ok: true });

console.log("calculation contract tests passed");
