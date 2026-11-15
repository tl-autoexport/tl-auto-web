import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { resolveApprovedPower, type ApprovedPowerCandidate, type PowerReferenceInput } from "@/server/power-resolution/resolver";
import { tierFromStored } from "@/server/power-resolution/evidence-tiers";
import type { SharedPowerInput, SharedPowerResult } from "@/server/power-resolution/shared-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  source: z.string().min(1).max(40), sourceListingId: z.string().min(1).max(100),
  manufacturer: z.string().nullable(), model: z.string().nullable(),
  generation: z.string().nullable().optional(), trim: z.string().nullable().optional(), badge: z.string().nullable().optional(),
  modelCode: z.string().nullable().optional(), engineCode: z.string().nullable().optional(),
  fuel: z.string().nullable().optional(), drive: z.string().nullable().optional(),
  modelYear: z.number().int().nullable().optional(), engineCc: z.number().positive().nullable().optional(),
});

type ReferenceRow = {
  id: string; version: number; spec_key: string; calculation_power_kw: number; power_basis: string; propulsion_type: string;
  source_priority: number; dvs_power_kw: number | null; electric_power_kw_30min: number | null;
  evidence: { id: string; source_kind: string; source_uri: string | null; source_title: string | null; evidence_note: string | null; verification_status: string; reliability: string; evidence_tier: string | null };
  matches: Array<{ id: string; priority: number; brand: string; model: string; generation: string | null; trim: string | null; badge_normalized: string | null; model_code: string | null; engine_code: string | null; fuel_type: string | null; drive_type: string | null; production_year_from: number | null; production_year_to: number | null; engine_cc_from: number | null; engine_cc_to: number | null }>;
};

let cache: { expiresAt: number; rows: ReferenceRow[] } | null = null;
const CACHE_MS = 60_000;
const KW_TO_HP = 1.3596216173;

function authorized(request: Request) {
  const expected = process.env.POWER_RESOLVER_SHARED_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function loadReferences(): Promise<ReferenceRow[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.rows;
  const db = createSupabaseAdmin();
  const { data, error } = await db.from("vehicle_power_specs").select(
    "id,version,spec_key,calculation_power_kw,power_basis,propulsion_type,source_priority,dvs_power_kw,electric_power_kw_30min,evidence:vehicle_power_evidence!inner(id,source_kind,source_uri,source_title,evidence_note,verification_status,reliability,evidence_tier),matches:vehicle_power_spec_matches!inner(id,priority,brand,model,generation,trim,badge_normalized,model_code,engine_code,fuel_type,drive_type,production_year_from,production_year_to,engine_cc_from,engine_cc_to)",
  ).eq("status", "approved").eq("evidence.verification_status", "approved");
  if (error) throw new Error("reference_read_failed");
  const rows = (data ?? []) as unknown as ReferenceRow[];
  cache = { rows, expiresAt: Date.now() + CACHE_MS };
  return rows;
}

function toCandidate(row: ReferenceRow, match: ReferenceRow["matches"][number]): ApprovedPowerCandidate | null {
  const tier = tierFromStored(row.evidence.evidence_tier, {
    specKey: row.spec_key, sourceKind: row.evidence.source_kind, sourceTitle: row.evidence.source_title,
    sourceUri: row.evidence.source_uri, note: row.evidence.evidence_note,
  });
  if (tier === "T4") return null;
  return {
    specId: row.id, specVersion: Number(row.version), calculationPowerKw: Number(row.calculation_power_kw),
    powerBasis: row.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(row.source_priority),
    evidenceId: row.evidence.id, evidenceKind: row.evidence.source_kind as ApprovedPowerCandidate["evidenceKind"],
    evidenceVerificationStatus: row.evidence.verification_status as ApprovedPowerCandidate["evidenceVerificationStatus"],
    evidenceReliability: row.evidence.reliability as ApprovedPowerCandidate["evidenceReliability"], evidenceTier: tier,
    match: { id: match.id, priority: Number(match.priority), brand: match.brand, model: match.model,
      generation: match.generation, trim: match.trim, badgeNormalized: match.badge_normalized,
      modelCode: match.model_code, engineCode: match.engine_code, fuelType: match.fuel_type,
      driveType: match.drive_type, productionYearFrom: match.production_year_from,
      productionYearTo: match.production_year_to, engineCcFrom: match.engine_cc_from, engineCcTo: match.engine_cc_to },
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: SharedPowerInput;
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  try {
    const rows = await loadReferences();
    const candidates = rows.flatMap((row) => row.matches.flatMap((match) => {
      const candidate = toCandidate(row, match);
      return candidate ? [candidate] : [];
    }));
    const input: PowerReferenceInput = {
      brand: body.manufacturer, model: body.model, generation: body.generation, trim: body.trim, badge: body.badge,
      modelCode: body.modelCode, engineCode: body.engineCode, fuelType: body.fuel, driveType: body.drive,
      year: body.modelYear, engineCc: body.engineCc,
    };
    const resolution = resolveApprovedPower(input, candidates);
    let result: SharedPowerResult;
    if (resolution.status !== "matched") {
      result = { status: resolution.candidates.length ? "review_required" : "not_found", reason: resolution.reason };
    } else {
      const row = rows.find((item) => item.id === resolution.candidate.specId)!;
      const tier = String(resolution.candidate.evidenceTier ?? "T4");
      result = {
        status: "resolved", powerKw: resolution.candidate.calculationPowerKw,
        powerHp: Math.round(resolution.candidate.calculationPowerKw * KW_TO_HP), basis: resolution.candidate.powerBasis,
        dvsPowerKw: row.dvs_power_kw == null ? null : Number(row.dvs_power_kw),
        propulsionType: row.propulsion_type,
        electricPowerKw30Min: row.electric_power_kw_30min == null ? null : Number(row.electric_power_kw_30min),
        specId: row.id, specVersion: Number(row.version), evidenceId: row.evidence.id,
        evidenceKind: row.evidence.source_kind, evidenceTier: tier, confidence: resolution.confidence,
        sourceUri: row.evidence.source_uri, sourceTitle: row.evidence.source_title,
      };
    }
    return NextResponse.json({ source: body.source, sourceListingId: body.sourceListingId, result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "power_resolution_unavailable" }, { status: 503 });
  }
}
