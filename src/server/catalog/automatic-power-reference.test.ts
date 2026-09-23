import assert from "node:assert/strict";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "./automatic-power-reference";

const base: AutomaticPowerReferenceRow = {
  configuration_key: "kia|morning|gasoline|998||||year=2025-2025",
  brand: "Kia", model: "Morning", fuel_type: "gasoline", engine_cc: 998,
  drive_type: null, badge: null, badge_detail: null, year_from: 2025, year_to: 2025,
  power_hp: 76, power_kw: 55.8979, source: "ai_web_fallback", status: "automatic",
};
const older: AutomaticPowerReferenceRow = {
  ...base, configuration_key: "kia|morning|gasoline|998||||year=2018-2023",
  year_from: 2018, year_to: 2023, power_hp: 75, power_kw: 55.1625,
};
const input = { brand: "Kia", model: "Morning", fuel_type: "gasoline", engine_cc: 998, drive_type: null, badge: null, badge_detail: null };

assert.equal(resolveAutomaticPowerReference({ ...input, year: 2025 }, [older, base])?.power_hp, 76);
assert.equal(resolveAutomaticPowerReference({ ...input, year: 2022 }, [older, base])?.power_hp, 75);
assert.equal(resolveAutomaticPowerReference({ ...input, year: null }, [older, base]), null);
assert.equal(resolveAutomaticPowerReference({ ...input, year: 2025, drive_type: "2WD" }, [base]), null);
assert.equal(resolveAutomaticPowerReference({ ...input, year: 2025 }, [base, { ...base, configuration_key: "conflict", power_hp: 77 }]), null);
assert.equal(resolveAutomaticPowerReference({ ...input, year: 2025 }, [older, base, { ...base, status: "retired" }])?.power_hp, 76);

console.log("Automatic power reference tests passed.");
