/** Both TL Auto catalogue sources, saved data only. No power/price changes. */
import {config} from 'dotenv';import {Client} from 'pg';import {readFile,writeFile,mkdir}from'node:fs/promises';
import{normalizeTransmissionType,catalogDriveType}from'../src/server/normalization/drivetrain';
config({path:'.env.local',quiet:true});config({path:'.env',quiet:true});
const write=process.env.TL_AUTO_DRIVETRAIN_WRITE==='true';
type JsonRecord=Record<string,unknown>;
type CatalogInput={id:string;primary_source:string;source_id:string;brand:string|null;model:string|null;year:number|null;engine_cc:number|null;fuel_type:string|null;badge:string|null;badge_detail:string|null;grade:string|null;trim:string|null;transmission:string|null;drive_type:string|null;vehicle_specs:JsonRecord|null;staging_transmission:string|null;staging_drive:string|null;source_payload:JsonRecord|null};
const asRecord=(value:unknown):JsonRecord=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{};
const norm=(v:unknown)=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
function identity(c:CatalogInput){const p=asRecord(c.source_payload);const d=asRecord(p.detail);const category=asRecord(d.category);const l=asRecord(p.list);return {brand:norm(c.brand),model:norm(c.model),year:Number(category.formYear??l.FormYear??c.year),cc:Number(c.engine_cc),fuel:c.fuel_type,text:[c.badge,c.badge_detail,c.grade,c.trim,category.gradeName,category.gradeEnglishName,category.gradeDetailName,l.Badge,l.BadgeDetail].filter(Boolean).join(' ')};}
function modelTransmission(c:CatalogInput,drive:string|null):{value:string;basis:string}|null{
 const x=identity(c);const {brand:b,model:m,year:y,cc,fuel:f,text:t}=x;
 const result=(value:string,basis:string)=>({value,basis});
 if(b==='hyundai'&&m==='venue'&&cc===1598)return result('cvt','venue-smartstream-ivt');
 if((b==='kia'&&m==='niro'||b==='hyundai'&&m==='ioniq')&&f==='hybrid')return result('dct','hyundai-kia-hybrid-dct');
 if(b==='hyundai'&&m==='kona'&&f==='gasoline'&&cc===1591&&y>=2017&&y<=2022)return result('dct','kona-1.6-dct');
 if(b==='kia'&&m==='seltos'&&f==='gasoline'&&cc===1591&&y<=2022)return result('dct','seltos-first-1.6-dct');
 if(b==='kia'&&m==='seltos'&&f==='gasoline'&&cc===1999)return result('cvt','seltos-two-litre-ivt');
 if(b==='hyundai'&&['avante','elantra'].includes(m)){
  if(f==='hybrid'&&y>=2020&&cc===1580)return result('dct','avante-hybrid-dct');
  if(f==='gasoline'&&y>=2016&&/turbo|터보|n.line/i.test(t)&&cc<1700)return result('dct','avante-turbo-dct');
  if(f==='gasoline'&&y>=2019&&cc===1598)return result('cvt','avante-smartstream-ivt');
 }
 if(b==='kia'&&m==='k3'&&y>=2018){if(/turbo|터보|gt/i.test(t)&&cc<1700)return result('dct','k3-gt-dct');if(cc===1598&&f==='gasoline')return result('cvt','k3-smartstream-ivt');}
 if(b==='kia'&&m==='sportage'&&f==='gasoline'&&cc>=1590&&cc<=1600&&y>=2016&&y<=2024)return result('dct','sportage-1.6-dct');
 if(b==='hyundai'&&m==='tucson'&&y>=2015&&((f==='gasoline'&&cc<1700)||(f==='diesel'&&cc<1700)))return result('dct','tucson-1.6-dct');
 if(['kia','hyundai'].includes(b)&&['sorento','santafe','santafe'].includes(m)&&y>=2021&&f!=='hybrid'&&((f==='diesel'&&cc===2151)||(f==='gasoline'&&cc===2497)))return result('dct','smartstream-suv-wet-dct');
 if(b==='chevrolet'&&m==='spark'&&(cc===999||/spark.?s|스파크.?s|c.tech/i.test(t)))return result('cvt','spark-c-tech');
 if(b==='chevrolet'&&m==='malibu'&&f==='gasoline'&&cc===1341&&y>=2019)return result('cvt','malibu-1.35-cvt');
 if(b==='chevrolet'&&m==='trailblazer'&&drive==='2WD')return result('cvt','trailblazer-fwd-cvt');
 if(b==='mercedesbenz'&&/^(aclass|bclass|cla|claclass|gla|glaclass|glb|glbclass)$/.test(m)&&y>=2013)return result('dct','mercedes-compact-dct');
 if(b==='volkswagen'&&['golf','tiguan','tiguanallspace','arteon','cc','scirocco','sharan','passat','passatgt'].includes(m)&&y>=2008)return result('dct','vw-dsg-preliminary-version');
 if(['renaultkorea','renaultsamsung','renault'].includes(b)){
  if(['xm3','arkana'].includes(m)&&f==='gasoline')return result(cc>1500?'cvt':'dct','renault-xm3-engine-version');
  if(m==='qm3')return result('dct','qm3-edc');
  if(m==='qm6')return result('cvt','qm6-xtronic');
  if(m==='sm6'){if(cc===1997||cc===1998||f==='lpg')return result('cvt','sm6-cvt');if(cc===1332||cc===1618||f==='diesel')return result('dct','sm6-edc');}
 }
 if(f==='electric')return result('automatic','electric_nonmanual_catalog_category');
 if(b==='genesis'&&['g80','g90','gv70','gv80'].includes(m)&&y>=2020)return result('automatic','genesis-eight-speed-auto');
 if(b==='mercedesbenz'&&['eclass','glc','gle'].includes(m)&&y>=2016)return result('automatic','mercedes-longitudinal-tronic');
 if(b==='bmw'&&['3series','5series','x7'].includes(m)&&y>=2015)return result('automatic','bmw-steptronic');
 if(b==='landrover'&&m==='discoverysport'&&y>=2015)return result('automatic','landrover-nine-speed-auto');
 if(b==='kia'&&m==='k5'&&f==='gasoline'&&cc>=1998&&cc<=2000)return result('automatic','k5-two-litre-auto');
 if(b==='kia'&&m==='carnival'&&y>=2010)return result('automatic','carnival-auto');
 if(b==='hyundai'&&['sonata','palisade'].includes(m)&&y>=2020&&!(m==='sonata'&&cc===2497))return result('automatic','hyundai-conventional-auto');
 if(b==='kia'&&m==='sportage'&&f==='diesel'&&cc>=1995&&cc<=2000&&y>=2021)return result('automatic','sportage-two-litre-diesel-auto');
 return null;
}
function drivetrain(c:CatalogInput){const x=identity(c);const p=asRecord(c.source_payload);const detail=asRecord(p.detail);const spec=asRecord(detail.spec);const list=asRecord(p.list);const rawTransmission=spec.transmissionName??list.Transmission??c.staging_transmission??c.transmission;
 const sourceType=normalizeTransmissionType(rawTransmission);const storedType=normalizeTransmissionType(c.transmission);const specific=sourceType==='manual'?sourceType:storedType&&storedType!=='automatic'?storedType:sourceType;const marker=catalogDriveType(x.text);const existing=catalogDriveType(c.drive_type);const assumed=c.vehicle_specs?.drive_source==='assumed'||String(c.vehicle_specs?.drive_resolution??'').includes('assumed');
 const standard4=x.brand==='landrover'&&!/eD4|e.d4|2wd|2륜/i.test(x.text)||x.brand==='porsche'&&['cayenne','macan'].includes(x.model)||x.brand==='jeep'&&['wrangler','gladiator','grandcherokee'].includes(x.model)||x.brand==='cadillac'&&x.model==='escalade';
 let drive=marker??(standard4? '4WD':existing);let driveBasis=marker?'source_grade':standard4?'standard_model_drivetrain':existing?(assumed?'existing_assumption':'existing_source'):null;
 if(!drive&&x.text){drive='2WD';driveBasis='source_grade_without_awd_marker_preliminary';}
 const rule=specific!=='manual'&&specific!=='cvt'&&specific!=='dct'?modelTransmission(c,drive):null;
 const transmission=rule?.value??specific;const transmissionBasis=rule?.basis??(specific?'source_transmission':null);
 return {id:c.id,source:c.primary_source,sourceId:c.source_id,brand:c.brand,model:c.model,year:x.year,fuel:c.fuel_type,cc:x.cc,text:x.text,oldTransmission:c.transmission,oldDrive:c.drive_type,transmission,drive,transmissionBasis,driveBasis};}
