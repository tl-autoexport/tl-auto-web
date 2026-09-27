import assert from "node:assert/strict";
import {
  encarrusModelAliases,
  parseEncarrusListingPower,
  parseEncarrusProductPower,
} from "./encarrus-power";

const evListing = `
  <div class="c-prop">
    <span class="c-prop-k">Мощн.</span>
    <span class="c-prop-v">120 л.с. <span class="power-30min">(30-мин 54)</span></span>
  </div>`;
assert.deepEqual(parseEncarrusListingPower(evListing, "electric"), {
  source: "listing_card",
  rawPowerText: "120 л.с. (30-мин 54)",
  rawPowerNote: "(30-мин 54)",
  displayedPowerHp: 120,
  hybridCombinedPowerHp: null,
  hybridEnginePowerHp: null,
  recyclingPowerHp: null,
  electric30MinPowerHp: 54,
  powerBasis: "electric_peak_and_30min",
});

const evDetail = `<div class="pd-spec">
  <div class="sp-lbl">Мощность</div><div class="sp-val">120 л.с.</div>
  <div class="sp-sub">пиковая; утильсбор считают по 30-минутной мощности — 54 л.с.</div>
</div>`;
assert.equal(parseEncarrusProductPower(evDetail, "electric").electric30MinPowerHp, 54);

const hybridDetail = `<div class="pd-spec">
  <div class="sp-lbl">Мощность</div><div class="sp-val">141 л.с.</div>
  <div class="sp-sub">суммарная; двигатель 105 л.с., для утильсбора считают 125 л.с.</div>
</div>`;
const hybrid = parseEncarrusProductPower(hybridDetail, "hybrid");
assert.equal(hybrid.displayedPowerHp, 141);
assert.equal(hybrid.hybridCombinedPowerHp, 141);
assert.equal(hybrid.hybridEnginePowerHp, 105);
assert.equal(hybrid.recyclingPowerHp, 125);
assert.equal(hybrid.electric30MinPowerHp, null);
assert.equal(hybrid.powerBasis, "hybrid_combined_with_components");

assert.deepEqual(encarrusModelAliases("Hyundai", "Elantra"), ["avante"]);
assert.deepEqual(encarrusModelAliases("BMW", "X3"), []);

console.log("EncarRus power parsing tests passed");
