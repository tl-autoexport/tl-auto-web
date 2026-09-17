/**
 * Evidence trust levels for the power reference.
 *
 * The import path (`import-manufacturer-power-specs.ts`) stamps every row with
 * `reliability='high'`, `review_status='verified'` and
 * `verification_status='approved'`, including explicitly provisional entries.
 * Those columns therefore cannot separate an official manufacturer document
 * from a provisional assignment, so the tier is derived from provenance
 * instead (source host, source kind and the provisional markers the reference
 * itself declares).
 *
 * T1 — official manufacturer document or technical resource.
 * T2 — official manufacturer communication: press material, regional site,
 *      catalogue/knowledge base hosted by the manufacturer or its distributor.
 * T3 — third-party or open source: publishable only with T1/T2 corroboration.
 * T4 — provisional/unverified: never publishable.
 */

export type EvidenceTier = "T1" | "T2" | "T3" | "T4";

export type EvidenceTierInput = {
  specKey?: string | null;
  sourceKind?: string | null;
  sourceTitle?: string | null;
  sourceUri?: string | null;
  note?: string | null;
};

const PROVISIONAL = /provisional|предварительн|неподтвержд|not treat this row as exact/i;

const THIRD_PARTY_HOSTS = [
  "autocatalogarchive.com",
  "newswire.co.kr",
  "eltawkeel.com",
  "mb.zungfu.com.mo",
  "car.naver.com",
];

/** Manufacturer-hosted communication rather than core technical material. */
const COMMUNICATION_HOSTS = [
  "press.bmwgroup.com",
  "media.mercedes-benz",
  "static1.media.mercedes-benz",
  "presse.mercedes-benz",
  "mercedes-benz-financial.co.kr",
  "jamaica.landrover.com",
  "news.chevrolet.co.kr",
  "rental.kia.com",
  "map.vwkr.co.kr",
  "prod2-press.kia.com",
  "www.kia.ru",
  "promotion_news",
  "media.jaguar.com",
  "volkswagen-newsroom.com",
  "mini.co.uk",
  "kgm-motors.co.uk",
  "kgm.de",
  "renaultkoream.com",
];

const MANUFACTURER_HOSTS = [
  "hyundai.com",
  "kia.com",
  "genesis.com",
  "kg-mobility.com",
  "chevrolet.co.kr",
  "ssangyong",
  "bmw.co.kr",
  "bmw.com",
  "bmw.at",
  "bmwgroup.com",
  "audi-mediacenter.com",
  "audi.com",
  "mercedes-benz.co.kr",
  "mercedes-benz.com",
  "landrover.com",
  "jaguar.com",
  "volkswagen.co.kr",
  "vwkr.co.kr",
  "renault.co.kr",
  "mini.com",
  "kg-mobility.co.kr",
];

function hostOf(uri: string | null | undefined) {
  const value = String(uri ?? "").trim().toLowerCase();
  if (!value) return null;
  const match = value.match(/^https?:\/\/([^/]+)/);
  return match ? match[1] : value;
}

export function evidenceTier(input: EvidenceTierInput): EvidenceTier {
  const haystack = `${input.specKey ?? ""} ${input.sourceTitle ?? ""} ${input.note ?? ""}`;
  if (PROVISIONAL.test(haystack)) return "T4";

  const host = hostOf(input.sourceUri);
  if (host && THIRD_PARTY_HOSTS.some((value) => host.includes(value))) return "T3";
  if (host && COMMUNICATION_HOSTS.some((value) => host.includes(value))) return "T2";
  if (host && MANUFACTURER_HOSTS.some((value) => host.includes(value))) return "T1";

  // Without a locatable document the provenance cannot be reviewed. Treat a
  // missing URI as unverified and an unknown host as a third-party source that
  // still needs T1/T2 corroboration.
  return host ? "T3" : "T4";
}

/**
 * Publication gate. `corroborated` means a T1/T2 specification for the same
 * configuration states the same output, which is the only way a T3 source may
 * be published.
 */
export function isPublishableTier(tier: EvidenceTier, corroborated: boolean): boolean {
  if (tier === "T1" || tier === "T2") return true;
  if (tier === "T3") return corroborated;
  return false;
}

export function tierReason(tier: EvidenceTier, corroborated: boolean) {
  if (tier === "T4") return "tier_T4_provisional";
  if (tier === "T3") return corroborated ? null : "tier_T3_uncorroborated";
  return null;
}

/**
 * Prefers the level stored in `vehicle_power_evidence.evidence_tier`. The
 * derivation is only a fallback for rows written before the column existed, so
 * every script reads the same reviewed value instead of recomputing it.
 */
export function tierFromStored(stored: unknown, fallback: EvidenceTierInput): EvidenceTier {
  const value = String(stored ?? "").trim().toUpperCase();
  if (value === "T1" || value === "T2" || value === "T3" || value === "T4") return value;
  return evidenceTier(fallback);
}
