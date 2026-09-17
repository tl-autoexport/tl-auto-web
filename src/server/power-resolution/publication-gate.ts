/**
 * Publication gate for locally confirmed power.
 *
 * Kept as a pure function so the decision can be tested without a database and
 * so the publisher cannot drift from the agreed policy:
 *   - power must come from an approved `power_confirmation` binding;
 *   - the confirmed specification must remain the unique winner for the card;
 *   - T1/T2 evidence is publishable, T3 only with T1/T2 corroboration, T4 never;
 *   - the stored confirmation value must equal the approved value;
 *   - a missing drive axle is never replaced by an assumption;
 *   - a missing registration month is not replaced by a fixed month.
 */

import { isPublishableTier, type EvidenceTier } from "./evidence-tiers";
import { classifyDriveState, type DriveState } from "./drive-state";
import type { PowerResolutionResult } from "./resolver";

export const KW_TO_PS = 1.359621617;
export const hpFromKw = (kw: number) => Math.round(kw * KW_TO_PS);

export type PublicationDecision =
  | { status: "publish"; specId: string; hp: number; tier: EvidenceTier; confidence: string; driveState: DriveState }
  | { status: "exclude"; reason: string };

export type PublicationInput = {
  resolution: PowerResolutionResult;
  confirmedSpecId: string | null;
  confirmedHp: number | null;
  tierBySpecId: Map<string, EvidenceTier>;
  kwBySpecId: Map<string, number>;
  driveType: string | null;
  registrationMonth: number | null;
  photoCount: number;
  hasRequiredSourceData: boolean;
};

export function decidePublication(input: PublicationInput): PublicationDecision {
  if (!input.confirmedSpecId) return { status: "exclude", reason: "no_power_confirmation" };
  if (!input.tierBySpecId.has(input.confirmedSpecId)) {
    return { status: "exclude", reason: "confirmation_spec_not_approved" };
  }

  const { resolution } = input;
  if (resolution.status !== "matched") return { status: "exclude", reason: "power_no_longer_matches" };
  if (resolution.candidate.specId !== input.confirmedSpecId) {
    return { status: "exclude", reason: "confirmation_conflict" };
  }

  const specId = resolution.candidate.specId;
  const tier = input.tierBySpecId.get(specId) ?? "T4";
  const corroborated = resolution.candidates.some((candidate) =>
    candidate.specId !== specId &&
    (input.tierBySpecId.get(candidate.specId) === "T1" || input.tierBySpecId.get(candidate.specId) === "T2") &&
    Math.abs(candidate.calculationPowerKw - resolution.candidate.calculationPowerKw) <= 0.5);
  if (!isPublishableTier(tier, corroborated)) {
    return { status: "exclude", reason: `tier_${tier}_not_publishable` };
  }

  const kw = input.kwBySpecId.get(specId) ?? resolution.candidate.calculationPowerKw;
  const hp = hpFromKw(kw);
  if (input.confirmedHp != null && Number.isFinite(input.confirmedHp) && Math.abs(input.confirmedHp - hp) > 1) {
    return { status: "exclude", reason: "confirmation_value_mismatch" };
  }

  if (!input.driveType) return { status: "exclude", reason: "drive_pending" };
  const driveState = classifyDriveState(resolution.candidate.match.driveType, input.driveType);
  if (driveState === "drive_pending") return { status: "exclude", reason: "drive_pending" };
  if (driveState === "drive_conflict") return { status: "exclude", reason: "drive_conflict" };
  if (input.registrationMonth == null) return { status: "exclude", reason: "month_pending" };
  if (input.photoCount === 0) return { status: "exclude", reason: "no_valid_photos" };
  if (!input.hasRequiredSourceData) return { status: "exclude", reason: "missing_source_data" };

  return { status: "publish", specId, hp, tier, confidence: resolution.confidence, driveState };
}
