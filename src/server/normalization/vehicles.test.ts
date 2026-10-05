import assert from "node:assert/strict";
import {
  normalizeEncarBodyPart,
  translateBrand,
  translateDrive,
  translateInspectionStatus,
} from "./display";
import {
  driveTypesCompatible,
  normalizeColor,
  normalizeDrive,
  normalizeModel,
  resolvePower,
} from "./vehicles";

// Mercedes model aliases must match whole model tokens: a Jeep Wrangler must
// never collapse to Mercedes GLE just because the text contains `gle`.
assert.equal(normalizeModel("Wrangler"), "Wrangler");
assert.equal(normalizeModel("GLE450"), "GLE");
assert.equal(normalizeModel("GLC 300"), "GLC");
assert.equal(normalizeModel("CLS-Class"), "CLS");
assert.equal(normalizeModel("S-Class"), "S-Class");
assert.equal(normalizeModel("CLE-Class"), "CLE");
assert.equal(normalizeModel("CLE-클래스 C236"), "CLE");
assert.equal(normalizeModel("CLE450 4MATIC Cabriolet"), "CLE");
assert.equal(normalizeModel("E-Class"), "E-Class");
assert.equal(translateBrand("Kg__mobility_ssangyong"), "KGM");
assert.equal(translateBrand("KG_Mobility_Ssangyong"), "KGM");
assert.equal(translateBrand("Citroen-DS"), "DS");
assert.equal(translateBrand("DS Automobiles"), "DS");

// Colour: Korean source values must become a Russian palette value instead of
// being dropped, while genuinely unknown Korean text must never leak to a card.
assert.equal(normalizeColor("흰색"), "Белый");
assert.equal(normalizeColor("검정색"), "Черный");
assert.equal(normalizeColor("하늘색"), "Голубой");
assert.equal(normalizeColor("네이비"), "Темно-синий");
assert.equal(normalizeColor("진주색"), "Перламутровый белый");
assert.equal(normalizeColor("매트 검정색"), "Матовый черный");
assert.equal(normalizeColor("투톤 베이지"), "Двухцветный бежевый");
assert.equal(normalizeColor("메탈릭 블루"), "Синий");
assert.equal(normalizeColor("Белый"), "Белый");
assert.equal(normalizeColor("이상한색"), null);
assert.equal(normalizeColor(null), null);

// Drive: Korean axle words and maker drivetrain badges must normalize the same
// way as the Latin W/D abbreviations.
assert.equal(normalizeDrive("4륜구동"), "4WD");
assert.equal(normalizeDrive("사륜"), "4WD");
assert.equal(normalizeDrive("풀타임 4륜"), "4WD");
assert.equal(normalizeDrive("전륜구동"), "FWD");
assert.equal(normalizeDrive("후륜"), "RWD");
assert.equal(normalizeDrive("2륜"), "2WD");
assert.equal(normalizeDrive("xDrive 20d"), "4WD");
assert.equal(normalizeDrive("ALL4 Classic"), "4WD");
assert.equal(normalizeDrive("4MATIC"), "4WD");
assert.equal(normalizeDrive("4MOTION"), "4WD");
assert.equal(normalizeDrive("HTRAC"), "4WD");
assert.equal(normalizeDrive("quattro"), "4WD");
assert.equal(normalizeDrive("Кузов"), null);
assert.equal(normalizeDrive(null), null);
assert.equal(translateDrive("전륜구동"), "Передний");
assert.equal(translateDrive("후륜"), "Задний");
assert.equal(translateDrive("2WD"), "2WD");
assert.equal(translateDrive("4WD"), "4WD");
assert.equal(translateDrive("передний-задний"), null);
assert.equal(translateDrive("неопределено"), null);
assert.equal(translateDrive(null), null);

// Encar body inspection uses Korean transliterations and side markers. Normalize
// these to the shared body map and translate the repair status instead of leaking
// source text into the Russian card.
assert.equal(normalizeEncarBodyPart("프론트 휀더(우)"), "fender_front_passenger");
assert.equal(normalizeEncarBodyPart("프론트 휀더(좌)"), "fender_front_driver");
assert.equal(normalizeEncarBodyPart("P033 리어 도어"), "door_rear_driver");
assert.equal(translateInspectionStatus("교환(교체)"), "Замена детали");
assert.equal(translateInspectionStatus("교환"), "Замена детали");

// A reference row that only knows "2WD" must still match a card that states a
// concrete axle, but must not stretch to full-wheel drive.
assert.equal(driveTypesCompatible("2WD", "FWD"), true);
assert.equal(driveTypesCompatible("2WD", "RWD"), true);
assert.equal(driveTypesCompatible("FWD", "2WD"), true);
assert.equal(driveTypesCompatible("4WD", "FWD"), false);
assert.equal(driveTypesCompatible("4WD", "4WD"), true);
assert.equal(driveTypesCompatible("2WD", null), true);
assert.equal(driveTypesCompatible(null, "FWD"), true);

// The expanded drive normalization must not break the verified power lookup:
// a front-wheel card still resolves against a "2WD" verified specification.
const seltos = resolvePower({
  brand: "Kia",
  model: "Seltos",
  fuelType: "gasoline",
  engineCc: 1598,
  driveType: "FWD",
});
assert.equal(seltos?.powerHp, 198);

console.log("vehicle normalization tests passed");
