import assert from "node:assert/strict";
import { encarrusEngineCc, encarrusFuelType, encarrusIceMatch, encarrusIceModelNameMatches, parseEncarrusIceCards } from "./encarrus-ice";

assert.equal(encarrusFuelType("1.6 л (бензин)"), "gasoline");
assert.equal(encarrusFuelType("2.2 л дизель"), "diesel");
assert.equal(encarrusFuelType("1.6 л гибрид"), null);
assert.equal(encarrusEngineCc("1.6 л (бензин)"), 1600);
assert.equal(encarrusEngineCc("1.5 бензин"), 1500);
assert.equal(encarrusEngineCc("2.0 дизель"), 2000);
assert.equal(encarrusEngineCc("1998 см³"), 1998);
assert.equal(encarrusIceModelNameMatches({
  brand: "KG_Mobility_Ssangyong", model: "Torres",
  sourceExamples: [{ snapshotBrand: "KGM", snapshotModel: "Torres", detailModel: "토레스" }],
}, "KG모빌리티 토레스"), true);
assert.equal(encarrusIceModelNameMatches({
  brand: "KG_Mobility_Ssangyong", model: "Torres",
  sourceExamples: [{ detailModel: "토레스" }],
}, "현대 토레스"), false);

const html = `<div class="element--wrapper" id="card_123"><div class="c-name">BMW 320i</div>
<div class="c-trim">2022년식</div><div class="c-prop"><span class="c-prop-k">Двиг.</span><span class="c-prop-v">2.0 л (бензин)</div>
<div class="c-prop"><span class="c-prop-k">Мощн.</span><span class="c-prop-v">184 л.с.</div>
<div class="c-prop"><span class="c-prop-k">Привод</span><span class="c-prop-v">2WD</div>
<a href="/korea/product/123/?city_price=1">Карточка</a></div>`;
const [card] = parseEncarrusIceCards(html, "/korea/bmw/3-series/");
assert.equal(card.encarrusListingId, "123");
assert.equal(card.year, 2022);
assert.equal(card.engineCc, 2000);
assert.equal(card.fuelType, "gasoline");
assert.equal(card.displayedPowerHp, 184);
assert.equal(card.productUrl, "https://encarrus.ru/korea/product/123/?city_price=1");
assert.deepEqual(encarrusIceMatch(card, { year: 2022, engineCc: 1998, fuelType: "gasoline", driveType: "2WD" }), {
  matched: true, reason: "exact_core_configuration",
});
assert.equal(encarrusIceMatch(card, { year: 2022, engineCc: 1998, fuelType: "diesel", driveType: "2WD" }).matched, false);
assert.equal(encarrusIceMatch(card, { year: 2022, engineCc: 1998, fuelType: "gasoline", driveType: "4WD" }).matched, false);

console.log("EncarRus ICE adapter tests passed");
