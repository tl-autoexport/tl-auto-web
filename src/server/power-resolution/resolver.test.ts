import assert from "node:assert/strict";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "./resolver";

const base: ApprovedPowerCandidate = {
  specId: "spec-g80-25t",
  specVersion: 1,
  calculationPowerKw: 224,
  powerBasis: "combustion_engine",
  sourcePriority: 10,
  evidenceId: "evidence-1",
  evidenceKind: "manufacturer_document",
  evidenceVerificationStatus: "approved",
  evidenceReliability: "high",
  match: {
    id: "match-g80-25t",
    priority: 10,
    brand: "Genesis",
    model: "G80",
    fuelType: "gasoline",
    engineCcFrom: 2490,
    engineCcTo: 2510,
  },
};

const input = {
  brand: "Genesis",
  model: "G80",
  fuelType: "gasoline",
  engineCc: 2497,
  year: 2024,
  driveType: "2WD",
};

// Actual configuration shape already present in the current Encar catalog.
const audiA3Input = {
  brand: "Audi",
  model: "A3",
  badge: "40 TFSI Premium",
  fuelType: "gasoline",
  engineCc: 1984,
  year: 2023,
};

{
  const result = resolveApprovedPower(input, [base]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.confidence, "high");
    assert.equal(result.candidate.calculationPowerKw, 224);
  }
}

{
  const exactTrim = {
    ...base,
    specId: "spec-g80-25t-sport",
    sourcePriority: 20,
    match: { ...base.match, id: "match-g80-25t-sport", trim: "Sport" },
  };
  const result = resolveApprovedPower({ ...input, trim: "Sport" }, [base, exactTrim]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.candidate.specId, "spec-g80-25t-sport");
}

{
  const tied = { ...base, specId: "spec-g80-25t-other", match: { ...base.match, id: "match-g80-25t-other" } };
  const result = resolveApprovedPower(input, [base, tied]);
  assert.equal(result.status, "review_required");
}

{
  const official = {
    ...base,
    evidenceKind: "sbkts" as const,
    evidenceReliability: "verified" as const,
  };
  const result = resolveApprovedPower(input, [official]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.confidence, "official");
}

{
  const audiA3: ApprovedPowerCandidate = {
    ...base,
    specId: "audi-a3-40tfsi-2023",
    calculationPowerKw: 150,
    match: {
      ...base.match,
      id: "audi-a3-40tfsi-2023-match",
      brand: "Audi",
      model: "A3",
      badgeNormalized: "40 TFSI Premium",
      engineCcFrom: 1984,
      engineCcTo: 1984,
      productionYearFrom: 2022,
      productionYearTo: 2024,
    },
  };
  const result = resolveApprovedPower(audiA3Input, [audiA3]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.candidate.calculationPowerKw, 150);
}

console.log("power resolver tests passed");
