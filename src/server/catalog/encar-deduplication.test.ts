import assert from "node:assert/strict";
import { findEncarDuplicateGroups, type EncarDeduplicationCar } from "./encar-deduplication";

function car(overrides: Partial<EncarDeduplicationCar>): EncarDeduplicationCar {
  return {
    id: "id-1", source_id: "42390001", source_updated_at: "2026-08-01T00:00:00.000Z",
    brand: "Kia", model: "Sorento", year: 2023, mileage_km: 31_000,
    price_krw: 32_000_000, engine_cc: 2_497, vehicle_no_masked: "123가4567",
    vin_masked: null, ...overrides,
  };
}

const plateDuplicates = findEncarDuplicateGroups([
  car({ id: "old", source_id: "42390001" }),
  car({ id: "new", source_id: "42390099", source_updated_at: "2026-08-03T00:00:00.000Z" }),
]);
assert.equal(plateDuplicates.length, 1);
assert.equal(plateDuplicates[0].matchType, "plate");
assert.equal(plateDuplicates[0].keeper.id, "new");
assert.deepEqual(plateDuplicates[0].duplicates.map((item) => item.id), ["old"]);

const vinDuplicatesWithChangedPrice = findEncarDuplicateGroups([
  car({ id: "old-vin", vin_masked: "KNAPU81BDP7123456", price_krw: 32_000_000 }),
  car({ id: "new-vin", source_id: "42390100", source_updated_at: "2026-08-04T00:00:00.000Z", vin_masked: "KNAPU81BDP7123456", price_krw: 31_500_000 }),
]);
assert.equal(vinDuplicatesWithChangedPrice.length, 1);
assert.equal(vinDuplicatesWithChangedPrice[0].matchType, "vin");
assert.equal(vinDuplicatesWithChangedPrice[0].keeper.id, "new-vin");

assert.equal(findEncarDuplicateGroups([
  car({ id: "similar-a", vehicle_no_masked: "111가1111" }),
  car({ id: "similar-b", source_id: "42390101", vehicle_no_masked: "222나2222" }),
]).length, 0);

assert.equal(findEncarDuplicateGroups([
  car({ id: "plate-a" }),
  car({ id: "plate-b", source_id: "42390102", mileage_km: 31_100 }),
]).length, 0);

console.log("Encar deduplication tests passed");
