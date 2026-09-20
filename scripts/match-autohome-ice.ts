import fs from "node:fs";
import { matchCardGroup, type AutoHomeSpec } from "../src/server/catalog/autohome-match";

/**
 * Matches AutoHome specifications against catalogue card groups.
 *
 * The matching rules live in `src/server/catalog/autohome-match.ts` so they are
 * covered by tests, and the normalisation of displacement, fuel and drive layout
 * is shared with the rest of the system through
 * `src/server/power-resolution/canonical.ts`. This script only reads the source
 * dump, calls the ladder and writes the report.
 *
 * The report now carries the reason as well: which features matched, which one
 * blocked, and at which year tier the match was reached. That is what makes it
 * possible to see whether candidates are lost to the year, the displacement, the
 * drive layout or an ambiguous power, instead of guessing.
 */
const input = process.env.AUTOHOME_INPUT ?? "/tmp/tl-auto-autohome-ice-v2.json";
const output = process.env.AUTOHOME_MATCH_OUTPUT ?? "/tmp/tl-auto-autohome-ice-matches.json";
const data = JSON.parse(fs.readFileSync(input, "utf8"));

type Group = {
  model_year: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  drive_type: string | null;
  trim: string | null;
  cards: number;
  [key: string]: unknown;
};

const rows: Array<Record<string, unknown>> = [];
for (const series of data.series as Array<{ seriesId: unknown; key: unknown; groups: Group[]; specs: AutoHomeSpec[] }>) {
  for (const group of series.groups) {
    const result = matchCardGroup({
      model_year: group.model_year,
      engine_cc: group.engine_cc,
      fuel_type: group.fuel_type,
      drive_type: group.drive_type,
      trim: group.trim,
    }, series.specs ?? []);

    rows.push({
      ...group,
      seriesId: series.seriesId,
      sourceKey: series.key,
      candidateCount: result.usable.length,
      powers: result.powers,
      status: result.status,
      yearTier: result.yearTier,
      matchedFeatures: result.matchedFeatures,
      failedFeature: result.failedFeature,
      rejectionCounts: result.rejectionCounts,
      candidates: result.usable.slice(0, 20).map((spec) => ({
        name: spec.name, year: spec.year, powerHp: spec.powerHp, drive: spec.drive, engineGroup: spec.engineGroup, specId: spec.specId,
      })),
    });
  }
}

const counts = rows.reduce<Record<string, number>>((map, row) => {
  const status = String(row.status);
  map[status] = (map[status] ?? 0) + Number(row.cards ?? 0);
  return map;
}, {} as Record<string, number>);
const groups = rows.reduce<Record<string, number>>((map, row) => {
  const status = String(row.status);
  map[status] = (map[status] ?? 0) + 1;
  return map;
}, {} as Record<string, number>);
const failedFeatures = rows.reduce<Record<string, number>>((map, row) => {
  if (!row.failedFeature) return map;
  const feature = String(row.failedFeature);
  map[feature] = (map[feature] ?? 0) + Number(row.cards ?? 0);
  return map;
}, {} as Record<string, number>);
const yearTiers = rows.reduce<Record<string, number>>((map, row) => {
  if (!row.yearTier) return map;
  const tier = String(row.yearTier);
  map[tier] = (map[tier] ?? 0) + Number(row.cards ?? 0);
  return map;
}, {} as Record<string, number>);

const totalCards = rows.reduce((sum, row) => sum + Number(row.cards ?? 0), 0);
fs.writeFileSync(output, JSON.stringify({ input, totalCards, counts, groups, failedFeatures, yearTiers, rows }, null, 2));
console.log(JSON.stringify({ totalCards, counts, groups, failedFeatures, yearTiers, output }, null, 2));
