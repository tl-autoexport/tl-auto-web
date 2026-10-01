/** Transfer already-saved public Chestny data to its matching TL Auto cards. */
import { config } from "dotenv";
import { Client } from "pg";
import { mapStandardOptions } from "../src/server/imports/encar-options";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import { translateOption, translateTransmission, translateColor, translateInspectionLabel, translateInspectionStatus } from "../src/server/normalization/display";
import { normalizeDrive } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const sourceUrl = process.env.CHESTNY_SUPABASE_URL?.replace(/\/$/, "");
const sourceKey = process.env.CHESTNY_SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.CHESTNY_CARD_BACKFILL_WRITE === "true";
if (!sourceUrl || !sourceKey || !dbUrl) throw new Error("Chestny and TL Auto database credentials are required");
type Row = Record<string, unknown>;
type Plan = {
  id: string;
  history: Row | null;
  inspection: { items: Row[]; raw: Row } | null;
  options: Row[];
};
const arr = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Row[] : [];
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

async function sourceRows(table: string, select: string, ids?: string[]) {
  const output: Row[] = [];
  const batches = ids ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, (i + 1) * 500)) : [null];
  for (const batch of batches) {
    for (let offset = 0; ; offset += 500) {
      let url = `${sourceUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=500&offset=${offset}`;
      if (batch) url += `&source_listing_id=in.${encodeURIComponent(`(${batch.map(x=>`"${x}"`).join(",")})`)}`;
      else url += `&status=eq.active&is_public=eq.true`;
      const response=await fetch(url,{headers:{apikey:sourceKey!,Authorization:`Bearer ${sourceKey}`,Accept:"application/json"}});
      if(!response.ok) throw new Error(`Chestny ${table} HTTP ${response.status}`);
      const page=await response.json() as Row[]; output.push(...page); if(page.length<500) break;
    }
  }
  return output;
}

