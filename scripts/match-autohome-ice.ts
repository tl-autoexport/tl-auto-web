import fs from "node:fs";

const input = process.env.AUTOHOME_INPUT ?? "/tmp/tl-auto-autohome-ice-v2.json";
const output = process.env.AUTOHOME_MATCH_OUTPUT ?? "/tmp/tl-auto-autohome-ice-matches.json";
const data = JSON.parse(fs.readFileSync(input, "utf8"));

function ccFrom(text: string) {
  const liters = text.match(/(\d+(?:\.\d+)?)\s*(?:升|L|T)\b/i);
  if (liters) return Math.round(Number(liters[1]) * 1000);
  const cc = text.match(/(\d{3,4})\s*(?:cc|毫升)/i);
  return cc ? Number(cc[1]) : null;
}
function driveCompatible(source: string | null, ah: string | null) {
  if (!source || !ah) return true;
  const four = /4WD|四驱|四轮驱动/i.test(source);
  const ahFour = /四驱|四轮/i.test(ah);
  return four === ahFour;
}
function nameTokens(value: string | null) {
  return new Set((value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((x: string) => x.length >= 2));
}
function trimCompatible(trim: string | null, names: string[]) {
  const tokens = [...nameTokens(trim)].filter((token) => !new Set(["4matic", "xdrive", "sdrive", "line", "premium", "luxury", "sport", "classic", "edition", "favoured", "signature", "noblesse", "core", "se", "re"]).has(token));
  if (!tokens.length) return true;
  return names.some((name) => tokens.some((token) => name.toLowerCase().includes(token)));
}
function hasBadgeHint(trim: string | null) {
  return /(?:\b(?:gti|tdi|tfsi|td4|all4|xdrive|sdrive)\b|\b[a-z]{1,3}\s?\d{2,3}[a-z]*\b|\b[dp]\d{3}\b)/i.test(trim ?? "");
}

const rows: any[] = [];
for (const series of data.series) {
  for (const group of series.groups) {
    const candidates = (series.specs as any[]).filter((spec) => {
      if (group.model_year && spec.year && Math.abs(Number(spec.year) - Number(group.model_year)) > 1) return false;
      if (group.engine_cc) {
        const cc = ccFrom(`${spec.engineGroup ?? ""} ${spec.name ?? ""}`);
        if ((!cc || Math.abs(cc - Number(group.engine_cc)) > 80) && !(hasBadgeHint(group.trim) && trimCompatible(group.trim, [spec.name, spec.engineGroup]))) return false;
      }
      if (!driveCompatible(group.drive_type, spec.drive)) return false;
      const specText = `${spec.name ?? ""} ${spec.engineGroup ?? ""}`;
      if (group.fuel_type === "디젤" && /汽油|汽油机|燃油类型/.test(specText) && !/柴油|d[ií]esel/i.test(specText)) return false;
      if (group.fuel_type === "가솔린" && /柴油|d[ií]esel/i.test(specText)) return false;
      return true;
    });
    const trimmed = candidates.filter((spec) => trimCompatible(group.trim, [spec.name, spec.engineGroup]));
    const usable = trimmed.length ? trimmed : candidates;
    const powers = [...new Set(usable.map((x) => Number(x.powerHp)).filter((x) => Number.isFinite(x) && x > 0))];
    const status = powers.length === 1 && usable.length > 0 ? (trimmed.length ? "high_confidence" : "review") : powers.length > 1 ? "ambiguous" : "no_match";
    rows.push({ ...group, seriesId: series.seriesId, sourceKey: series.key, candidateCount: usable.length, powers, status, candidates: usable.slice(0, 20).map((x) => ({ name: x.name, year: x.year, powerHp: x.powerHp, drive: x.drive, engineGroup: x.engineGroup, specId: x.specId })) });
  }
}
const counts = rows.reduce((m, row) => { m[row.status] = (m[row.status] ?? 0) + row.cards; return m; }, {} as Record<string, number>);
const groups = rows.reduce((m, row) => { m[row.status] = (m[row.status] ?? 0) + 1; return m; }, {} as Record<string, number>);
fs.writeFileSync(output, JSON.stringify({ input, totalCards: rows.reduce((n, r) => n + r.cards, 0), counts, groups, rows }, null, 2));
console.log(JSON.stringify({ totalCards: rows.reduce((n, r) => n + r.cards, 0), counts, groups, output }, null, 2));
