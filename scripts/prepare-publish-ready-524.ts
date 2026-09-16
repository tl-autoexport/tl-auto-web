import { Client } from "pg";
import { config } from "dotenv";
import { normalizeBrand, normalizeDrive, normalizeFuel, normalizeModel } from "../src/server/normalization/vehicles";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL; if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const runId = "98b17628-1dab-460d-972b-f7f092fbcc42";
const aliases: Record<string,string> = { avante: "Elantra", canival: "Carnival", "1-series": "1 Series", "2-series": "2 Series" };
const model = (v: unknown) => { const m = normalizeModel(v); return aliases[String(m ?? "").toLowerCase()] ?? m; };
async function main() {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    const refs = (await c.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id where spec.status='approved' and evidence.verification_status='approved'`)).rows.map((r): ApprovedPowerCandidate => ({ specId:r.spec_id,specVersion:r.spec_version,calculationPowerKw:Number(r.calculation_power_kw),powerBasis:r.power_basis,sourcePriority:r.source_priority,evidenceId:r.evidence_id,evidenceKind:r.evidence_kind,evidenceVerificationStatus:r.evidence_verification_status,evidenceReliability:r.evidence_reliability,match:{id:r.match_id,priority:r.match_priority,brand:r.brand,model:r.model,generation:r.generation,trim:r.trim,badgeNormalized:r.badge_normalized,modelCode:r.model_code,engineCode:r.engine_code,fuelType:r.fuel_type,driveType:r.drive_type,productionYearFrom:r.production_year_from,productionYearTo:r.production_year_to,engineCcFrom:r.engine_cc_from,engineCcTo:r.engine_cc_to} }));
    const rows = (await c.query(`select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type from public.chestny_catalog_staging s join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1 where q.status='succeeded'`,[runId])).rows;
    const ids: string[] = []; for (const r of rows) { const res = resolveApprovedPower({brand:normalizeBrand(r.manufacturer),model:model(r.model),generation:r.generation,trim:r.trim,badge:r.trim,year:r.model_year,engineCc:r.engine_cc,fuelType:normalizeFuel(r.fuel_type),driveType:normalizeDrive(r.drive_type)}, refs); if (res.status === "matched") ids.push(r.source_listing_id); }
    await c.query(`update public.chestny_catalog_staging set promotion_status='publish_ready',promotion_note='Local validation passed: approved power reference match; awaiting dedicated publication run.',updated_at=now() where source_listing_id=any($1::text[]) and source_status='active' and raw_payload ? 'encar_enrichment'`,[ids]);
    console.log(JSON.stringify({runId,selected:ids.length,status:"publish_ready",encarRequests:0,publicCatalogChanged:false},null,2));
  } finally { await c.end(); }
}
main().catch(e=>{console.error(e);process.exit(1)});