async function main() {
    const db=new Client({connectionString:dbUrl,ssl:{rejectUnauthorized:false},statement_timeout:30000}); await db.connect();
  try {
    const cars=(await db.query(`select id,source_id,transmission,drive_type,color,registration_date,registration_month,vehicle_specs from cars where primary_source='chestny_prigon' and is_available=true order by source_id`)).rows as Row[];
    const tlIds=[...new Set(cars.map(c=>String(c.source_id)))];
    const sourceVehicles=await sourceRows("vehicles","source_listing_id,status,is_public",tlIds);
    const eligible=new Set(sourceVehicles.filter(v=>v.status==="active"&&v.is_public===true).map(v=>String(v.source_listing_id)));
    const ids=[...eligible];
    const catalogs=await sourceRows("catalog_vehicles","source_listing_id,first_registration_date,transmission,drive_type,exterior_color,inspection_summary,accident_summary,report_options,report_status",ids);
    const byId=new Map(catalogs.map(r=>[String(r.source_listing_id),r]));
    const optionCatalog=await fetchStandardOptionCatalog();
    const eligibleCars=cars.filter(c=>eligible.has(String(c.source_id)));
    const existingReports=(await db.query(`select car_id,source,report_type,items from car_condition_reports where car_id=any($1::uuid[])`,[eligibleCars.map(c=>c.id)])).rows as Row[];
    const existingOptions=(await db.query(`select distinct car_id from car_options where car_id=any($1::uuid[])`,[eligibleCars.map(c=>c.id)])).rows as Row[];
    const hasChestnyHistory=new Set(existingReports.filter(r=>r.source==="chestny"&&r.report_type==="chestny_carhistory").map(r=>String(r.car_id)));
    const hasChestnyInspection=new Set(existingReports.filter(r=>r.source==="chestny"&&r.report_type==="chestny_inspection"&&arr(r.items).length>0).map(r=>String(r.car_id)));
    const hasAnyOptions=new Set(existingOptions.map(r=>String(r.car_id)));
    const report={dryRun:!write,publicActiveSourceVehicles:ids.length,tlActiveChestnyCards:cars.length,eligibleTlCards:eligibleCars.length,
      sourceCatalogRows:catalogs.length,sourceCatalogMissing:Math.max(0,ids.length-catalogs.length),
      attributesUpdated:0,historyInserted:0,inspectionInserted:0,optionsInserted:0,optionsWithoutSourceData:0,
      historySourceUnavailable:0,inspectionWithoutStructuredFindings:0,seatCountSourceFieldAvailable:false,
      missingAttributes:{transmission:0,drive:0,color:0,registrationDate:0}};
    const attributeRows:Row[]=[]; const otherPlans:Plan[]=[];
    for(const car of eligibleCars){
      const sourceRow=byId.get(String(car.source_id)); if(!sourceRow) continue;
      const rawDate=text(sourceRow.first_registration_date);
      const date=rawDate && /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0,10) : null;
      const month=date ? Number(date.slice(5,7)) : null;
      const transmission=text(sourceRow.transmission)?translateTransmission(text(sourceRow.transmission)!):null;
      const drive=normalizeDrive(text(sourceRow.drive_type));
      const color=text(sourceRow.exterior_color)?translateColor(text(sourceRow.exterior_color)!):null;
      const specs=car.vehicle_specs&&typeof car.vehicle_specs==="object"&&!Array.isArray(car.vehicle_specs)
        ? car.vehicle_specs as Row : {};
      const specsDate=date && !specs.first_registration_date ? {first_registration_date:date} : {};
      const fillTransmission=!car.transmission&&transmission;
      const fillDrive=!car.drive_type&&drive;
      const fillColor=!car.color&&color;
      const fillDate=!car.registration_date&&date;
      if(fillTransmission) report.missingAttributes.transmission++;
      if(fillDrive) report.missingAttributes.drive++;
      if(fillColor) report.missingAttributes.color++;
      if(fillDate) report.missingAttributes.registrationDate++;
      const specsToFill=fillDate?specsDate:{};
      if(fillTransmission||fillDrive||fillColor||fillDate||(!car.registration_month&&month))
        attributeRows.push({id:car.id,transmission:fillTransmission?transmission:null,drive:fillDrive?drive:null,color:fillColor?color:null,
          date:fillDate?date:null,month:!car.registration_month?month:null,specs:specsToFill});
      const accident=obj(sourceRow.accident_summary);
      const available=accident.available===true;
      if(!available) report.historySourceUnavailable++;
      const events=arr(accident.insuranceEvents).map(e=>({accident_date:text(e.date),amount:number(e.amountKrw),wage:number(e.laborKrw),component:number(e.partsKrw),painting:number(e.paintingKrw),kind:text(e.type),operations:text(e.type)?[text(e.type)]:[]})).filter(e=>e.accident_date||e.amount!==null);
      const history=available?{source:"chestny",available:true,my_car_accident_count:number(accident.ownAccidentCount)??number(accident.accidentCount),
        my_car_accident_cost:number(accident.ownAccidentCostKrw),other_car_accident_cost:number(accident.otherAccidentCostKrw),
        owner_changed_count:number(accident.ownerChangeCount),loan_count:number(accident.loanCount),theft_count:number(accident.theftCount),
        total_loss_count:number(accident.totalLossCount),flood_part_loss_count:number(accident.floodPartLossCount),
        flood_total_loss_count:number(accident.floodTotalLossCount),other_accident_count:number(accident.otherAccidentCount),
        accidentHistoryResponse:events}:null;
      const inspection=obj(sourceRow.inspection_summary);
      const checks=arr(inspection.checks),bodyFindings=arr(inspection.bodyFindings);
      const inspectionItems=[...checks.map(c=>{const label=text(c.title),status=text(c.status);return {label_ru:translateInspectionLabel(label??"")??label,label_original:label,children:status?[{label_ru:translateInspectionLabel(label??"")??label,label_original:label,status_ru:translateInspectionStatus(status)??status,status_original:status,status_code:null}]:[]};}),
        ...bodyFindings.map(b=>{const label=text(b.title),status=text(arr(b.statuses)[0]?.status);return {label_ru:translateInspectionLabel(label??"")??label,label_original:label,children:status?[{label_ru:translateInspectionLabel(label??"")??label,label_original:label,status_ru:translateInspectionStatus(status)??status,status_original:status,status_code:text(b.code)}]:[]};})]
        .filter(r=>r.label_original&&r.children.length);
      const optionCodes=list(inspection.standardOptionCodes).map(x=>typeof x==="string"||typeof x==="number"?String(x):null).filter((x):x is string=>x!==null);
      const standardOptions=mapStandardOptions(optionCatalog,optionCodes).filter(o=>o.is_present===true&&(o.name_ru||translateOption(o.name_original)));
      const choiceOptions=arr(sourceRow.report_options).map((o,i)=>({category:"Дополнительные опции",source_code:null,
        name_original:text(o.name),name_ru:translateOption(text(o.name)??"")??null,value_original:null,value_ru:null,
        price_krw:number(o.priceKrw),description_original:text(o.description),description_ru:null,is_present:true,sort_order:1000+i}))
        .filter(o=>o.name_ru||translateOption(o.name_original));
      if(!optionCodes.length&&!choiceOptions.length) report.optionsWithoutSourceData++;
      if(available&&!hasChestnyHistory.has(String(car.id))) otherPlans.push({id:String(car.id),history,inspection:null,options:[]});
      const inspectionPlan=inspectionItems.length&&!hasChestnyInspection.has(String(car.id))?{items:inspectionItems as Row[],raw:inspection}:null;
      const optionPlan=[...standardOptions,...choiceOptions];
      const optionsToInsert=optionPlan.length&&!hasAnyOptions.has(String(car.id))?optionPlan:[];
      if(inspectionPlan||optionsToInsert.length) otherPlans.push({id:String(car.id),history:null,inspection:inspectionPlan,options:optionsToInsert as Row[]});
      if(!inspectionItems.length) report.inspectionWithoutStructuredFindings++;
    }
    report.attributesUpdated=attributeRows.length;
    report.historyInserted=otherPlans.filter(p=>p.history).length;
    report.inspectionInserted=otherPlans.filter(p=>p.inspection).length;
    report.optionsInserted=otherPlans.filter(p=>p.options.length).length;
    if(write){
      for(let off=0;off<attributeRows.length;off+=100){const batch=attributeRows.slice(off,off+100);await db.query("begin");try{
        await db.query(`update cars c set transmission=coalesce(v.transmission,c.transmission),drive_type=coalesce(v.drive,c.drive_type),
          color=coalesce(v.color,c.color),registration_date=coalesce((v.date::timestamp at time zone 'Asia/Seoul'),c.registration_date),
          registration_month=coalesce(v.month,c.registration_month),vehicle_specs=coalesce(c.vehicle_specs,'{}'::jsonb)||v.specs
          from jsonb_to_recordset($1::jsonb) v(id uuid,transmission text,drive text,color text,date text,month int,specs jsonb)
          where c.id=v.id and c.primary_source='chestny_prigon' and c.is_available=true`,[JSON.stringify(batch)]);
        await db.query("commit");report.attributesUpdated+=batch.length;
      }catch(e){await db.query("rollback");throw e;}}
      for(let start=0;start<otherPlans.length;start+=50){const batch=otherPlans.slice(start,start+50);await db.query("begin");try{
        for(const plan of batch){
        if(plan.history){await db.query(`insert into car_condition_reports(car_id,source,report_type,summary,items,raw_payload) values($1,'chestny','chestny_carhistory',$2,$3,$4)`,
          [plan.id,JSON.stringify(plan.history),JSON.stringify(plan.history.accidentHistoryResponse),JSON.stringify(plan.history)]);report.historyInserted++;}
        if(plan.inspection){await db.query(`insert into car_condition_reports(car_id,source,report_type,summary,items,raw_payload) values($1,'chestny','chestny_inspection',$2,$3,$4)`,
          [plan.id,JSON.stringify({item_count:plan.inspection.items.length}),JSON.stringify(plan.inspection.items),JSON.stringify(plan.inspection.raw)]);report.inspectionInserted++;}
        if(plan.options.length){await db.query(`insert into car_options(car_id,source,category,source_code,name_original,name_ru,value_original,value_ru,price_krw,description_original,description_ru,is_present,sort_order)
          select $1,'chestny',x.category,x.source_code,x.name_original,x.name_ru,x.value_original,x.value_ru,x.price_krw,x.description_original,x.description_ru,x.is_present,x.sort_order
          from jsonb_to_recordset($2::jsonb) x(category text,source_code text,name_original text,name_ru text,value_original text,value_ru text,price_krw bigint,description_original text,description_ru text,is_present boolean,sort_order integer)`,[plan.id,JSON.stringify(plan.options)]);report.optionsInserted++;}
        }
        await db.query("commit");
      }catch(e){await db.query("rollback");throw e;}}
    }
    console.log(JSON.stringify(report,null,2));
  }finally{await db.end();}
}
void main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});
