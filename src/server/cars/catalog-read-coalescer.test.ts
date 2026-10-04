import assert from "node:assert/strict";
import { catalogCountFilters, createReadCoalescer } from "./catalog-read-coalescer";

async function run() {
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
