/** Repair saved Encar data, without new vehicle requests, prices or seller text. */
import { config } from "dotenv";
import { Client } from "pg";
import { mapEncarOpenHistory } from "../src/server/imports/encar-history";
import { mapEncarOptions, type EncarOptionCatalog } from "../src/server/imports/encar-options";
import { translateTransmission, translateColor, translateDrive, translateInspectionLabel, translateInspectionStatus } from "../src/server/normalization/display";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const apply = process.env.ENCAR_CARD_BACKFILL_WRITE === "true";
const sourceId = process.env.ENCAR_CARD_BACKFILL_SOURCE_ID || null;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const inspectionNode = (v: unknown): Obj => {
  const node = obj(v);
  return { ...node, label_ru: translateInspectionLabel(obj(node.type).title as string),
    status_ru: translateInspectionStatus(obj(node.statusType).title as string),
    status_code: obj(node.statusType).code ?? null,
    children: Array.isArray(node.children) ? node.children.map(inspectionNode) : [] };
};
async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL required');
  const catalog: EncarOptionCatalog | null = process.env.ENCAR_OPTION_CATALOG_FILE
    ? JSON.parse(await readFile(process.env.ENCAR_OPTION_CATALOG_FILE, 'utf8')) : null;
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
  await db.connect();
  try {
    const rows = (await db.query(`
      select c.id,c.source_id,s.payload->'detail' detail,s.payload->'openHistory' history,
        s.payload->'inspection' inspection,s.payload->'choiceOptions' choices
      from cars c left join lateral (
        select payload from source_snapshots where source='encar' and source_id=c.source_id
        order by fetched_at desc limit 1
      ) s on true
      where c.primary_source='encar' and c.is_available=true and c.price_rub is not null
        and c.power_hp is not null and ($1::text is null or c.source_id=$1)
      order by c.source_id`, [sourceId])).rows;
    const report = { generatedAt: new Date().toISOString(), dryRun: !apply, activeCards: rows.length,
      savedDetails: 0, historyReports: 0, inspections: 0, options: 0, written: 0,
      standardOptionsCatalogAvailable: Boolean(catalog), vehicleRequests: 0 };
    const plans: Obj[] = [];
    for (const row of rows) {
      const detail = obj(row.detail), spec = obj(detail.spec), category = obj(detail.category);
      if (!Object.keys(detail).length) continue;
      report.savedDetails++;
      const history = mapEncarOpenHistory(obj(row.history));
      if (history) report.historyReports++;
      const inspection = obj(row.inspection);
      if (Array.isArray(inspection.inners)) report.inspections++;
      const codes = obj(detail.options);
      const options = catalog && Array.isArray(codes.standard)
        ? mapEncarOptions(catalog, codes.standard.map(String), row.choices,
          Array.isArray(codes.choice) ? codes.choice.map(String) : undefined) : null;
      if (options) report.options++;
      const first = obj(row.history).firstDate ?? obj(obj(inspection.master).detail).firstRegistrationDate;
      const date = typeof first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first
        : typeof first === 'string' && /^\d{8}$/.test(first) ? `${first.slice(0,4)}-${first.slice(4,6)}-${first.slice(6,8)}` : null;
      const ym = String(category.yearMonth ?? '');
      const month = date ? Number(date.slice(5,7)) : /^\d{6}$/.test(ym) && Number(ym.slice(4)) >= 1 && Number(ym.slice(4)) <= 12 ? Number(ym.slice(4)) : null;
      plans.push({id:row.id, transmission:spec.transmissionName ? translateTransmission(spec.transmissionName as string) : null,
        date,month,color:spec.colorName ? translateColor(spec.colorName as string) : null,
        drive:translateDrive(spec.driveTypeName as string),specs:{...(spec.seatCount ? {seats:spec.seatCount} : {}),...(date ? {first_registration_date:date} : {})},
        history,options,inspection:Array.isArray(inspection.inners) ? inspection : null,
        items:Array.isArray(inspection.inners) ? inspection.inners.map(inspectionNode) : []});
    }
    if (apply) for (let offset=0;offset<plans.length;offset+=100) {
      const batch=JSON.stringify(plans.slice(offset,offset+100));
      await db.query('begin');
      try {
        await db.query(`create temporary table card_repair on commit drop as
          select r.* from jsonb_to_recordset($1::jsonb) r(id uuid,transmission text,date date,month integer,
            color text,drive text,specs jsonb,history jsonb,options jsonb,inspection jsonb,items jsonb)
          join cars c on c.id=r.id where c.is_available=true and c.primary_source='encar'`,[batch]);
        await db.query(`select c.id from cars c join card_repair r on r.id=c.id for update of c`);
        const changed=await db.query(`update cars c set transmission=coalesce(r.transmission,c.transmission),
          registration_date=coalesce(r.date,c.registration_date),registration_month=coalesce(r.month,c.registration_month),
          color=coalesce(r.color,c.color),drive_type=coalesce(r.drive,c.drive_type),
          vehicle_specs=coalesce(c.vehicle_specs,'{}'::jsonb)||r.specs from card_repair r where c.id=r.id`);
        await db.query(`delete from car_condition_reports h using card_repair r
          where h.car_id=r.id and h.report_type='encar_carhistory' and r.history is not null`);
        await db.query(`insert into car_condition_reports(car_id,source,report_type,summary,items,raw_payload)
          select id,'encar','encar_carhistory',history->'summary',history->'items',history->'raw_payload'
          from card_repair where history is not null`);
        await db.query(`update car_condition_reports h set items=r.items,
          raw_payload=coalesce(h.raw_payload,'{}'::jsonb)||jsonb_build_object('inspection',r.inspection)
          from card_repair r where h.car_id=r.id and h.report_type='encar_inspection' and r.inspection is not null`);
        await db.query(`insert into car_condition_reports(car_id,source,report_type,summary,items,raw_payload)
          select r.id,'encar','encar_inspection',jsonb_build_object('body_findings_count',
            jsonb_array_length(coalesce(r.inspection->'outers','[]'::jsonb))),r.items,
            jsonb_build_object('inspection',r.inspection) from card_repair r where r.inspection is not null
            and not exists(select 1 from car_condition_reports h where h.car_id=r.id and h.report_type='encar_inspection')`);
        await db.query(`delete from car_options o using card_repair r where o.car_id=r.id and o.source='encar' and r.options is not null`);
        await db.query(`insert into car_options(car_id,source,category,source_code,name_original,name_ru,value_original,
          value_ru,price_krw,description_original,description_ru,is_present,sort_order)
          select r.id,'encar',o.category,o.source_code,o.name_original,o.name_ru,o.value_original,o.value_ru,
          o.price_krw,o.description_original,o.description_ru,o.is_present,o.sort_order from card_repair r
          cross join lateral jsonb_to_recordset(r.options) o(category text,source_code text,name_original text,name_ru text,
            value_original text,value_ru text,price_krw bigint,description_original text,description_ru text,
            is_present boolean,sort_order integer) where r.options is not null`);
        await db.query('commit');report.written+=changed.rowCount ?? 0;
        console.log(JSON.stringify({event:'progress',written:report.written,total:plans.length}));
      } catch(error) {await db.query('rollback');throw error;}
    }
    console.log(JSON.stringify(report,null,2));
  } finally { await db.end(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; });
