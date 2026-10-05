import assert from "node:assert/strict";
import {
  canonicalCatalogBrand, canonicalCatalogModel, compactModificationName, generationCatalogLabel, generationPresentation,
  isOrdinalOnlyName, looksLikeModification, namingKey, normalizeVehicleName, splitVersionName, sourceGenerationOrdinal,
} from "./catalog-naming";
import taxonomy from "../../../data/catalog-naming/encar-taxonomy-v1.json";
import { resolveCatalogNaming, type Car, type Node } from "./catalog-naming-resolver";

assert.equal(canonicalCatalogBrand("Mercedes-Benz"),"Mercedes-Benz");
assert.equal(canonicalCatalogBrand("BMW"),"BMW");
assert.equal(canonicalCatalogModel("Canival"),"Carnival");
assert.equal(canonicalCatalogModel("Santafe"),"Santa Fe");
assert.equal(canonicalCatalogModel("RAY"),"Ray");
assert.equal(canonicalCatalogModel("E-Class"),"E-Class");
assert.equal(canonicalCatalogModel("CLE-Class"),"CLE");
assert.equal(canonicalCatalogModel("CLE-클래스 C236"),"CLE");
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
assert.equal(normalizeVehicleName("NewRexton"),"New Rexton");
assert.equal(normalizeVehicleName("Rexton II"),"Rexton II");
assert.equal(compactModificationName("Бензин 2.5 Turbo AWD"),"2.5T AWD");
assert.equal(generationPresentation("G80","G80","G80").display,null);
assert.equal(generationPresentation("1시리즈 (F20)","1 Series (F20)","1 Series").display,"F20");
assert.equal(generationPresentation("CLS C257","CLS C257","CLS").display,"C257");
assert.equal(generationPresentation("K5 3세대","K5 3rd Generation","K5").display,"3-е поколение");
assert.equal(generationPresentation("더 뉴 레이","The New Ray","Ray").display,null);
assert.equal(generationPresentation("더 뉴 레이","The New Ray","Ray").facelift,null);
assert.equal(generationCatalogLabel("Rexton Sports","Rexton","201801","202106"),"Rexton Sports (2018–2021)");
assert.equal(generationCatalogLabel("Rexton","Rexton","200109","200312"),"Rexton (2001–2003)");
assert.equal(generationCatalogLabel("The New Ray","Ray","202307",null),"The New Ray (с 2023)");
const rextonNodes = (taxonomy.nodes as Node[]).filter((node) =>
  node.key === "kor:004" || node.key === "kor:004:003" || node.key === "kor:004:003:113" || node.key === "kor:004:003:114",
);
const rextonCar = (generationCode: string, generationKr: string): Car => ({
  id: generationCode, primary_source: "encar", source_id: generationCode,
  brand: "KGM", model: "Rexton", generation: generationKr, generation_code: generationCode,
  trim: null, grade: null, badge: null, badge_detail: null, year: 2020,
  staging_generation: null, staging_trim: null,
  source_names: {
    manufacturerCode: "004", modelGroupCode: "003", generationCode,
    modificationCode: null, trimCode: null, domestic: "true", generationKr,
    modificationEn: null, modificationKr: null, trimEn: null, trimKr: null,
    listGenerationKr: null, listModificationKr: null, listTrimKr: null,
  },
});
const rextonSportsNames = resolveCatalogNaming([
  rextonCar("113", "렉스턴 스포츠"), rextonCar("114", "렉스턴 스포츠 칸"),
], rextonNodes, []).rows.map((row) => row.generation.label);
assert.deepEqual(rextonSportsNames, ["Rexton Sports (2018–2021)", "Rexton Sports Khan (2019–2021)"]);
const generationLabels = new Map<string, string>();
const taxonomyByKey = new Map((taxonomy.nodes as Node[]).map((node) => [node.key, node]));
for (const node of (taxonomy.nodes as Node[]).filter((candidate) => candidate.level === "model")) {
  const group = taxonomyByKey.get(node.parent_key ?? "");
  if (!group) continue;
  const brand = group.canonical_brand ?? group.name_en ?? group.name_kr;
  const model = group.canonical_model ?? group.name_en ?? group.name_kr;
  const presentation = generationPresentation(node.name_kr, node.name_en, model);
  if (presentation.display) continue; // Shared chassis/ordinal labels intentionally group powertrain variants.
  const label = generationCatalogLabel(presentation.fullName, model, node.year_from, node.year_to);
  if (!label) continue;
  const key = [brand, namingKey(model), namingKey(label)].join("|");
  const previous = generationLabels.get(key);
  assert.equal(previous, undefined, `Duplicate generation label ${label}: ${previous} / ${node.key}`);
  generationLabels.set(key, node.key);
}
assert.equal(generationPresentation("X2 (U10)",null,"X2","u10").fullName,"X2 (U10)");
assert.equal(sourceGenerationOrdinal("Third Generation"),3);
assert.equal(sourceGenerationOrdinal("3rd Generation"),3);
assert.equal(sourceGenerationOrdinal("1th"),1);
assert.equal(sourceGenerationOrdinal("5세대"),5);
assert.equal(sourceGenerationOrdinal("Classic Plus"),null);
assert.equal(sourceGenerationOrdinal("Third Generation Package"),null);
console.log("Catalogue naming semantic checks passed");
