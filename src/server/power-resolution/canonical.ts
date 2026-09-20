/**
 * Canonical representation for the power-resolution path only.
 *
 * The staging payload and the approved power reference describe the same car
 * with different spellings: Korean model names, generation codes inside or
 * outside parentheses, and badge/trim values stored in different columns.
 * Matching both sides through this module keeps one physical configuration
 * from being counted as several.
 *
 * This module is deliberately additive. It does not change
 * `normalizeBrand`/`normalizeModel`/`normalizeDrive` in
 * `src/server/normalization/vehicles.ts`, because those functions are shared
 * with the Encar import, the public catalog and the site. Callers that want the
 * canonical behaviour opt in explicitly.
 */

import {
  normalizeBrand,
  normalizeDrive,
  normalizeFuel,
  normalizeModel,
} from "../normalization/vehicles";
import type { ApprovedPowerCandidate } from "./resolver";

/** Model spellings that the shared normalizer intentionally leaves untouched. */
const MODEL_ALIASES: Record<string, string> = {
  avante: "Elantra",
  canival: "Carnival",
  tiboli: "Tivoli",
  "1-series": "1 Series",
  "2-series": "2 Series",
  "티구안 2세대": "Tiguan",
  티구안: "Tiguan",
  파사트: "Passat",
  골프: "Golf",
  제타: "Jetta",
  말리부: "Malibu",
  "ioniq5": "Ioniq 5",
  "ioniq 5": "Ioniq 5",
  "ioniq6": "Ioniq 6",
  "ioniq 6": "Ioniq 6",
  "ev 5": "EV5",
  "ev5": "EV5",
  "st 1": "ST1",
  "st1": "ST1",
};

const GENERATION_CODE = /^[A-Z]{1,4}\d{1,4}[A-Z]{0,2}$/;

export function canonicalModel(value: unknown): string | null {
  const normalized = normalizeModel(value);
  if (normalized == null) return null;
  const key = String(normalized).trim().toLowerCase();
  return MODEL_ALIASES[key] ?? normalized;
}

/**
 * Generation is stored as a code (`U11`, `F48`, `NX4`) or as a free-form
 * Korean/English name (`더 뉴 쏘렌토 4세대`). A parenthesised code wins, so
 * `X1 (U11)` and `U11` describe the same generation while `X1 (F48)` does not.
 * Without a recognisable code the value is only case/spacing normalised, which
 * keeps the previous behaviour for free-form names.
 */
export function canonicalGeneration(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parenthesised = raw.match(/\(([^)]+)\)/);
  const candidate = (parenthesised ? parenthesised[1] : raw)
    .toUpperCase()
    .replace(/[\s_-]/g, "");
  if (GENERATION_CODE.test(candidate)) return candidate;
  return raw.toLowerCase().replace(/[\s_\-–—]+/g, " ").trim() || null;
}

export function canonicalBadge(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.toLowerCase().replace(/[\s_\-–—]+/g, " ").trim() || null;
}

function canonicalCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, "") || null;
}

export type CanonicalVehicleInput = {
  brand: string | null;
  model: string | null;
  generation: string | null;
  trim: string | null;
  badge: string | null;
  modelCode: string | null;
  engineCode: string | null;
  fuelType: string | null;
  driveType: string | null;
  year: number | null;
  engineCc: number | null;
};

export type VehicleInputFields = {
  brand?: unknown;
  model?: unknown;
  generation?: unknown;
  trim?: unknown;
  badge?: unknown;
  modelCode?: unknown;
  engineCode?: unknown;
  fuelType?: unknown;
  driveType?: unknown;
  year?: unknown;
  engineCc?: unknown;
};

/** Canonicalises a card (staging row or payload) into a resolver input. */
export function canonicalInput(fields: VehicleInputFields): CanonicalVehicleInput {
  const badge = fields.badge ?? fields.trim ?? null;
  const trim = fields.trim ?? fields.badge ?? null;
  return {
    brand: normalizeBrand(fields.brand),
    model: canonicalModel(fields.model),
    generation: canonicalGeneration(fields.generation),
    trim: canonicalBadge(trim),
    badge: canonicalBadge(badge),
    modelCode: canonicalCode(fields.modelCode),
    engineCode: canonicalCode(fields.engineCode),
    fuelType: normalizeFuel(fields.fuelType),
    driveType: normalizeDrive(fields.driveType),
    year: fields.year == null || fields.year === "" ? null : Number(fields.year),
    engineCc: fields.engineCc == null || fields.engineCc === "" ? null : Number(fields.engineCc),
  };
}

