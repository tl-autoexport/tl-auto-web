/** Snapshot precisely the visible TL Auto catalogue, including electric cards. */
import{config}from'dotenv';import{Client}from'pg';import{mkdir,writeFile}from'node:fs/promises';
config({path:'.env.local',quiet:true});config({path:'.env',quiet:true});
async function main(){const d=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await d.connect();try{
const rows=(await d.query(`with latest as (select distinct on (source_id) source_id,
 jsonb_build_object('detail',jsonb_build_object('spec',payload->'detail'->'spec','category',payload->'detail'->'category'),
 'list',jsonb_build_object('Badge',payload->'list'->'Badge','BadgeDetail',payload->'list'->'BadgeDetail','FormYear',payload->'list'->'FormYear','Transmission',payload->'list'->'Transmission')) source_payload
 from public.source_snapshots where source='encar' order by source_id,fetched_at desc)
 select c.id,c.primary_source,c.source_id,c.brand,c.model,c.year,c.fuel_type,c.engine_cc,c.badge,c.badge_detail,c.grade,c.trim,c.transmission,c.drive_type,c.vehicle_specs,
 st.transmission staging_transmission,st.drive_type staging_drive,l.source_payload
 from public.cars c left join public.chestny_catalog_staging st on c.primary_source='chestny_prigon' and st.source_listing_id=c.source_id
 left join latest l on l.source_id=c.source_id
 where public.catalog_match(c,'{}'::jsonb) order by c.primary_source,c.source_id`)).rows;
await mkdir('output/catalog-drivetrain',{recursive:true});await writeFile('output/catalog-drivetrain/slim.json',JSON.stringify(rows));const counts:Record<string,{total:number;missingTransmission:number;missingDrive:number}>={};for(const r of rows){counts[r.primary_source]??={total:0,missingTransmission:0,missingDrive:0};counts[r.primary_source].total++;if(!r.transmission||r.transmission==='-')counts[r.primary_source].missingTransmission++;if(!r.drive_type)counts[r.primary_source].missingDrive++;}console.log(JSON.stringify(counts,null,2));
}finally{await d.end()}}main().catch(e=>{console.error(e.message);process.exitCode=1});
