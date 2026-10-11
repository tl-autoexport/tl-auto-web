import assert from "node:assert/strict";
import { generationFacetLabel } from "./generation-facet-label";
import { cascadeChange, cascadeFacetQuery, splitGenerationLabel } from "../../lib/catalog-cascade";

assert.equal(generationFacetLabel("hg", "HG", "Hyundai", "Grandeur"), "Grandeur (HG) (2011–2017)");
assert.match(generationFacetLabel("gn7", "GN7", "Hyundai", "Grandeur"), /^Grandeur \(GN7\) \(/);
assert.equal(generationFacetLabel("hg", "HG"), "HG");
assert.equal(generationFacetLabel("unknown", "Unknown", "Hyundai", "Grandeur"), "Unknown");
assert.equal(generationFacetLabel("ordinal:Hyundai:Grandeur:Name (2019–2022)", "Name (2019–2022)", "Hyundai", "Grandeur"), "Name (2019–2022)");
assert.deepEqual(cascadeChange("model", "Grandeur"), { model: "Grandeur", generation: null, modification: null, trim: null });
assert.deepEqual(cascadeChange("modification", "2.5"), { modification: "2.5", trim: null });
assert.deepEqual(splitGenerationLabel("Grandeur (HG) (2011–2017)"), { name: "Grandeur (HG)", period: "2011–2017" });
assert.deepEqual(splitGenerationLabel("Other"), { name: "Other", period: null });
assert.equal(cascadeFacetQuery("brand=Hyundai&model=Grandeur&generation=hg&trim=Premium&yearMin=2020", "model"), "brand=Hyundai&yearMin=2020");
assert.equal(cascadeFacetQuery("brand=Hyundai&model=Grandeur&generation=hg&trim=Premium&yearMin=2020", "generation"), "brand=Hyundai&model=Grandeur");
console.log("Cascade labels and dependency resets passed");
