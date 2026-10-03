import assert from "node:assert/strict";
import {
  canonicalCatalogBrand, canonicalCatalogModel, compactModificationName, generationPresentation,
  isOrdinalOnlyName, looksLikeModification, normalizeVehicleName, splitVersionName, sourceGenerationOrdinal,
} from "./catalog-naming";

assert.equal(canonicalCatalogBrand("Mercedes-Benz"),"Mercedes-Benz");
assert.equal(canonicalCatalogBrand("BMW"),"BMW");
assert.equal(canonicalCatalogModel("Canival"),"Carnival");
assert.equal(canonicalCatalogModel("Santafe"),"Santa Fe");
assert.equal(canonicalCatalogModel("RAY"),"Ray");
assert.equal(canonicalCatalogModel("E-Class"),"E-Class");
assert.equal(canonicalCatalogModel("RC"),"RC");
assert.equal(normalizeVehicleName("3.0 lpi"),"3.0 LPi");
assert.equal(normalizeVehicleName("t-gdi"),"T-GDi");
assert.equal(normalizeVehicleName("xdrive 20i m sport"),"xDrive 20i M Sport");
assert.equal(normalizeVehicleName("시그니처 스페셜"),"Signature Special");
assert.equal(normalizeVehicleName("미확인등급"),null);
assert.equal(normalizeVehicleName("(세부등급 없음)"),null);
assert.equal(normalizeVehicleName("Trim not specified"),null);
assert.equal(isOrdinalOnlyName("3rd"),true);
assert.equal(isOrdinalOnlyName("3세대"),true);
assert.equal(isOrdinalOnlyName("Prestige"),false);
assert.deepEqual(splitVersionName("E300 avantgarde","Mercedes-Benz"),{modification:"E300",trim:"Avantgarde"});
assert.deepEqual(splitVersionName("530i M Sport","BMW"),{modification:"530i",trim:"M Sport"});
assert.deepEqual(splitVersionName("530i M Sport","Kia"),{modification:"530i M Sport",trim:null});
assert.deepEqual(splitVersionName("Signature","Kia"),{modification:null,trim:"Signature"});
assert.equal(looksLikeModification("Бензин 2.5 Turbo AWD"),true);
assert.equal(looksLikeModification("Prestige"),false);
assert.equal(looksLikeModification("GLC220d"),true);
assert.equal(looksLikeModification("T5 Inscription"),true);
assert.equal(normalizeVehicleName("glc220d"),"GLC220d");
assert.equal(compactModificationName("Бензин 2.5 Turbo AWD"),"2.5T AWD");
assert.equal(generationPresentation("G80","G80","G80").display,null);
assert.equal(generationPresentation("1시리즈 (F20)","1 Series (F20)","1 Series").display,"F20");
assert.equal(generationPresentation("CLS C257","CLS C257","CLS").display,"C257");
assert.equal(generationPresentation("K5 3세대","K5 3rd Generation","K5").display,"3-е поколение");
assert.equal(generationPresentation("더 뉴 레이","The New Ray","Ray").display,null);
assert.equal(generationPresentation("더 뉴 레이","The New Ray","Ray").facelift,null);
assert.equal(generationPresentation("X2 (U10)",null,"X2","u10").fullName,"X2 (U10)");
assert.equal(sourceGenerationOrdinal("Third Generation"),3);
assert.equal(sourceGenerationOrdinal("3rd Generation"),3);
assert.equal(sourceGenerationOrdinal("1th"),1);
assert.equal(sourceGenerationOrdinal("5세대"),5);
assert.equal(sourceGenerationOrdinal("Classic Plus"),null);
assert.equal(sourceGenerationOrdinal("Third Generation Package"),null);
console.log("Catalogue naming semantic checks passed");
