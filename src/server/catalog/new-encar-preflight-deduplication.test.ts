import assert from "node:assert/strict";
import { deduplicateNewEncarPreflightRows } from "./new-encar-preflight-deduplication";

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

console.log("New Encar preflight deduplication tests passed");
