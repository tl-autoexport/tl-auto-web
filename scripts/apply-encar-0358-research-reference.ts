/** Import reconciled research as preliminary references, preserving unresolved source rows. */
/* eslint-disable @typescript-eslint/no-explicit-any -- This one-off import validates heterogeneous archived JSON and PostgreSQL rows at runtime before writing. */
import { config } from 'dotenv';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveAutomaticPowerReference } from '../src/server/catalog/automatic-power-reference';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
const runId = '0358e068-1002-4594-ae08-40c3a22b6524';
const write = process.env.ENCAR_0358_REFERENCE_WRITE === 'true';
async function main() {
  const report = JSON.parse(await readFile('output/encar-run-0358-reference-reconciliation.json','utf8'));
  const plan = JSON.parse(await readFile('output/encar-run-0358-before-reference-plan.json','utf8'));
  if (report.runId !== runId || plan.runId !== runId || report.baseline.needsResearch !== 278 || report.sourceRows.length !== 278 || report.missing.length || report.conflicts.length) throw Error('Reconciliation incomplete');
  const sourceIds = new Set(report.sourceRows.map((r:any)=>r.sourceListingId));
  const planIds = new Set(plan.candidates.map((r:any)=>r.sourceListingId));
  if (sourceIds.size !== 278 || [...sourceIds].some(id=>!planIds.has(id))) throw Error('Source ID mismatch');
  const rows = report.insertRows;
  if (new Set(rows.map((r:any)=>r.configuration_key)).size !== rows.length) throw Error('Duplicate matchers');
  const payload = {runId,sourceRows:report.sourceRows,rows};
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const db = new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await db.connect();
  try {
    await db.query(write?'begin':'begin read only');
    if (write) await db.query("select pg_advisory_xact_lock(hashtext('encar-0358-power-research'))");
    const allBefore = (await db.query('select * from public.vehicle_power_automatic_reference')).rows;
    const existing = allBefore.filter(r=>rows.some((x:any)=>x.configuration_key===r.configuration_key));
    if (existing.some(r=>r.status!=='automatic' || rows.some((x:any)=>x.configuration_key===r.configuration_key && Math.abs(Number(r.power_kw)-x.power_kw)>0.02))) throw Error('Existing protected or conflicting reference');
    let batchId: string | null = null;
    let inserted = 0;
    if (write) {
      const batch = await db.query(`insert into public.vehicle_power_source_batches(source_kind,source_name,source_uri,source_sha256,source_version,imported_by,metadata)
        values ('manual','Encar 0358 reconciled open-source power research',$1,$2,'encar-0358-reconciled-v1','codex-user-authorized',$3::jsonb)
        on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata returning id`,
        ['local-file:encar-run-0358-open-research.json',hash,JSON.stringify({runId,sourceListings:278,referenceConfigurations:rows.length,evidenceFinality:'preliminary',excludedOtherRunListings:report.outsideRun.length})]);
      batchId = batch.rows[0].id;
      const activeIds = new Set(rows.flatMap((r:any)=>r.listingIds));
      for (const [i,r] of report.sourceRows.entries()) {
        const power = r.candidatePower??r.power;
        await db.query(`insert into public.vehicle_power_source_rows(batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status,parse_warnings)
          values ($1,'encar-0358',$2,$3::jsonb,$4,$5,$6,$7::text[]) on conflict (batch_id,source_sheet,source_row_number) do nothing`,
          [batchId,i+1,JSON.stringify(r),`${r.configuration.brand} ${r.configuration.model}`,typeof power==='object'?JSON.stringify(power):power,activeIds.has(r.sourceListingId)?'parsed':'needs_review',['Preliminary research; not approved power evidence']]);
      }
      const result = await db.query(`insert into public.vehicle_power_automatic_reference(configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note)
        select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note
        from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)
        on conflict (configuration_key) do nothing returning configuration_key`,[JSON.stringify(rows)]);
      inserted = result.rowCount??0;
    }
    const after = write?(await db.query('select * from public.vehicle_power_automatic_reference')).rows:[...allBefore,...rows.filter((r:any)=>!allBefore.some((x:any)=>x.configuration_key===r.configuration_key))];
    for (const r of rows) {
      const saved = after.find((x:any)=>x.configuration_key===r.configuration_key);
      if (!saved || saved.status!=='automatic' || Math.abs(Number(saved.power_kw)-r.power_kw)>0.02) throw Error('Reference verification failed');
    }
    const outcome = {runId,write,batchId,sourceRows:278,newReferenceConfigurations:write?inserted:rows.length-existing.length,existingReferences:existing.length,newlyCoveredListings:rows.flatMap((r:any)=>r.listingIds).length,approved:0,finality:'preliminary',remaining:report.blocked.map((r:any)=>({sourceListingId:r.sourceListingId,configuration:r.research.configuration,reason:r.reason}))};
    const approvedIds = new Set(plan.candidates.filter((r:any)=>r.status==='approved_match').map((r:any)=>r.sourceListingId));
    const automaticIds = plan.candidates.filter((r:any)=>!approvedIds.has(r.sourceListingId)&&resolveAutomaticPowerReference({brand:r.configuration.brand,model:r.configuration.model,fuel_type:r.configuration.fuelType,engine_cc:r.configuration.engineCc,drive_type:r.configuration.driveType,badge:r.configuration.badge,badge_detail:r.configuration.trim,source_listing_id:r.sourceListingId,year:r.configuration.year},after.filter((r:any)=>r.status==='automatic'))).map((r:any)=>r.sourceListingId);
    const summary = {approved:approvedIds.size,preliminary:automaticIds.length,unresolved:500-approvedIds.size-automaticIds.length,total:500};
    if (write) {
      const count = await db.query('select count(*)::int n from public.vehicle_power_source_rows where batch_id=$1',[batchId]);
      if (count.rows[0].n!==278) throw Error('Source row verification failed');
      await db.query('commit');
    } else await db.query('rollback');
    await writeFile(`output/encar-run-0358-reference-${write?'applied':'preview'}.json`,JSON.stringify({...outcome,summary,hash},null,2)+'\n');
    console.log(JSON.stringify({...outcome,remaining:outcome.remaining.map((r:any)=>r.sourceListingId),summary},null,2));
  } catch(e) {await db.query('rollback').catch(()=>{});throw e;} finally {await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
