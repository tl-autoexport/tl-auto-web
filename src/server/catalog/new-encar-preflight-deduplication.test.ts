import assert from "node:assert/strict";
import { deduplicateNewEncarPreflightRows, selectNewEncarStagingRows } from "./new-encar-preflight-deduplication";

const row = (id: string, status: "ready" | "unknown" | "dummy" | "contract", vehicleNoHash: string | null) => ({
  candidate: { sourceListingId: id }, status, vehicleNoHash,
});

const actual = deduplicateNewEncarPreflightRows([
  row("catalog-duplicate", "ready", "active-hash"),
  row("batch-first", "ready", "same-hash"),
  row("batch-second", "ready", "same-hash"),
  row("transient-error", "unknown", null),
  row("dummy", "dummy", "dummy-hash"),
  row("contract", "contract", "contract-hash"),
], new Set(["active-hash"]));

assert.deepEqual(actual.map(({ candidate, status }) => [candidate.sourceListingId, status]), [
  ["catalog-duplicate", "duplicate_vehicle"],
  ["batch-first", "ready"],
  ["batch-second", "duplicate_vehicle"],
  ["transient-error", "unknown"],
  ["dummy", "dummy"],
  ["contract", "contract"],
]);
assert.equal(actual[1].vehicleNoHash, "same-hash");
assert.equal(actual[2].vehicleNoHash, "same-hash");

const checked = [
  ...Array.from({ length: 784 }, (_, index) => row(`ready-${index}`, "ready", null)),
  row("temporary-1", "unknown", null), row("temporary-2", "unknown", null),
  ...Array.from({ length: 701 }, (_, index) => row(`dummy-${index}`, "dummy", null)),
  ...Array.from({ length: 35 }, (_, index) => row(`contract-${index}`, "contract", null)),
];
assert.equal(selectNewEncarStagingRows(checked, 1000, 786).candidates.length, 786);
assert.equal(selectNewEncarStagingRows(checked, 1000, 786).meetsMinimum, true);
assert.equal(selectNewEncarStagingRows(checked, 1000, 787).meetsMinimum, false);
assert.equal(selectNewEncarStagingRows(checked, 700, 700).candidates.length, 700);

console.log("New Encar preflight deduplication tests passed");
