import assert from "node:assert/strict";
import { normalizeEncarTimestamp } from "./encar-date";

assert.equal(
  normalizeEncarTimestamp("2026-09-18T17:36:01"),
  "2026-09-18T08:36:01.000Z",
  "offset-less Encar timestamps are interpreted as Korea local time",
);
assert.equal(
  normalizeEncarTimestamp("2026-09-18T17:36:01Z"),
  "2026-09-18T17:36:01.000Z",
  "explicit UTC timestamps are preserved",
);
assert.equal(
  normalizeEncarTimestamp("2026-09-18T17:36:01+09:00"),
  "2026-09-18T08:36:01.000Z",
  "explicit Korea offsets are normalized",
);
assert.equal(normalizeEncarTimestamp("not-a-date"), null);
assert.equal(normalizeEncarTimestamp(null), null);

console.log("Encar date normalization tests passed");
