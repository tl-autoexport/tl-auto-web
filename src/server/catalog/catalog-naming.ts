/** Proposed display rules. Not connected to public cards until the UI implementation step. */
import rules from "../../../data/catalog-naming/label-rules-v1.json";
import { normalizeBrand, normalizeModel } from "../normalization/vehicles";

export const namingRulesVersion = rules.version;
export const namingKey = (value: string | null | undefined) => (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const hangul = /[\u3131-\u318e\uac00-\ud7a3]/;
export const containsKoreanName = (value: string) => hangul.test(value);
export function isAbsentName(value: string | null | undefined) {
  const s = (value ?? "").trim();
  return !s || /^(?:-|unknown|null|undefined|n\/a|\(?세부등급 없음\)?|trim not specified|not specified)$/i.test(s);
}
export function sourceGenerationOrdinal(value: string): number | null {
  const raw=value.trim();
  const numeric=raw.match(/^(\d+)(?:(?:st|nd|rd|th)\.?(?:\s+generation)?|\s*세대)$/i);
  if(numeric)return Number(numeric[1]);
  const word=raw.match(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+generation$/i)?.[1]?.toLowerCase();
  return word ? ["first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth"].indexOf(word)+1 : null;
}
export const isOrdinalOnlyName = (value: string) => sourceGenerationOrdinal(value)!==null;

export function normalizeVehicleName(value: string | null | undefined): string | null {
  if (isAbsentName(value)) return null;
  let s = value!.trim().replace(/_/g, " ");
  for (const [word, replacement] of Object.entries(rules.koreanWords).sort((a,b) => b[0].length-a[0].length)) {
    s = s.split(word).join(replacement);
  }
  s = s.replace(/\bCanival\b/gi,"Carnival").replace(/\bSantafe\b/gi,"Santa Fe")
    .replace(/\b(\d)-Series\b/gi,"$1 Series")
    .replace(/\bgasoline\b/gi,"Бензин").replace(/\bdiesel\b/gi,"Дизель").replace(/\bhybrid\b/gi,"Гибрид")
    .replace(/\b(?:e[ -]?vgt)\b/gi,"e-VGT")
    .replace(/(\d+)\s*(?:seaters?|seats?|인승)/gi,"$1 мест")
    .replace(/(\d+)\s*door/gi,"$1 дверей")
    .replace(/\b(?:m[ -]sport)\b/gi,"M Sport").replace(/\bs[ -]line\b/gi,"S Line")
    .replace(/\br[ -]line\b/gi,"R-Line").replace(/\bN[ -]line\b/gi,"N Line")
    .replace(/\s+/g," ").replace(/\(\s*\)/g,"").trim();
  if (!s || hangul.test(s)) return null;
  const tokens = rules.tokens as Record<string,string>;
  return s.split(/(\s+|[(),/])/).map(word => {
    if (!word || /^[\s(),/]+$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (tokens[lower]) return tokens[lower];
    if (lower === "e-vgt") return "e-VGT";
    const badge=word.match(/^([a-z]{1,3})(\d{2,3})([dieh]?)$/i);
    if(badge)return badge[1].toUpperCase()+badge[2]+badge[3].toLowerCase();
    if (/^\d{3}[di]$/i.test(word)) return lower;
    if (/^\d+(?:\.\d+)?t$/i.test(word)) return lower.slice(0,-1)+"T";
    if (/^[a-z]{1,3}\d{1,3}[a-z]?$/i.test(word)) return word.toUpperCase();
    if (lower === "мест" || lower === "дверей") return lower;
    if (/^(бензин|дизель|гибрид|электро)$/i.test(word)) return lower.charAt(0).toUpperCase()+lower.slice(1);
    return word.charAt(0).toUpperCase()+word.slice(1).toLowerCase();
  }).join("");
}

export function canonicalCatalogBrand(value: string | null | undefined) {
  const aliases = rules.brandAliases as Record<string,string>;
  const normalized = normalizeBrand(value) ?? value;
  return aliases[namingKey(value)] ?? aliases[namingKey(normalized)] ?? normalizeVehicleName(normalized);
}

export function canonicalCatalogModel(value: string | null | undefined) {
  const aliases = rules.modelAliases as Record<string,string>;
  const normalized = normalizeModel(value) ?? value;
  return aliases[namingKey(value)] ?? aliases[namingKey(normalized)] ?? normalizeVehicleName(normalized);
}

export function generationPresentation(raw: string, english: string | null, model: string, approvedCode?: string | null) {
  const fullName = normalizeVehicleName(english) ?? normalizeVehicleName(raw);
  const bracket = [...raw.matchAll(/\(([^)]+)\)/g)].flatMap(m => m[1].split(/[,/]/)).map(s => s.replace(/_/g,"").trim());
  const codes = bracket.filter(s => /^(?:[A-Z]{1,4}\d{1,3}[A-Z]?|AD|HD|MD|HG|TG|YF|LF|JA|TA|TAM|DM|CM|UM|JM|LM)$/i.test(s));
  const standingCode = raw.match(/\b([CWFGU]\d{2,3}|AD|HD|MD|HG|TG|YF|LF|JA|TA|TAM|DM|CM|UM|JM|LM)\b/i)?.[1];
  if (!codes.length && standingCode && namingKey(standingCode)!==namingKey(model)) codes.push(standingCode);
  if (!codes.length && approvedCode && /^[a-z]{1,4}\d{0,3}$/i.test(approvedCode)) codes.push(approvedCode);
  const chassis = [...new Set(codes.map(s => s.toUpperCase()))];
  const ordinal = raw.match(/(\d+)\s*세대/)?.[1] ?? english?.match(/\b(\d+)(?:st|nd|rd|th)\s+generation\b/i)?.[1];
  const display = chassis.length ? chassis.join(" / ") : ordinal ? `${ordinal}-е поколение` : null;
  return { fullName: fullName ?? (chassis.length ? `${model} (${chassis.join(" / ")})` : ordinal ? `${model}, ${ordinal}-е поколение` : null), display,
    chassisCodes: chassis, ordinal: ordinal ? Number(ordinal) : null, facelift: null };
}

export function splitVersionName(raw: string | null | undefined, brand: string) {
  const label = normalizeVehicleName(raw);
  if (!label) return { modification: null, trim: null };
  const suffixes = (rules.trimSuffixes as Record<string,string[]>)[brand] ?? [];
  for (const suffix of [...suffixes].sort((a,b) => b.length-a.length)) {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const match = label.match(new RegExp(`(?:^|\\s)(${escaped})$`,"i"));
    if (!match) continue;
    return { modification: label.slice(0,match.index).trim() || null, trim: suffix };
  }
  return { modification: label, trim: null };
}

export function looksLikeModification(label: string) {
  return /(?:бензин|дизель|гибрид|электро)/i.test(label) || /\b(?:gasoline|diesel|hybrid|awd|[24]wd|xdrive|sdrive|4matic)\b/i.test(label) ||
    /^\d+(?:\.\d+)?(?:T)?(?:\s|$)/i.test(label) || /^\d{3}[di]\b/i.test(label) || /^[A-Z]{1,3}\d{2,3}[dieh]?\b/i.test(label) || /^[DT][3-8](?:\s|$)/i.test(label);
}

export function compactModificationName(label: string | null) {
  return label?.replace(/(?:Бензин|Дизель)\s*/g,"").replace(/(\d+(?:\.\d+)?)\s+Turbo\b/gi,"$1T").replace(/\s+/g," ").trim() || null;
}
