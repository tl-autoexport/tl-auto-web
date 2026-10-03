/** Read-only post-commit verification of the exact saved normalization run. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';
async function main(){
 const path=process.argv[2];if(!path)throw new Error('Pass the run backup JSON path');
 const backup=JSON.parse(await readFile(path,'utf8'));
 const env=parse(await readFile('.env.local','utf8'));
 const db=new Client({connectionString:env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
 await db.connect();
 try{
 await db.query('begin read only');
 const sourceRows=(await db.query(`select c.id,c.primary_source,c.source_id,c.brand,c.model,c.generation,c.grade,c.trim,c.badge,c.badge_detail,s.generation staging_generation,s.trim staging_trim
 from public.cars c left join public.chestny_catalog_staging s on c.primary_source='chestny_prigon' and s.source_listing_id=c.source_id
 where public.catalog_match(c,'{}'::jsonb) order by c.id`)).rows;
 if(JSON.stringify(sourceRows)!==JSON.stringify(backup.sourceRows))throw new Error('Source fields or published membership differ from pre-write backup');
 const rows=(await db.query('select * from public.catalog_vehicle_names where run_id=$1 order by car_id',[backup.runId])).rows;
 if(rows.length!==backup.ids.length)throw new Error('Coverage mismatch');
 const expected=new Map<string,Record<string,unknown>>(backup.proposedNames.map((r:Record<string,unknown>)=>[r.car_id,r]));
 for(const row of rows){const before=expected.get(row.car_id);if(!before)throw new Error('Unexpected saved car');
 for(const key of ['rules_version','run_id','brand','model','generation_label','generation_full_name','modification_label','trim_label','version_line','compact_version'])if(row[key]!==before[key])throw new Error(`Label mismatch: ${row.car_id}:${key}`);
 // PostgreSQL jsonb object key order differs; compare evidence recursively by normalized keys.
 if(stable(row.evidence)!==stable(before.evidence))throw new Error(`Evidence mismatch: ${row.car_id}`);
 }
 const counts=(await db.query(`select c.primary_source,count(*)::int total,count(n.car_id)::int normalized,count(n.version_line)::int version,count(n.trim_label)::int trim,count(n.generation_label)::int generation
 from public.cars c left join public.catalog_vehicle_names n on n.car_id=c.id where public.catalog_match(c,'{}'::jsonb) group by c.primary_source order by 1`)).rows;
 await db.query('set local role service_role');
 const serverReadCount=Number((await db.query('select count(*) total from public.catalog_vehicle_names where run_id=$1',[backup.runId])).rows[0].total);
 if(serverReadCount!==rows.length)throw new Error('Server read coverage mismatch');
 await db.query('commit');
 const result={runId:backup.runId,verifiedAt:new Date().toISOString(),readOnly:true,databaseWrites:0,total:rows.length,serverReadCount,originalSourceFieldsPreserved:true,evidencePreserved:true,counts};
 await writeFile(resolve(dirname(path),`${backup.runId}-verification.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 }finally{await db.end();}
}
function stable(v:unknown):string {if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}';return JSON.stringify(v);}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
