import assert from "node:assert/strict";
import {
  FixedWindowRateLimiter,
  RequestBodyTooLargeError,
  getRequestClientKey,
  readJsonWithLimit,
} from "./request-guard";

async function run() {
  const parsed = await readJsonWithLimit(
    new Request("https://example.test/api", {
      method: "POST",
      body: JSON.stringify({ priceKrw: 10 }),
    }),
    128,
  );
  assert.deepEqual(parsed, { priceKrw: 10 });

  await assert.rejects(
    readJsonWithLimit(
      new Request("https://example.test/api", {
        method: "POST",
        body: "x".repeat(129),
      }),
      128,
    ),
    RequestBodyTooLargeError,
  );

  const limiter = new FixedWindowRateLimiter(2, 60_000);
  assert.equal(limiter.consume("client", 1_000).allowed, true);
  assert.equal(limiter.consume("client", 1_001).allowed, true);
  assert.equal(limiter.consume("client", 1_002).allowed, false);
  assert.equal(limiter.consume("client", 61_000).allowed, true);

  const first = getRequestClientKey(
    new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    }),
  );
  const second = getRequestClientKey(
    new Request("https://example.test", {
      headers: { "x-real-ip": "203.0.113.5" },
    }),
  );
  assert.equal(first, second);
  assert.notEqual(first, "203.0.113.5");

  console.log("request guard tests passed");
}

void run();
