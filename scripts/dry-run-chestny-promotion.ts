import { Client } from "pg";
import { config } from "dotenv";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL; if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const canonModel: Record<string, string> = { canival: "Carnival", santafe: "Santa Fe", ray: "Ray", morning: "Morning", tiboli: "Tivoli", "x2 (f39)": "X2", "1-series": "1 Series", "2-series": "2 Series" };
const canonFuel = (v: string | null) => { const s=(v??"").toLowerCase(); if (s.includes("디젤")||s.includes("diesel")) return "diesel"; if (s.includes("전기")||s.includes("hybrid")) return "hybrid"; if (s.includes("가솔린")||s.includes("gas")) return "gasoline"; return v; };
function model(v: string | null) { const s=v??""; return canonModel[s.toLowerCase()] ?? s; }
async function main() {
 const c=new Client({connectionString:dbUrl,ssl:{rejectUnauthorized:false}}); await c.connect();
 try {
  const [staging, refs] = await Promise.all([
   c.query(`select manufacturer,model,model_year,engine_cc,fuel_type,drive_type from public.chestny_catalog_staging`),
   c.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id where spec.status='approved' and evidence.verification_status='approved'`)
  ]);
  const candidates: ApprovedPowerCandidate[]=refs.rows.map(r=>({specId:r.spec_id,specVersion:r.spec_version,calculationPowerKw:Number(r.calculation_power_kw),powerBasis:r.power_basis,sourcePriority:r.source_priority,evidenceId:r.evidence_id,evidenceKind:r.evidence_kind,evidenceVerificationStatus:r.evidence_verification_status,evidenceReliability:r.evidence_reliability,match:{id:r.match_id,priority:r.match_priority,brand:r.brand,model:r.model,generation:r.generation,trim:r.trim,badgeNormalized:r.badge_normalized,modelCode:r.model_code,engineCode:r.engine_code,fuelType:r.fuel_type,driveType:r.drive_type,productionYearFrom:r.production_year_from,productionYearTo:r.production_year_to,engineCcFrom:r.engine_cc_from,engineCcTo:r.engine_cc_to}}));
  const counts={total:staging.rowCount,matched:0,under160:0,over160:0,reviewRequired:0,official:0,high:0}; const examples:any[]=[];
  for(const row of staging.rows){ const result=resolveApprovedPower({brand:row.manufacturer,model:model(row.model),year:row.model_year,engineCc:row.engine_cc,fuelType:canonFuel(row.fuel_type),driveType:row.drive_type},candidates); if(result.status==='matched'){counts.matched++; counts[result.confidence]++; const hp=result.candidate.calculationPowerKw*1.35962; if(hp<=160)counts.under160++; else counts.over160++; if(examples.length<30)examples.push({brand:row.manufacturer,model:model(row.model),year:row.model_year,engineCc:row.engine_cc,powerHp:Math.round(hp*10)/10,confidence:result.confidence});} else {counts.reviewRequired++;} }
  console.log(JSON.stringify({dryRun:true,policy:"No staging or public catalog rows changed",approvedReferences:candidates.length,counts,examples},null,2));
 } finally { await c.end(); }
}
main().catch(e=>{console.error(e);process.exit(1)});
