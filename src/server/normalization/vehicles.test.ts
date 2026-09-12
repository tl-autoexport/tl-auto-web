import assert from "node:assert/strict";
import {
  driveTypesCompatible,
  normalizeColor,
  normalizeDrive,
  resolvePower,
} from "./vehicles";

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
assert.equal(normalizeDrive("4MATIC"), "4WD");
assert.equal(normalizeDrive("4MOTION"), "4WD");
assert.equal(normalizeDrive("HTRAC"), "4WD");
assert.equal(normalizeDrive("quattro"), "4WD");
assert.equal(normalizeDrive("Кузов"), null);
assert.equal(normalizeDrive(null), null);

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
