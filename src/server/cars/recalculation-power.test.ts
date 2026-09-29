import assert from "node:assert/strict";
import { electricRecalculationPowerKw } from "./recalculation-power";

assert.equal(electricRecalculationPowerKw({
  fuel_type: "electric", power_basis: "electric_30min",
  calculation_power_status: "matched", calculation_power_kw: 61.7819,
}), 61.7819);

for (const [power_basis, calculation_power_status, calculation_power_kw] of [
  ["peak", "matched", 150],
  ["electric_30min", "review_required", 61.7819],
  ["electric_30min", "matched", null],
] as const) {
  assert.equal(electricRecalculationPowerKw({
    fuel_type: "electric", power_basis, calculation_power_status, calculation_power_kw,
  }), null);
}
