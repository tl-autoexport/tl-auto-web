import assert from "node:assert/strict";
import { catalogBrandValues, normalizeCatalogBrand } from "./catalog-brand";

assert.equal(normalizeCatalogBrand("KG_Mobility_Ssangyong"), "KGM");
assert.equal(normalizeCatalogBrand("Kg__mobility_ssangyong"), "KGM");
assert.equal(normalizeCatalogBrand("KG__Mobility_Ssangyong"), "KGM");
assert.equal(normalizeCatalogBrand("KG Mobility"), "KGM");
assert.equal(normalizeCatalogBrand("SsangYong"), "KGM");
assert.equal(normalizeCatalogBrand("Mini"), "MINI");
assert.equal(normalizeCatalogBrand("MINI"), "MINI");
assert.equal(normalizeCatalogBrand("Land Rover"), "Land Rover");
assert.equal(normalizeCatalogBrand("Citroen-DS"), "DS");
assert.equal(normalizeCatalogBrand("Citroen-ds"), "DS");
assert.equal(normalizeCatalogBrand("DS Automobiles"), "DS");
assert.equal(normalizeCatalogBrand("Citroen"), "Citroen");
assert.equal(normalizeCatalogBrand(null), null);

assert.deepEqual(catalogBrandValues("KGM"), [
  "KGM",
  "KG_Mobility_Ssangyong",
  "KG__Mobility_Ssangyong",
  "Kg__mobility_ssangyong",
  "KG__mobility__ssangyong",
  "SsangYong",
  "Ssangyong",
  "KG Mobility",
]);
assert.deepEqual(catalogBrandValues("Mini"), ["MINI", "Mini"]);
assert.deepEqual(catalogBrandValues("Kia"), ["Kia"]);
assert.deepEqual(catalogBrandValues("DS"), ["DS", "DS Automobiles", "Citroen-DS", "Citroen-ds", "Citroen DS"]);

console.log("catalog brand normalization tests passed");
