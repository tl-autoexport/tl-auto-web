/** Persist names during publication/import using the same resolver as catalogue audits. */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import taxonomy from '../../../data/catalog-naming/encar-taxonomy-v1.json';
import generationAliases from '../../../data/catalog-naming/generation-aliases-v1.json';
import { createCatalogNamingResolver, type Car, type Node, type GenerationAlias, type SourceNames } from './catalog-naming-resolver';
import { namingRulesVersion } from './catalog-naming';
const runId=randomUUID();
const resolveCurrent=createCatalogNamingResolver(taxonomy.nodes as Node[],generationAliases.aliases as GenerationAlias[]);
const carFields='id,primary_source,source_id,brand,model,generation,generation_code,trim,grade,badge,badge_detail,year';
function sourceNames(category:Record<string,unknown>={},list:Record<string,unknown>={}):SourceNames {
 const text=(v:unknown)=>v===null||v===undefined?null:String(v);
 return {manufacturerCode:text(category.manufacturerCd),modelGroupCode:text(category.modelGroupCd),generationCode:text(category.modelCd),modificationCode:text(category.gradeCd),trimCode:text(category.gradeDetailCd),domestic:text(category.domestic),generationKr:text(category.modelName),modificationEn:text(category.gradeEnglishName),modificationKr:text(category.gradeName),trimEn:text(category.gradeDetailEnglishName),trimKr:text(category.gradeDetailName),listGenerationKr:text(list.Model),listModificationKr:text(list.Badge),listTrimKr:text(list.BadgeDetail)};
}
function resolveName(car:Car){
 const r=resolveCurrent([car]).rows[0];
 if(!r.brand||!r.model||[r.generation.status,r.modification.status,r.trim.status].includes('conflict'))throw new Error(`Naming conflict for ${car.source_id}`);
 return {car_id:car.id,rules_version:namingRulesVersion,run_id:runId,brand:r.brand,model:r.model,generation_label:r.generation.label,generation_full_name:r.generation.fullName,modification_label:r.modification.label,trim_label:r.trim.status==='needs_review'?null:r.trim.label,version_line:r.versionLine,compact_version:r.compactVersion,evidence:{source:car.primary_source,sourceListingId:car.source_id,original:r.original,sourceNames:car.source_names,generation:r.generation,modification:r.modification,trim:r.trim,issues:r.issues},normalized_at:new Date().toISOString()};
}
export async function persistCatalogNamingPg(db:Client,carId:string){
 const r=await db.query<Car & {category:Record<string,unknown>|null;list:Record<string,unknown>|null}>(`select c.id,c.primary_source,c.source_id,c.brand,c.model,c.generation,c.generation_code,c.trim,c.grade,c.badge,c.badge_detail,c.year,
 st.generation staging_generation,st.trim staging_trim,s.payload#>'{detail,category}' category,s.payload->'list' list
 from public.cars c left join public.chestny_catalog_staging st on c.primary_source='chestny_prigon' and st.source_listing_id=c.source_id
 left join lateral(select payload from public.source_snapshots where source='encar' and source_id=c.source_id order by fetched_at desc limit 1)s on true where c.id=$1`,[carId]);
 if(!r.rows[0])throw new Error(`Car not found for naming: ${carId}`);
 const car=r.rows[0];car.source_names=sourceNames(car.category??{},car.list??{});
 const payload=resolveName(car);const keys=Object.keys(payload);const values=keys.map(k=>payload[k as keyof typeof payload]);
 await db.query(`insert into public.catalog_vehicle_names(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict(car_id) do update set ${keys.filter(k=>k!=='car_id').map(k=>`${k}=excluded.${k}`).join(',')}`,values);
}
export async function persistCatalogNamingSupabase(db:SupabaseClient,carId:string){
 const result=await db.from('cars').select(carFields).eq('id',carId).single();if(result.error)throw result.error;
 const car=result.data as unknown as Car;
 const [snapshot,staging]=await Promise.all([
 db.from('source_snapshots').select('category:payload->detail->category,list:payload->list').eq('source','encar').eq('source_id',car.source_id).order('fetched_at',{ascending:false}).limit(1).maybeSingle(),
 car.primary_source==='chestny_prigon'?db.from('chestny_catalog_staging').select('generation,trim').eq('source_listing_id',car.source_id).maybeSingle():Promise.resolve({data:null,error:null}),
 ]);
 if(snapshot.error)throw snapshot.error;if(staging.error)throw staging.error;
 car.staging_generation=staging.data?.generation??null;car.staging_trim=staging.data?.trim??null;
 car.source_names=sourceNames(snapshot.data?.category as Record<string,unknown>??{},snapshot.data?.list as Record<string,unknown>??{});
 const saved=await db.from('catalog_vehicle_names').upsert(resolveName(car),{onConflict:'car_id'});if(saved.error)throw saved.error;
}
