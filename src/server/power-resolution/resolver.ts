/**
 * Deterministic matching for the TL Auto power reference.
 *
 * This module is intentionally independent from the legacy Encar maps. A
 * reference value may enter the calculation path only after the underlying
 * specification and evidence have been approved. Any unresolved or tied
 * result stays transparent instead of being guessed from engine displacement.
 */

import { driveTypesCompatible } from "../normalization/vehicles";

export type PowerConfidence = "official" | "high" | "automatic";
export type PowerBasis = "combustion_engine" | "electric_30min" | "parallel_sum";

export type PowerReferenceInput = {
  brand: string | null;
  model: string | null;
  generation?: string | null;
  trim?: string | null;
  badge?: string | null;
  modelCode?: string | null;
  engineCode?: string | null;
  fuelType?: string | null;
  driveType?: string | null;
  year?: number | null;
  engineCc?: number | null;
};

export type ApprovedPowerCandidate = {
  specId: string;
  specVersion: number;
  calculationPowerKw: number;
  powerBasis: PowerBasis;
  sourcePriority: number;
  evidenceId: string;
  evidenceKind: "sbkts" | "otts" | "epts" | "manufacturer_document" | "vin_decoder" | "manual";
  evidenceVerificationStatus: "approved" | "draft" | "review_required" | "rejected";
  evidenceReliability: "unreviewed" | "low" | "medium" | "high" | "verified";
  match: {
    id: string;
    priority: number;
    brand: string;
    model: string;
    generation?: string | null;
    trim?: string | null;
    badgeNormalized?: string | null;
    modelCode?: string | null;
    engineCode?: string | null;
    fuelType?: string | null;
    driveType?: string | null;
    productionYearFrom?: number | null;
    productionYearTo?: number | null;
    engineCcFrom?: number | null;
    engineCcTo?: number | null;
  };
};

export type PowerResolutionResult =
  | {
      status: "matched";
      confidence: PowerConfidence;
      candidate: ApprovedPowerCandidate;
      reason: string;
      candidates: ApprovedPowerCandidate[];
    }
  | {
      status: "review_required";
      reason: string;
      candidates: ApprovedPowerCandidate[];
    };

function normal(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—]+/g, " ");
  return normalized
    .replace(/^santafe$/, "santa fe")
    .replace(/^elantra$/, "avante")
    .replace(/^ioniq5$/, "ioniq 5")
    .replace(/^ioniq6$/, "ioniq 6");
}

function exactOrUnrestricted(value: string | null | undefined, input: string | null | undefined) {
  return !value || normal(value) === normal(input);
}

function rangeOrUnrestricted(value: number | null | undefined, from: number | null | undefined, to: number | null | undefined) {
  if (from == null && to == null) return true;
  if (value == null) return false;
  return (from == null || value >= from) && (to == null || value <= to);
}

function matchesInput(candidate: ApprovedPowerCandidate, input: PowerReferenceInput) {
  const match = candidate.match;
  return (
    normal(match.brand) === normal(input.brand) &&
    normal(match.model) === normal(input.model) &&
    exactOrUnrestricted(match.generation, input.generation) &&
    exactOrUnrestricted(match.trim, input.trim) &&
    exactOrUnrestricted(match.badgeNormalized, input.badge) &&
    exactOrUnrestricted(match.modelCode, input.modelCode) &&
    exactOrUnrestricted(match.engineCode, input.engineCode) &&
    exactOrUnrestricted(match.fuelType, input.fuelType) &&
    driveTypesCompatible(match.driveType, input.driveType) &&
    rangeOrUnrestricted(input.year, match.productionYearFrom, match.productionYearTo) &&
    rangeOrUnrestricted(input.engineCc, match.engineCcFrom, match.engineCcTo)
  );
}

function specificity(candidate: ApprovedPowerCandidate) {
  const match = candidate.match;
  return [
    match.generation,
    match.trim,
    match.badgeNormalized,
    match.modelCode,
    match.engineCode,
    match.fuelType,
    match.driveType,
    match.productionYearFrom ?? match.productionYearTo,
    match.engineCcFrom ?? match.engineCcTo,
  ].filter((value) => value != null && value !== "").length;
}

function confidenceFor(candidate: ApprovedPowerCandidate): PowerConfidence {
  if (
    candidate.evidenceReliability === "verified" &&
    ["sbkts", "otts", "epts"].includes(candidate.evidenceKind)
  ) {
    return "official";
  }
  return "high";
}

/**
 * Chooses a power value only when the best approved match is unique. A more
 * specific match wins over a generic brand/model range; a lower source
 * priority breaks a remaining tie only when it is itself unique.
 */
export function resolveApprovedPower(
  input: PowerReferenceInput,
  candidates: ApprovedPowerCandidate[],
): PowerResolutionResult {
  const approved = candidates.filter(
    (candidate) => candidate.evidenceVerificationStatus === "approved" && matchesInput(candidate, input),
  );
  if (!approved.length) {
    return {
      status: "review_required",
      reason: "Нет подтверждённой спецификации для конфигурации автомобиля.",
      candidates: [],
    };
  }

  const topSpecificity = Math.max(...approved.map(specificity));
  const mostSpecific = approved.filter((candidate) => specificity(candidate) === topSpecificity);
  const topPriority = Math.min(...mostSpecific.map((candidate) => candidate.sourcePriority));
  const preferred = mostSpecific.filter((candidate) => candidate.sourcePriority === topPriority);

  if (preferred.length !== 1) {
    return {
      status: "review_required",
      reason: "Найдено несколько равнозначных подтверждённых спецификаций; требуется проверка комплектации.",
      candidates: preferred,
    };
  }

  const candidate = preferred[0];
  return {
    status: "matched",
    confidence: confidenceFor(candidate),
    candidate,
    reason: `Однозначное совпадение: ${specificity(candidate)} уточняющих признаков, приоритет источника ${candidate.sourcePriority}.`,
    candidates: approved,
  };
}
