import { normalizeModel } from "../normalization/vehicles";

/**
 * One place that decides how a source model name is written to the catalogue
 * and how two spellings are compared.
 *
 * The writers used to keep their own alias maps, which drifted: the publisher
 * mapped `avante` and `glb-class`, the importer mapped `1-series` and `x2 (f39)`.
 * A guard that compares model names must use the very mapping the writers use,
 * otherwise it either refuses legitimate rows or accepts wrong ones. Both the
 * writers and the audits import this module now.
 */
const DISPLAY_ALIASES: Record<string, string> = {
  avante: "AVANTE",
  canival: "Carnival",
  santafe: "Santa Fe",
  morning: "Morning",
  ray: "Ray",
  tiboli: "Tivoli",
  "x2 (f39)": "X2",
  "1-series": "1 Series",
  "2-series": "2 Series",
  "glb-class": "GLB-Class",
};

/** The value written to `cars.model`. */
export function displayModelName(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  return DISPLAY_ALIASES[raw.toLowerCase()] ?? raw;
}

/**
 * Comparison key for the same car written on two sides. Latin aliases are
 * applied first, then the shared Korean-to-Latin normalization, so `1-Series`
 * and `1 Series`, or `TIBOLI` and `Tivoli`, compare equal.
 */
export function canonicalModelKey(value: string | null | undefined): string | null {
  const displayed = displayModelName(value);
  if (!displayed) return null;
  const normalized = normalizeModel(displayed) ?? displayed;
  return normalized.toLowerCase().replace(/[\s_-]+/g, "") || null;
}