/**
 * Canonicalises an approved reference candidate. Both sides of the comparison
 * must go through the same canonicalisation, otherwise a rule can never match
 * a card that spells the same configuration differently.
 */
export function canonicalCandidate(candidate: ApprovedPowerCandidate): ApprovedPowerCandidate {
  const match = candidate.match;
  return {
    ...candidate,
    match: {
      ...match,
      brand: normalizeBrand(match.brand) ?? match.brand,
      model: canonicalModel(match.model) ?? match.model,
      generation: canonicalGeneration(match.generation),
      trim: canonicalBadge(match.trim),
      badgeNormalized: canonicalBadge(match.badgeNormalized),
      modelCode: canonicalCode(match.modelCode),
      engineCode: canonicalCode(match.engineCode),
      fuelType: normalizeFuel(match.fuelType),
      driveType: normalizeDrive(match.driveType),
    },
  };
}

export function canonicalCandidates(candidates: ApprovedPowerCandidate[]): ApprovedPowerCandidate[] {
  return candidates.map(canonicalCandidate);
}

/** Stable identity for grouping reports by configuration. */
export function configurationKey(input: CanonicalVehicleInput): string {
  return [
    input.brand ?? "?",
    input.model ?? "?",
    input.generation ?? "-",
    input.trim ?? input.badge ?? "-",
    input.year ?? "?",
    input.engineCc ?? "?",
    input.fuelType ?? "?",
    input.driveType ?? "-",
  ].join(" | ");
}

/**
 * Engine displacement as one number, whatever the source wrote.
 *
 * Sources spell the same engine as `1598`, `1.6`, `1.598L`, `1.6T` or
 * `1,598 cc`. A bare four-digit number is cubic centimetres; a number below ten
 * is litres. Anything else is left unknown rather than guessed, so a value that
 * cannot be read never silently becomes a match.
 */
export function canonicalEngineCc(value: unknown): number | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;

  // Explicit cubic centimetres anywhere in the text: 1,598 cc, 1598毫升.
  const explicitCc = text.match(/(\d{1,2}[,.]?\d{3})\s*(?:cc|毫升)/);
  if (explicitCc) return Math.round(Number(explicitCc[1].replace(",", "")));

  // A leading decimal is litres: 1.6, 1.598l, 1.6t, 2.0 柴油, 1.6升.
  // Anchored on purpose: an unanchored pattern read the tail of `1.598l` as `8l`.
  const litres = text.match(/^(\d[.,]\d{1,3})(?![.,]?\d)/);
  if (litres) {
    const parsed = Number(litres[1].replace(",", "."));
    if (parsed >= 0.6 && parsed <= 8) return Math.round(parsed * 1000);
  }

  // A standalone four-digit number, also at the end of a longer label
  // (`Prestige 1598`), which is how the sources write the engine group.
  const trailing = text.match(/(?:^|\s)(\d{3,4})$/);
  return trailing ? Number(trailing[1]) : null;
}

/**
 * Drive layout as one of three explicit values, or generic two-wheel drive.
 *
 * `FWD` and `RWD` must stay distinguishable: collapsing them lets a rear-wheel
 * car take the power of the front-wheel version of the same engine. Korean and
 * Chinese spellings are recognised because both appear in our sources.
 *
 * `TWO_WHEEL_GENERIC` covers `2WD` without an axle stated, and `null` means the
 * source said nothing. Both are compatible with either explicit value, only a
 * conflict between two explicit different layouts is a real conflict.
 */
export type DriveGroup = "FWD" | "RWD" | "AWD" | "TWO_WHEEL_GENERIC" | null;

export function canonicalDriveGroup(value: unknown): DriveGroup {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;

  const allWheel = /awd|4wd|4x4|四驱|四轮|4륜|사륜|상시사륜|전자식사륜/;
  if (allWheel.test(text)) return "AWD";

  const front = /fwd|前驱|前置前驱|전륜|앞바퀴|ff\b/;
  if (front.test(text)) return "FWD";

  const rear = /rwd|后驱|후륜|뒷바퀴|fr\b/;
  if (rear.test(text)) return "RWD";

  if (/2wd|two.?wheel/i.test(text)) return "TWO_WHEEL_GENERIC";

  return null;
}

/**
 * Compatibility rule for the drive layout: an unknown or generic value never
 * blocks, only two explicit and different layouts do.
 */
export function driveGroupsCompatible(source: DriveGroup, target: DriveGroup): boolean {
  if (source == null || target == null) return true;
  if (source === "TWO_WHEEL_GENERIC" || target === "TWO_WHEEL_GENERIC") return true;
  return source === target;
}
