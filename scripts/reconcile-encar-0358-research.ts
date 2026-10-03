/* eslint-disable @typescript-eslint/no-explicit-any -- Research batches and database rows are heterogeneous JSON; this audit validates their shape at runtime. */
import { config } from 'dotenv';
import { Client } from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveAutomaticPowerReference } from '../src/server/catalog/automatic-power-reference';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
const runId = '0358e068-1002-4594-ae08-40c3a22b6524';
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
async function main() {
  const plan = JSON.parse(await readFile('output/encar-run-0358-before-reference-plan.json', 'utf8'));
  const research = JSON.parse(await readFile('data/power-reference/encar-run-0358-open-research.json', 'utf8'));
  if (plan.runId !== runId || research.runId !== runId || plan.candidates.length !== 500) throw Error('Run mismatch');
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const refs = (await db.query("select * from public.vehicle_power_automatic_reference where status='automatic'")).rows;
    const candidates = new Map<string, any>(plan.candidates.map((r: any) => [r.sourceListingId, r]));
    const baseline = plan.candidates.filter((r: any) => r.status === 'unmatched' && resolveAutomaticPowerReference({ brand:r.configuration.brand, model:r.configuration.model, fuel_type:r.configuration.fuelType, engine_cc:r.configuration.engineCc, drive_type:r.configuration.driveType, badge:r.configuration.badge, badge_detail:r.configuration.trim, source_listing_id:r.sourceListingId,year:r.configuration.year }, refs));
    const frozenTargets = research.reconciliationMeta?.targetListingIds;
    const frozenTargetIds = frozenTargets ? new Set(frozenTargets) : null;
    const baselineIds = frozenTargetIds
      ? new Set(plan.candidates.filter((r:any)=>r.status!=='approved_match'&&!frozenTargetIds.has(r.sourceListingId)).map((r:any)=>r.sourceListingId))
      : new Set(baseline.map((r: any) => r.sourceListingId));
    const targets = plan.candidates.filter((r: any) => r.status !== 'approved_match' && !baselineIds.has(r.sourceListingId));
    const targetIds = new Set(targets.map((r: any) => r.sourceListingId));
    const byId = new Map<string, any>();
    const outsideRun: any[] = [], recovered: any[] = [];
    for (const batch of ['candidates', ...Object.keys(research).filter(k => /^batch.*Research$/.test(k)), 'reconciliationResearch']) {
      for (const original of research[batch]) {
        const row = structuredClone(original);
        let id = String(row.sourceListingId ?? row.id ?? '');
        if (!id && row.configuration) {
          const matches = plan.candidates.filter((r: any) => ['brand','model','year','engineCc','fuelType','badge','trim'].every(k => norm(r.configuration[k]) === norm(row.configuration[k])));
          if (matches.length === 1) { id = matches[0].sourceListingId; recovered.push({batch,id}); }
        }
        if (!candidates.has(id)) { outsideRun.push({batch,id,row}); continue; }
        byId.set(id, { ...row, sourceListingId:id, batch, configuration:candidates.get(id).configuration });
      }
    }
    const rows: any[] = [], blocked: any[] = [];
    for (const [id,r] of byId) {
      if (!targetIds.has(id)) continue;
      const power = r.candidatePower ?? r.power;
      const raw = typeof power === 'object' ? `${power.value} ${power.unit}` : String(power ?? '');
      const st = r.researchStatus ?? r.status ?? r.evidenceStatus ?? '';
      const uri = typeof r.source === 'string' ? r.source : r.source?.uri;
      const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(PS|hp(?: SAE)?|kW)\b/i);
      if (!match || /\bor\b|\s\/\s/.test(raw) || /review_requires|conversion_power/.test(st) || !uri || !/^https?:\/\//.test(uri) || /Model=$|Lineup=$|phaeton-v8-engine-$/.test(uri)) {
        blocked.push({sourceListingId:id,reason:!uri?'source_missing':'power_or_variant_unresolved',research:r}); continue;
      }
      const value = Number(match[1]);
      const kw = value * (/^hp/i.test(match[2]) ? 0.7456998715822702 : /^PS$/i.test(match[2]) ? 0.73549875 : 1);
      const c = r.configuration;
      if (!c.brand || !c.model || !c.year || !c.engineCc || !c.fuelType) { blocked.push({sourceListingId:id,reason:'configuration_missing',research:r});continue; }
      const key = [norm(c.brand),norm(c.model),norm(c.fuelType),c.engineCc,norm(c.driveType),norm(c.badge),norm(c.trim),`year=${c.year}-${c.year}`].join('|') + (r.listingScoped ? `|listing=${id}` : '');
      rows.push({ configuration_key:key,brand:c.brand,model:c.model,fuel_type:c.fuelType,engine_cc:c.engineCc,drive_type:c.driveType,badge:c.badge,badge_detail:c.trim,year_from:c.year,year_to:c.year,power_hp:Number((kw/0.73549875).toFixed(6)),power_kw:Number(kw.toFixed(6)),source:'manual_web_research_0358',status:'automatic',note:`Предварительный исследовательский кандидат; run ${runId}; Encar ${id}; источник ${uri}; исходная мощность ${raw}; статус ${st}; ${r.researchNote??r.note??r.source?.note??''}`,listingId:id,sourceUrl:uri,rawPower:raw });
    }
    const grouped = new Map<string, any[]>();
    for (const r of rows) grouped.set(r.configuration_key,[...(grouped.get(r.configuration_key)??[]),r]);
    const insertRows: any[] = [], conflicts: any[] = [];
    for (const [key,group] of grouped) {
      const blockedVariants = blocked.filter((b:any)=>{
        const c=b.research.configuration;
        return /review_requires_model_year/.test(b.research.researchStatus??'') && [norm(c.brand),norm(c.model),norm(c.fuelType),c.engineCc,norm(c.driveType),norm(c.badge),norm(c.trim),`year=${c.year}-${c.year}`].join('|')===key;
      });
      if (blockedVariants.length) { for (const r of group) blocked.push({sourceListingId:r.listingId,reason:'matcher_cannot_distinguish_model_year',research:byId.get(r.listingId)});continue; }
      if (new Set(group.map(r=>r.power_kw)).size !== 1) {conflicts.push({key,rows:group});continue;}
      const existing = refs.filter((r:any)=>r.configuration_key===key);
      if (existing.some((r:any)=>Math.abs(Number(r.power_kw)-group[0].power_kw)>0.02)) {conflicts.push({key,rows:group,existing});continue;}
      insertRows.push({...group[0],listingIds:group.map(r=>r.listingId)});
    }
    const report = {runId,generatedAt:new Date().toISOString(),baseline:{total:500,approved:plan.counts.approved_match,preliminary:baselineIds.size,needsResearch:targets.length},research:{uniqueInRun:byId.size,outsideRun:outsideRun.length,recoveredIds:recovered,targetCovered:targets.filter((r:any)=>byId.has(r.sourceListingId)).length},missing:targets.filter((r:any)=>!byId.has(r.sourceListingId)),blocked,conflicts,insertRows,outsideRun, sourceRows:targets.map((r:any)=>byId.get(r.sourceListingId)??{sourceListingId:r.sourceListingId,configuration:r.configuration,researchStatus:'missing'})};
    await writeFile('output/encar-run-0358-reference-reconciliation.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,sourceRows:report.sourceRows.length,missing:report.missing.map((r:any)=>({id:r.sourceListingId,configuration:r.configuration})),blocked:blocked.map(r=>({id:r.sourceListingId,reason:r.reason})),conflicts:conflicts.map(r=>({key:r.key,ids:r.rows.map((x:any)=>x.listingId)})),insertRows:insertRows.length,outsideRun:outsideRun.length},null,2));
  } finally {await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
