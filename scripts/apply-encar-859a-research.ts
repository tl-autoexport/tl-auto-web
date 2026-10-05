/* eslint-disable @typescript-eslint/no-explicit-any -- Archived research JSON is validated by run, count, ID and resolver checks. */
/** User-approved recovery: 30 official decisions, 228 listing-scoped preliminary decisions. */
import {config} from 'dotenv';
import {Client} from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveAutomaticPowerReference} from '../src/server/catalog/automatic-power-reference';
config({path:'.env.local',quiet:true});config({path:'.env',quiet:true});
const runId='859a2544-7c79-4014-bee1-f1920d619215';
const write=process.env.ENCAR_RESEARCH_WRITE==='true';
async function main(){
 const recovery=JSON.parse(await readFile('data/power-reference/encar-run-859a-recovered-decisions.json','utf8'));
 const plan=JSON.parse(await readFile('output/encar-859a-before-research.json','utf8'));
 const rows=recovery.candidates;
 if(recovery.runId!==runId||plan.runId!==runId||rows.length!==258||new Set(rows.map((r:any)=>r.sourceListingId)).size!==258)throw Error('Invalid run or research ledger');
 const byId=new Map(plan.candidates.map((r:any)=>[r.sourceListingId,r.configuration]));
 const db=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await db.connect();
 try{
 await db.query(write?'begin':'begin read only');
 const staged=(await db.query('select source_listing_id from public.encar_enrichment_staging where run_id=$1',[runId])).rows;
 if(staged.length!==500||rows.some((r:any)=>!staged.some(s=>s.source_listing_id===r.sourceListingId)))throw Error('Staging scope mismatch');
 const hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');let batchId=null;let official=0,preliminary=0;
 if(write){
 await db.query("select pg_advisory_xact_lock(hashtext('encar-859a-research'))");
 batchId=(await db.query(`insert into public.vehicle_power_source_batches(source_kind,source_name,source_uri,source_sha256,source_version,imported_by,metadata) values('manual','Encar 859a user-reviewed research',$1,$2,'859a-v1','codex-user-authorized',$3::jsonb) on conflict(source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,['local-file:data/power-reference/encar-run-859a-recovered-decisions.json',hash,JSON.stringify({runId,officialListings:30,preliminaryListings:228})])).rows[0].id;
 }
 const officialConfigurations=new Map<string,string>();
 for(const [i,r] of rows.entries()){
 const c:any=byId.get(r.sourceListingId);if(!c||!Number.isFinite(r.powerPs)||r.powerPs<=0)throw Error('Missing configuration or power');
 const eligible=r.approvalAudit.decision==='eligible_for_approval';if(eligible)official++;else preliminary++;
 if(!write)continue;
 const sourceRowId=(await db.query(`insert into public.vehicle_power_source_rows(batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status,parse_warnings) values($1,'859a-research',$2,$3::jsonb,$4,$5,'parsed',$6::text[]) on conflict(batch_id,source_sheet,source_row_number) do update set raw_record=excluded.raw_record returning id`,[batchId,i+1,JSON.stringify(r),`${c.brand} ${c.model}`,`${r.powerPs} PS`,eligible?[]:['User-approved preliminary research; exact source alignment may be incomplete']])).rows[0].id;
 if(eligible){
 const configKey=JSON.stringify(c);
 const prior=officialConfigurations.get(configKey);
 const key=`encar-859a-official-${r.sourceListingId}`;
 if(prior){await db.query("update public.vehicle_power_specs set status='retired',updated_at=now(),approval_note=approval_note||' Duplicate identical configuration consolidated within research batch.' where spec_key=$1 and status='approved'",[key]);continue;}
 officialConfigurations.set(configKey,key);
 const existing=(await db.query('select id,calculation_power_kw from public.vehicle_power_specs where spec_key=$1 and version=1',[key])).rows[0];
 if(existing){if(Math.abs(Number(existing.calculation_power_kw)-r.powerKw)>.001)throw Error('Existing official conflict');continue;}
 const evidenceId=(await db.query(`insert into public.vehicle_power_evidence(batch_id,source_row_id,source_kind,source_uri,captured_at,vehicle_category,brand,model,fuel_type,production_year_from,production_year_to,propulsion_type,dvs_power_kw,source_units,reliability,review_status,reviewed_by,reviewed_at,source_title,source_retrieved_at,confidence_score,evidence_note,verification_status,review_note,evidence_tier,evidence_tier_source) values($1,$2,'manufacturer_document',$3,current_date,'M1',$4,$5,$6,$7,$7,'ice',$8,'PS','high','verified','codex-user-authorized',now(),'Manufacturer specification verified for Encar configuration',now(),95,$9,'approved',$9,'T1','reviewed_manufacturer_source') returning id`,[batchId,sourceRowId,r.approvalAudit.officialSourceUrl,c.brand,c.model,c.fuelType,c.year,r.powerKw,r.approvalAudit.matchingBasis])).rows[0].id;
 const specId=(await db.query(`insert into public.vehicle_power_specs(spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,calculation_power_kw,evidence_id,approval_note,approved_by,approved_at,engine_power_hp,power_basis,source_priority) values($1,1,'approved','M1','ice',$2,$2,$3,$3,$4,$5,'codex-user-authorized',now(),$6,'combustion_engine',10) returning id`,[key,c.engineCc,r.powerKw,evidenceId,r.approvalAudit.matchingBasis,r.powerPs])).rows[0].id;
 await db.query(`insert into public.vehicle_power_spec_matches(spec_id,priority,brand,model,generation,trim,badge_normalized,fuel_type,drive_type,production_year_from,production_year_to,engine_cc_from,engine_cc_to) values($1,10,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)`,[specId,c.brand,c.model,c.generation,c.trim,c.badge,c.fuelType,c.driveType,c.year,c.engineCc]);
 }else{
 const cc=r.engineCcOverride??c.engineCc;
 if(r.engineCcOverride)await db.query(`update public.encar_enrichment_staging set normalized=jsonb_set(coalesce(normalized,'{}'::jsonb),'{powerResearchEngineCc}',to_jsonb($3::integer)),updated_at=now() where run_id=$1 and source_listing_id=$2`,[runId,r.sourceListingId,cc]);
 const key=`859a-research|listing=${r.sourceListingId}`;
 const old=(await db.query('select status,power_hp from public.vehicle_power_automatic_reference where configuration_key=$1',[key])).rows[0];
 if(old&&(old.status!=='automatic'||Number(old.power_hp)!==r.powerPs))throw Error('Existing preliminary conflict');
 await db.query(`insert into public.vehicle_power_automatic_reference(configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,'manual_web_research_859a','automatic',$12) on conflict(configuration_key) do nothing`,[key,c.brand,c.model,c.fuelType,cc,c.driveType,c.badge,c.trim,c.year,r.powerPs,r.powerKw,JSON.stringify({runId,sourceListingId:r.sourceListingId,sourceUrls:r.sourceUrls,sourceScope:r.sourceScope,reason:r.approvalAudit.reason,engineCcOverride:r.engineCcOverride,finality:'preliminary',sourceRowId})]);
 }
 }
 if(official!==30||preliminary!==228)throw Error('Approval counts changed');
 if(write){
 const refs=(await db.query("select * from public.vehicle_power_automatic_reference where status='automatic'")).rows;
 for(const r of rows.filter((r:any)=>r.approvalAudit.decision!=='eligible_for_approval')){const c:any=byId.get(r.sourceListingId);const match=resolveAutomaticPowerReference({brand:c.brand,model:c.model,fuel_type:c.fuelType,engine_cc:r.engineCcOverride??c.engineCc,drive_type:c.driveType,badge:c.badge,badge_detail:c.trim,year:c.year,source_listing_id:r.sourceListingId},refs);if(!match||Number(match.power_hp)!==r.powerPs)throw Error(`Preliminary resolver verification failed: ${r.sourceListingId}`);}
 }
 await db.query(write?'commit':'rollback');
 const result={runId,write,officialListings:official,preliminaryListings:preliminary,sourceRows:rows.length,batchId,publicCatalogChanged:false};
 await writeFile(`output/encar-859a-research-${write?'applied':'preview'}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }catch(e){await db.query('rollback').catch(()=>{});throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
