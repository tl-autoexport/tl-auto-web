import type { ResolveInput } from "../power/types.js";

const MODEL_ALIASES: Record<string, string> = {
  avante: "elantra", canival: "carnival", santafe: "santa fe", tiboli: "tivoli",
  "1-series": "1 series", "2-series": "2 series", 티구안: "tiguan", 파사트: "passat",
  골프: "golf", 제타: "jetta", 말리부: "malibu", ioniq5: "ioniq 5", ioniq6: "ioniq 6",
  ev5: "ev 5", st1: "st 1", 토레스: "torres", 투아렉: "touareg", 파나메라: "panamera",
};
const BRAND_ALIASES: Record<string, string> = { hyundai: "hyundai", genesis: "genesis", kgm: "kgm", "ssangyong": "kgm", "kg mobility ssangyong": "kgm", "kg mobility": "kgm", "mercedes benz": "mercedes-benz", benz: "mercedes-benz", "renault koreasamsung": "renault korea", "renault-koreasamsung": "renault korea" };
const FUEL_ALIASES: Record<string, string> = { petrol: "gasoline", gas: "gasoline", 가솔린: "gasoline", 디젤: "diesel", 경유: "diesel", 전기: "electric", 하이브리드: "hybrid" };
const TRIM_ALIASES: Array<[RegExp, string]> = [
  [/디\s*에센셜/g, "the essential"], [/더\s*에센셜/g, "the essential"],
  [/프레스티지/g, "prestige"], [/아방가르드/g, "avantgarde"], [/익스클루시브/g, "exclusive"],
  [/프리미엄/g, "premium"], [/콰트로/g, "quattro"], [/쿠페/g, "coupe"], [/세단/g, "sedan"],
  [/스포츠/g, "sport"], [/프로/g, "pro"], [/가솔린/g, "gasoline"], [/디젤/g, "diesel"],
  [/터보/g, "turbo"], [/밴/g, "van"], [/4도어/g, "4 door"],
];

export function normalText(value: unknown): string | null {
  const text = String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s_–—]+/g, " ").replace(/\s+/g, " ");
  return text || null;
}
export function canonicalBrand(value: unknown): string | null { const n = normalText(value); return n ? (BRAND_ALIASES[n] ?? n) : null; }
export function canonicalModel(value: unknown): string | null {
  const n = normalText(value); if (!n) return null;
  const withoutGeneration = n.replace(/\s+\(?[a-z]?\d{1,2}\)?세대$/i, "").replace(/\s+\([a-z]{1,3}\d{1,3}\)$/i, "").replace(/\s+\(\d{3}\)$/i, "").trim();
  return MODEL_ALIASES[n] ?? MODEL_ALIASES[withoutGeneration] ?? withoutGeneration;
}
export function canonicalGeneration(value: unknown): string | null {
  const raw = normalText(value); if (!raw) return null;
  const paren = raw.match(/\(([^)]+)\)/); const candidate = (paren?.[1] ?? raw).toUpperCase().replace(/[\s_-]/g, "");
  return /^[A-Z]{1,4}\d{1,4}[A-Z]{0,2}$/.test(candidate) ? candidate : raw;
}
export function canonicalCode(value: unknown): string | null { const n = normalText(value); return n ? n.replace(/\s+/g, "").toUpperCase() : null; }
export function canonicalFuel(value: unknown): string | null { const n = normalText(value); return n ? (FUEL_ALIASES[n] ?? n) : null; }
export function canonicalMarket(value: unknown): string | null {
  const n = normalText(value); if (!n) return null;
  const aliases: Record<string, string> = { kr: "KR", korea: "KR", "south korea": "KR", 대한민국: "KR", ko: "KR", us: "US", usa: "US", "united states": "US", uk: "GB", gb: "GB", "united kingdom": "GB", germany: "DE", deutschland: "DE", de: "DE", eu: "EU", europe: "EU" };
  return aliases[n] ?? n.toUpperCase();
}
export function canonicalTrim(value: unknown): string | null {
  let n = normalText(value); if (!n) return null;
  for (const [pattern, replacement] of TRIM_ALIASES) n = n.replace(pattern, replacement);
  return n.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
}
export function canonicalDrive(value: unknown): "FWD" | "RWD" | "AWD" | "2WD" | null {
  const n = normalText(value) ?? "";
  if (/awd|4wd|4x4|四驱|사륜/.test(n)) return "AWD";
  if (/fwd|前驱|전륜|\bff\b/.test(n)) return "FWD";
  if (/rwd|后驱|후륜|\bfr\b/.test(n)) return "RWD";
  if (/2wd|two.?wheel/.test(n)) return "2WD";
  return null;
}
export function canonicalInput(input: ResolveInput) {
  const trim = input.trim ?? input.badge ?? "";
  const sourceMarket = input.correlation?.source?.toLowerCase() === "encar" ? "KR" : undefined;
  return { brand: canonicalBrand(input.brand), model: canonicalModel(input.model), generation: canonicalGeneration(input.generation), trim: canonicalTrim(input.trim), badge: canonicalTrim(input.badge), modelCode: canonicalCode(input.modelCode), engineCode: canonicalCode(input.engineCode), fuelType: canonicalFuel(input.fuelType), driveType: canonicalDrive(input.driveType) ?? canonicalDrive(trim), market: canonicalMarket(input.market ?? sourceMarket), year: input.year ?? null, engineCc: input.engineCc ?? null, ...(input.powertrain ? { powertrain: input.powertrain } : {}), ...(input.hybridTopology ? { hybridTopology:input.hybridTopology } : {}) };
}
