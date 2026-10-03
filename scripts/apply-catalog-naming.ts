/** Step 4: transactional canonical names with pre-write backup and guarded rollback. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { Client } from 'pg';

type Proposal = {
 id:string; source:string; sourceListingId:string; brand:string; model:string;
 original:{brand:string|null;model:string|null;generation:string|null;trim:string|null;grade:string|null;badge:string|null;badgeDetail:string|null;stagingGeneration:string|null;stagingTrim:string|null};
 generation:{label:string|null;fullName:string|null;status:string;basis:string;nodeKeys:string[]};
 modification:{label:string|null;status:string};trim:{label:string|null;status:string};
 versionLine:string|null;compactVersion:string|null;issues:string[];
};
type ExistingName = {car_id:string;rules_version:string;run_id:string;brand:string;model:string;generation_label:string|null;generation_full_name:string|null;modification_label:string|null;trim_label:string|null;version_line:string|null;compact_version:string|null;evidence:unknown;normalized_at:string};
type LiveCar = {id:string;primary_source:string;source_id:string;brand:string|null;model:string|null;generation:string|null;grade:string|null;trim:string|null;badge:string|null;badge_detail:string|null;staging_generation:string|null;staging_trim:string|null};
const directory=resolve('output/catalog-naming/applied');
const columns='car_id,rules_version,run_id,brand,model,generation_label,generation_full_name,modification_label,trim_label,version_line,compact_version,evidence,normalized_at';
const upsert=`insert into public.catalog_vehicle_names (${columns})
 select car_id,rules_version,run_id,brand,model,generation_label,generation_full_name,modification_label,trim_label,version_line,compact_version,evidence,normalized_at
 from jsonb_to_recordset($1::jsonb) as x(car_id uuid,rules_version text,run_id uuid,brand text,model text,generation_label text,generation_full_name text,modification_label text,trim_label text,version_line text,compact_version text,evidence jsonb,normalized_at timestamptz)
 on conflict(car_id) do update set rules_version=excluded.rules_version,run_id=excluded.run_id,brand=excluded.brand,model=excluded.model,generation_label=excluded.generation_label,generation_full_name=excluded.generation_full_name,modification_label=excluded.modification_label,trim_label=excluded.trim_label,version_line=excluded.version_line,compact_version=excluded.compact_version,evidence=excluded.evidence,normalized_at=excluded.normalized_at`;
async function main(){
 const env=parse(await readFile('.env.local','utf8'));
 const db=new Client({connectionString:env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
 const write=process.argv.includes('--write');
 const rollback=process.argv.find(a=>a.startsWith('--rollback='))?.slice('--rollback='.length);
 await db.connect();
 try {
 await db.query('begin isolation level serializable');
 await db.query("set local statement_timeout='120s'");
 await db.query("set local lock_timeout='10s'");
 if(rollback){
  if(!write)throw new Error('Rollback requires --write');
  const backup=JSON.parse(await readFile(resolve(rollback),'utf8')) as {runId:string;ids:string[];previousNames:ExistingName[]};
  const owned=(await db.query<{car_id:string}>('select car_id from public.catalog_vehicle_names where car_id=any($1::uuid[]) and run_id=$2',[backup.ids,backup.runId])).rows;
  if(owned.length!==backup.ids.length)throw new Error('Some names were changed after this run; rollback stopped');
  await db.query('delete from public.catalog_vehicle_names where car_id=any($1::uuid[]) and run_id=$2',[backup.ids,backup.runId]);
  if(backup.previousNames.length)await db.query(upsert,[JSON.stringify(backup.previousNames)]);
  await db.query('commit');
  console.log(JSON.stringify({rolledBackRun:backup.runId,removed:owned.length,restored:backup.previousNames.length}));return;
 }
 const proposalText=await readFile('output/catalog-naming/proposals.json','utf8');
 const report=JSON.parse(proposalText) as {version:string;total:number;rows:Proposal[];inputHashes:Record<string,string>};
 const auditText=await readFile('output/catalog-naming/audit.json','utf8');
 if(createHash('sha256').update(auditText).digest('hex')!==report.inputHashes.audit)throw new Error('Audit hash does not match proposals');
 const audit=JSON.parse(auditText) as {rows:Array<{id:string;source_names:unknown}>};
 const sourceById=new Map(audit.rows.map(r=>[r.id,r.source_names]));
 const live=(await db.query<LiveCar>(`select c.id,c.primary_source,c.source_id,c.brand,c.model,c.generation,c.grade,c.trim,c.badge,c.badge_detail,s.generation staging_generation,s.trim staging_trim
 from public.cars c left join public.chestny_catalog_staging s on c.primary_source='chestny_prigon' and s.source_listing_id=c.source_id
 where public.catalog_match(c,'{}'::jsonb) order by c.id`)).rows;
 const byId=new Map(live.map(c=>[c.id,c]));
 if(live.length!==report.total || new Set(report.rows.map(r=>r.id)).size!==live.length)throw new Error('Published membership changed since audit');
 for(const r of report.rows){
  const c=byId.get(r.id);if(!c)throw new Error(`No longer published: ${r.id}`);
  const actual={brand:c.brand,model:c.model,generation:c.generation,trim:c.trim,grade:c.grade,badge:c.badge,badgeDetail:c.badge_detail,stagingGeneration:c.staging_generation,stagingTrim:c.staging_trim};
  if(JSON.stringify(actual)!==JSON.stringify(r.original)||c.primary_source!==r.source||c.source_id!==r.sourceListingId)throw new Error(`Source names changed: ${r.sourceListingId}`);
  if(!r.brand||!r.model)throw new Error(`Missing title: ${r.id}`);
  if(r.generation.status==='conflict'||r.modification.status==='conflict'||r.trim.status==='conflict')throw new Error(`Unresolved conflict: ${r.id}`);
  if(r.trim.status==='needs_review'&&r.trim.label!==null)throw new Error(`Review trim must remain null: ${r.id}`);
 }
 const runId=randomUUID(),at=new Date().toISOString();
 const proposedNames=report.rows.map(r=>({car_id:r.id,rules_version:report.version,run_id:runId,brand:r.brand,model:r.model,generation_label:r.generation.label,generation_full_name:r.generation.fullName,modification_label:r.modification.label,trim_label:r.trim.label,version_line:r.versionLine,compact_version:r.compactVersion,
 evidence:{source:r.source,sourceListingId:r.sourceListingId,original:r.original,sourceNames:sourceById.get(r.id),generation:r.generation,modification:r.modification,trim:r.trim,issues:r.issues,inputHashes:report.inputHashes},normalized_at:at}));
 const exists=(await db.query<{found:string|null}>("select to_regclass('public.catalog_vehicle_names')::text found")).rows[0].found;
 const previousNames=exists?(await db.query<ExistingName>('select * from public.catalog_vehicle_names where car_id=any($1::uuid[])',[report.rows.map(r=>r.id)])).rows:[];
 const counts:Record<string,{total:number;version:number;trim:number;generation:number;pendingTrim:number}>={};
 for(const r of report.rows){const s=counts[r.source]??={total:0,version:0,trim:0,generation:0,pendingTrim:0};s.total++;if(r.versionLine)s.version++;if(r.trim.label)s.trim++;if(r.generation.label)s.generation++;if(r.trim.status==='needs_review')s.pendingTrim++;}
 const result={runId,generatedAt:at,write,total:report.total,counts,sourceFieldsChanged:0,powerFieldsChanged:0,priceFieldsChanged:0,inputHash:createHash('sha256').update(proposalText).digest('hex'),backupPath:write?resolve(directory,`${runId}-backup.json`):null};
 await mkdir(directory,{recursive:true});
 if(write){
  const backup={...result,ids:report.rows.map(r=>r.id),previousNames,sourceRows:live,proposedNames};
  await writeFile(result.backupPath!,JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
  await db.query(await readFile('supabase/migrations/20261003_catalog_vehicle_names.sql','utf8'));
  for(let start=0;start<proposedNames.length;start+=250)await db.query(upsert,[JSON.stringify(proposedNames.slice(start,start+250))]);
  const saved=(await db.query<ExistingName>('select * from public.catalog_vehicle_names where run_id=$1',[runId])).rows;
  if(saved.length!==report.total)throw new Error('Written row count mismatch');
  const savedById=new Map(saved.map(r=>[r.car_id,r]));
  for(const r of proposedNames){const s=savedById.get(r.car_id);if(!s||['brand','model','generation_label','generation_full_name','modification_label','trim_label','version_line','compact_version'].some(k=>s[k as keyof ExistingName]!==r[k as keyof typeof r]))throw new Error(`Persisted label mismatch: ${r.car_id}`);}
  await db.query('commit');
 }else await db.query('rollback');
 await writeFile(resolve(directory,write?`${runId}-result.json`:'dry-run.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 }catch(e){await db.query('rollback');throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
