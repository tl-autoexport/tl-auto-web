/** Correct one saved Danawa observation where the RPM ceiling was parsed as PS. */
import { copyFile, readFile, writeFile } from "node:fs/promises";

const runId = process.env.TL_AUTO_ENRICHMENT_RUN_ID?.trim();
if (!runId) throw new Error("TL_AUTO_ENRICHMENT_RUN_ID is required");
const danawaPath = process.env.DANAWA_POWER_OUTPUT ?? `output/tl-auto-run-${runId}-danawa-power.json`;
const reconciliationPath = process.env.TL_AUTO_SOURCE_RECONCILIATION ??
  `output/tl-auto-run-${runId}-source-reconciliation.json`;
const listingId = "42835734";
const correctionUrl = "https://auto.danawa.com/auto/?Work=model&Model=4471&Tab=spec&Lineup=53607";
const note = "Danawa displays maximum output as 381/5,800~6,100 ps/rpm; 381 is PS and 6,100 is the RPM ceiling. Confirmed from the reviewed Danawa specification screenshot.";

type Candidate = Record<string, any>;
type Result = Record<string, any>;

async function load(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
}
function recompute(report: Record<string, any>) {
  const statuses = ["preliminary_candidate", "review_multiple_powers", "unmapped_model",
    "no_compatible_year_or_lineup", "no_matching_specification"];
  report.classifications = Object.fromEntries(statuses.map((status) =>
    [status, report.results.filter((row: Result) => row.classification === status).length]));
  report.classificationListings = Object.fromEntries(statuses.map((status) =>
    [status, report.results.filter((row: Result) => row.classification === status)
      .reduce((sum: number, row: Result) => sum + Number(row.listingCount ?? 0), 0)]));
}

async function main() {
  const [danawa, reconciliation] = await Promise.all([load(danawaPath), load(reconciliationPath)]);
  if (danawa.runId !== runId || reconciliation.runId !== runId || danawa.readOnly !== true ||
      danawa.databaseWrites !== 0 || reconciliation.databaseWrites !== 0) {
    throw new Error("Run identity/read-only guard failed");
  }
  const target = danawa.results.find((row: Result) =>
    (row.group?.listingIds ?? []).map(String).includes(listingId));
  const reconciled = reconciliation.rows.find((row: Result) => String(row.sourceListingId) === listingId);
  if (!target || !reconciled || target.group?.brand !== "Mercedes-Benz" || target.group?.model !== "GLE" ||
      target.group?.engineCc !== 2998 || target.group?.year !== 2026 || reconciled.powerPs !== 6100 ||
      !reconciled.danawa?.powers?.includes(6100)) {
    throw new Error("GLE450 correction guard failed: expected original saved 6100 PS observation");
  }
  const matching = (target.sourceCandidates ?? []).filter((candidate: Candidate) =>
    /^GLE450 4MATIC(?: AMG Line)? \(A\/T\)$/i.test(String(candidate.trim ?? "")));
  if (!matching.length || matching.some((candidate: Candidate) => Number(candidate.powerPs) !== 6100)) {
    throw new Error("Expected GLE450 Danawa variants with the original misparsed 6100 value");
  }
  if (danawa.manualCorrections?.some((item: Result) => item.listingId === listingId)) {
    throw new Error(`Correction for ${listingId} is already recorded`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const danawaBackup = `${danawaPath}.before-rpm-correction-${stamp}`;
  const reconciliationBackup = `${reconciliationPath}.before-rpm-correction-${stamp}`;
  await Promise.all([copyFile(danawaPath, danawaBackup), copyFile(reconciliationPath, reconciliationBackup)]);

  const rejected = (target.sourceCandidates ?? []).filter((candidate: Candidate) => !matching.includes(candidate));
  target.excludedCandidates = [...(target.excludedCandidates ?? []), ...rejected.map((candidate: Candidate) => ({
    ...candidate, exclusionReason: "Different GLE trim; not used for the Encar GLE450 configuration",
  }))];
  target.sourceCandidates = matching.map((candidate: Candidate) => ({
    ...candidate, rawParsedPowerPs: 6100, powerPs: 381, powerCorrection: note,
  }));
  target.powerCandidatesPs = [381];
  target.suggestedPowerPs = 381;
  target.classification = "preliminary_candidate";
  target.manualCorrection = { listingId, fromPowerPs: 6100, toPowerPs: 381, sourceUrl: correctionUrl, note };
  danawa.manualCorrections = [...(danawa.manualCorrections ?? []), target.manualCorrection];
  recompute(danawa);

  reconciled.powerPs = 381;
  reconciled.outcome = "danawa_only_preliminary";
  reconciled.danawa = {
    ...reconciled.danawa,
    status: "preliminary_candidate",
    powers: [381],
    uniqueCandidate: true,
    evidence: matching.map((candidate: Candidate) => ({
      power: 381, rawParsedPower: 6100, trim: candidate.trim, url: candidate.sourceUrl ?? correctionUrl,
      correction: note,
    })),
  };
  reconciliation.manualCorrections = [...(reconciliation.manualCorrections ?? []),
    { listingId, fromPowerPs: 6100, toPowerPs: 381, sourceUrl: correctionUrl, note }];

  await Promise.all([
    writeFile(danawaPath, `${JSON.stringify(danawa, null, 2)}\n`),
    writeFile(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({
    runId, listingId, configuration: target.group, previousMisparsedPowerPs: 6100,
    correctedPowerPs: 381, evidenceUrl: correctionUrl, matchedDanawaVariants: matching.length,
    excludedDifferentTrims: rejected.length, classifications: danawa.classifications,
    backups: [danawaBackup, reconciliationBackup], databaseWrites: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
