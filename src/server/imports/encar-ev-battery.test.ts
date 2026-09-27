import assert from "node:assert/strict";
import {
  classifyEncarEvBatteryResponse,
  isEncarElectricFuel,
} from "./encar-ev-battery";

assert.equal(isEncarElectricFuel("electric"), true);
assert.equal(isEncarElectricFuel(" 전기 "), true);
assert.equal(isEncarElectricFuel("hybrid"), false);

assert.equal(classifyEncarEvBatteryResponse(200, {
  ensolRawInfo: { summaryInfo: { soh: 95.4 } },
  jatoBatteryInfo: null,
  encarComputedInfo: null,
}), "available");
assert.equal(classifyEncarEvBatteryResponse(200, {
  ensolRawInfo: null,
  jatoBatteryInfo: null,
  encarComputedInfo: null,
}), "no_data");
assert.equal(classifyEncarEvBatteryResponse(404, { message: "not found" }), "request_error");

console.log("Encar EV battery classification tests passed");