async function main(){await mkdir('output/catalog-drivetrain',{recursive:true});const cars=JSON.parse(await readFile('output/catalog-drivetrain/slim.json','utf8')) as CatalogInput[];const rows=cars.map(drivetrain);
 // Recover missing transmission only from unambiguous peers with the same engine/year.
 const peers=new Map<string,Set<string>>();const key=(r:typeof rows[number])=>[norm(r.brand),norm(r.model),r.year,r.fuel,r.cc].join('|');for(const r of rows){if(r.transmission){const k=key(r);peers.set(k,new Set([...(peers.get(k)??[]),r.transmission]));}}
 for(const r of rows){if(!r.transmission){const values=peers.get(key(r));if(values?.size===1){r.transmission=[...values][0];r.transmissionBasis='same_model_year_engine_peer_preliminary';}}}
 const missing=rows.filter((r)=>!r.transmission||!r.drive);const updates=rows.filter((r)=>r.transmission&&r.drive);
 const summary:{total:number;complete:number;missing:number;bySource:Record<string,{total:number;complete:number}>;transmissions:Record<string,number>;drives:Record<string,number>}={total:rows.length,complete:updates.length,missing:missing.length,bySource:{},transmissions:{},drives:{}};for(const r of rows){summary.bySource[r.source]??={total:0,complete:0};summary.bySource[r.source].total++;if(r.transmission&&r.drive)summary.bySource[r.source].complete++;const transmissionKey=r.transmission??'missing';const driveKey=r.drive??'missing';summary.transmissions[transmissionKey]=(summary.transmissions[transmissionKey]??0)+1;summary.drives[driveKey]=(summary.drives[driveKey]??0)+1;}
 await writeFile('output/catalog-drivetrain/plan.json',JSON.stringify({generatedAt:new Date().toISOString(),summary,rows,missing},null,2));console.log(JSON.stringify(summary,null,2));
 if(!write)return;
 const db=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await db.connect();try{await db.query('begin');await db.query("select pg_advisory_xact_lock(hashtext('tl-auto-catalog-drivetrain'))");
 const backup=(await db.query('select id,transmission,drive_type,vehicle_specs from public.cars where id=any($1::uuid[])',[updates.map((r)=>r.id)])).rows;await writeFile('output/catalog-drivetrain/before-write.json',JSON.stringify(backup));
 const values=updates.map((r)=>({id:r.id,transmission:r.transmission,drive:r.drive,old_transmission:r.oldTransmission,old_drive:r.oldDrive,metadata:{version:'tl-auto-drivetrain-20261003',transmission:{value:r.transmission,basis:r.transmissionBasis,confidence:r.transmissionBasis==='source_transmission'?'source':'preliminary'},drive:{value:r.drive,basis:r.driveBasis,confidence:r.driveBasis==='source_grade'?'source':'preliminary'}}}));
 await db.query(await readFile('supabase/migrations/20261003_catalog_drivetrain_display.sql','utf8'));
 const result=await db.query(`update public.cars c set transmission=x.transmission,drive_type=x.drive,vehicle_specs=coalesce(c.vehicle_specs,'{}'::jsonb)||jsonb_build_object('drivetrain_normalization',x.metadata) from jsonb_to_recordset($1::jsonb) x(id uuid,transmission text,drive text,old_transmission text,old_drive text,metadata jsonb) where c.id=x.id and c.transmission is not distinct from x.old_transmission and c.drive_type is not distinct from x.old_drive and public.catalog_match(c,'{}'::jsonb)`,[JSON.stringify(values)]);if(result.rowCount!==updates.length)throw Error('Catalogue changed during normalization; transaction rolled back');await db.query('commit');console.log(JSON.stringify({write:true,updated:result.rowCount,remaining:missing.length}));await writeFile('output/catalog-drivetrain/applied.json',JSON.stringify({summary,updated:result.rowCount,remaining:missing},null,2));}catch(e){await db.query('rollback');throw e;}finally{await db.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
