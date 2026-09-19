import fs from "node:fs";

const input = process.env.AUTOHOME_MATCH_INPUT ?? "/tmp/tl-auto-autohome-ice-matches.json";
const output = process.env.AUTOHOME_BEST_FIT_OUTPUT ?? "/tmp/tl-auto-autohome-ice-best-fit.json";
const data = JSON.parse(fs.readFileSync(input, "utf8"));
type FitCandidate = { powerHp?: number | string | null };
type FitRow = { cards: number; decision: string; candidates?: FitCandidate[] };
const accepted: FitRow[] = [];
const blocked: FitRow[] = [];
for (const row of data.rows) {
  const usable = (row.candidates ?? []).filter((x: FitCandidate) => Number(x.powerHp) > 0);
  const counts = new Map<number, number>();
  for (const c of usable) counts.set(Number(c.powerHp), (counts.get(Number(c.powerHp)) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const unique = ranked.length === 1 && ranked[0];
  const modal = ranked[0] && ranked[0][1] / usable.length >= 0.75;
  const decision = unique ? "best_fit_unique" : modal ? "best_fit_modal" : "blocked";
  const result = { ...row, selectedPowerHp: unique || modal ? ranked[0][0] : null, decision, source: "AutoHome", sourceSpecCount: usable.length, powerDistribution: ranked.map(([power, count]) => ({ power, count })) };
  (decision === "blocked" ? blocked : accepted).push(result);
}
const sum = (rows: FitRow[]) => rows.reduce((n, r) => n + r.cards, 0);
const report = { totalCards: sum(data.rows), acceptedCards: sum(accepted), blockedCards: sum(blocked), acceptedGroups: accepted.length, blockedGroups: blocked.length, breakdown: { unique: sum(accepted.filter((r) => r.decision === "best_fit_unique")), modal: sum(accepted.filter((r) => r.decision === "best_fit_modal")) }, accepted, blocked };
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalCards: report.totalCards, acceptedCards: report.acceptedCards, blockedCards: report.blockedCards, acceptedGroups: report.acceptedGroups, blockedGroups: report.blockedGroups, breakdown: report.breakdown, output }, null, 2));
