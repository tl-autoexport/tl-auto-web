import assert from "node:assert/strict";
import { catalogRead, catalogFacetUrl } from "./catalog-client-read";

async function run() {
  const originalFetch = globalThis.fetch;
  try {
    const facets = new URL(catalogFacetUrl("brand=Volvo&model=S90&generation=second&modification=T5&trim=Inscription", "modification"), "https://catalog.local");
    assert.equal(facets.searchParams.get("generation"), "second");
    assert.equal(facets.searchParams.has("modification"), false);
    assert.equal(facets.searchParams.has("trim"), false);
    assert.equal(facets.searchParams.get("count"), "0");

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ count: 13 });
    };
    const [first, second] = await Promise.all([
      catalogRead("/api/catalog/count?brand=Volvo&sort=fresh&model=S90"),
      catalogRead("/api/catalog/count?model=S90&brand=Volvo&page=2"),
    ]);
    assert.deepEqual(first, { count: 13 });
    assert.deepEqual(second, first);
    assert.equal(calls, 2, "overlapping reads share one recovery attempt");
    await catalogRead("/api/catalog/count?model=S90&brand=Volvo");
    assert.equal(calls, 2, "the successful recovery is cached");

    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("bad request", { status: 400 }); };
    await assert.rejects(catalogRead("/api/catalog/facets?brand=invalid"), /400/);
    assert.equal(calls, 1, "invalid requests must not be retried");

    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("unavailable", { status: 503 }); };
    await assert.rejects(catalogRead("/api/catalog/count?brand=retry-failure"), /503/);
    assert.equal(calls, 2, "transient recovery is bounded to one retry");
    globalThis.fetch = async () => { calls += 1; return Response.json({ count: 7 }); };
    assert.deepEqual(await catalogRead("/api/catalog/count?brand=retry-failure"), { count: 7 });
    assert.equal(calls, 3, "errors never poison the cache");
    console.log("catalog client recovery tests passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void run();
