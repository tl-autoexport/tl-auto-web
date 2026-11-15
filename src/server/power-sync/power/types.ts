import type { PowerRecord } from './contract.js';
export type Propulsion = "ice" | "electric" | "hybrid_parallel" | "hybrid_sequential" | "hybrid_phev";
export type PowerBasis = "combustion_rated" | "electric_peak" | "electric_30min" | "system_combined";
export type EvidenceTier = "T1" | "T2" | "T3" | "T4";
export type EvidenceStatus = "approved" | "provisional" | "rejected" | "review_required";

export type ResolveInput = {
  brand: string;
  model: string;
  generation?: string;
  trim?: string;
  badge?: string;
  modelCode?: string;
  engineCode?: string;
  fuelType?: string;
  driveType?: string;
  market?: string;
  year?: number;
  engineCc?: number;
  powertrain?: Propulsion;
  hybridTopology?: "parallel" | "sequential";
  correlation?: { masterId?: string; sourceListingId?: string; source?: string };
};

export type PowerComponent = {
  original?: { value: number; unit: "kW" | "PS" | "hp" };
  kind: "combustion_rated" | "electric_peak" | "electric_30min" | "system_combined";
  kw: number;
  hp: number;
  role: "calculation" | "display_only" | "component";
};

export type EvidenceProvenance = {
  evidenceId: string;
  sourceKind: string;
  title: string;
  uri: string;
  retrievedAt?: string;
  tier: EvidenceTier;
  status: EvidenceStatus;
  verificationNote?: string;
};

export type PowerCandidate = {
  specId: string;
  specKey: string;
  version: number;
  status: "approved" | "provisional" | "rejected" | "retired";
  propulsion: Propulsion;
  calculationBasis: PowerBasis;
  calculationPowerKw: number;
  components: PowerComponent[];
  confidence: "official" | "high" | "provisional";
  evidence: EvidenceProvenance;
  sourcePriority: number;
  match: {
    brand: string; model: string; generation?: string | null; trim?: string | null;
    badge?: string | null; modelCode?: string | null; engineCode?: string | null;
    fuelType?: string | null; driveType?: string | null; market?: string | null;
    yearFrom?: number | null; yearTo?: number | null;
    engineCcFrom?: number | null; engineCcTo?: number | null;
    aliases?: string[];
    alternatives?: Array<{
      generation?: string | null; trim?: string | null; badge?: string | null; modelCode?: string | null; engineCode?: string | null;
      fuelType?: string | null; driveType?: string | null; market?: string | null; yearFrom?: number | null; yearTo?: number | null;
      engineCcFrom?: number | null; engineCcTo?: number | null; aliases?: string[];
    }>;
  };
};

export type ResolveResult = { record?: PowerRecord } & (
  | { status: "RESOLVED"; resolutionClass: "CONFIRMED" | "PROBABLE" | "ESTIMATED"; spec: { id: string; key: string; version: number }; power: { kw: number; hp: number; basis: PowerBasis }; propulsion: Propulsion; components: PowerComponent[]; evidence: EvidenceProvenance; confidence: "official" | "high" | "probable" | "estimated"; method: "approved_reference" | "provisional_source_match" | "controlled_estimate" | "gemini_grounded_deepseek_resolution" | "research_cache"; matchedCharacteristics: Partial<ResolveInput>; referenceVersion: string; researchVersion?: string; sources?: Array<{url:string;type:string;title:string;excerpt:string}> }
  | { status: "REVIEW_REQUIRED"; resolutionClass: "INSUFFICIENT_DATA"; reason: string; candidateCount: number; referenceVersion: string }
  | { status: "NOT_FOUND"; resolutionClass: "INSUFFICIENT_DATA"; reason: string; referenceVersion: string });
