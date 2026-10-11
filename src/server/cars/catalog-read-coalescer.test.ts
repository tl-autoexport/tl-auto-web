import assert from "node:assert/strict";
import { catalogCountFilters, catalogDisplayReadView, countCatalogIdPages, createReadCoalescer, readCatalogPage } from "./catalog-read-coalescer";

async function run() {
  const matchingPage = { cars: [{ id: "matching-car" }], nextCursor: "next-matching-car" };
  const timeout = { code: "57014", message: "statement timeout" };
  const warnings: unknown[] = [];
  assert.deepEqual(await readCatalogPage(Promise.reject(timeout), Promise.resolve(matchingPage), error => warnings.push(error)),
    { totalCars: null, initialPage: matchingPage }, "a count timeout preserves matching cards and pagination without a false total");
  assert.deepEqual(warnings, [timeout]);
  assert.deepEqual(await readCatalogPage(Promise.resolve(42), Promise.resolve(matchingPage), () => undefined),
    { totalCars: 42, initialPage: matchingPage });
  await assert.rejects(readCatalogPage(Promise.resolve(42), Promise.reject(new Error("listing unavailable")), () => undefined), /listing unavailable/);
  for (const size of [0, 261, 500, 1001]) {
    const ids = Array.from({ length: size }, (_, index) => String(index).padStart(6, "0"));
    const seen: string[] = [];
    const total = await countCatalogIdPages(async (afterId, limit) => {
      const page = ids.filter((id) => afterId === null || id > afterId).slice(0, limit);
      seen.push(...page);
      return page;
    });
    assert.equal(total, size, "fallback counts every ID, including exact page boundaries");
    assert.deepEqual(seen, ids, "fallback neither skips nor duplicates rows");
  }
  await assert.rejects(countCatalogIdPages(async () => { throw new Error("database unavailable"); }), /database unavailable/);
  await assert.rejects(countCatalogIdPages(async () => Array(500).fill("same-id")), /did not advance/);
  assert.equal(catalogDisplayReadView({ sort: "fresh", maxPowerHp: 160 }), "catalog_display_cars", "unfiltered shelves keep the fast sort-index path");
  for (const filters of [{ brand: "Volvo" }, { model: "S90" }, { generation: "cn7" }, { modification: "T5" }, { trim: "Inscription" }]) {
    assert.equal(catalogDisplayReadView(filters), "catalog_display_cascade_cars", "each identity selection uses the indexed projection");
  }
  assert.deepEqual(
    catalogCountFilters({ sort: "price_desc", brand: "Kia", maxPowerHp: 160, limit: 48, offset: 24, noAccidents: false }),
    catalogCountFilters({ maxPowerHp: 160, brand: "Kia", sort: "fresh" }),
  );
  assert.deepEqual(catalogCountFilters({ search: "Kia K5", modification: "1.6", minEngineCc: 1500, minInsurancePayoutKrw: 1, passable: true }),
    { minEngineCc: 1500, minInsurancePayoutKrw: 1, modification: "1.6", passable: true, search: "Kia K5" });
  assert.notDeepEqual(catalogCountFilters({ driveType: "FWD" }), catalogCountFilters({ driveType: "4WD" }));

  const coalesce = createReadCoalescer<number>();
  let loads = 0;
  const load = async () => { loads += 1; return 42; };
  assert.deepEqual(await Promise.all([coalesce("same", load), coalesce("same", load)]), [42, 42]);
  assert.equal(loads, 1, "concurrent reads of the same selection share one query");
  await coalesce("same", load);
  assert.equal(loads, 2, "fulfilled values are not retained as an availability cache");
  await Promise.all([coalesce("one", load), coalesce("two", load)]);
  assert.equal(loads, 4, "different selections remain independent");

  let failures = 0;
  const fail = async () => { failures += 1; throw new Error("timeout"); };
  const rejected = await Promise.allSettled([coalesce("retry", fail), coalesce("retry", fail)]);
  assert.equal(failures, 1);
  assert.ok(rejected.every((result) => result.status === "rejected"));
  assert.equal(await coalesce("retry", load), 42, "failed reads do not poison later attempts");
  await assert.rejects(coalesce("sync", () => { throw new Error("sync"); }), /sync/);
  assert.equal(await coalesce("sync", load), 42);
  console.log("catalog read coalescing tests passed");
}

void run();
