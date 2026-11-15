import { Pool, type PoolClient } from 'pg';
import { compareConfiguration } from '../power/contract.js';
import { nativeEvent, type NativeChange } from './native.js';
import { digest, importRecord, rangesOverlap, samePower, validateEvent, type Project, type SyncEvent } from './protocol.js';
import { validateCanaryTargets, type CanaryTarget } from './service.js';
export class SyncStore {
 readonly pool:Pool;readonly prefix:string;
 constructor(readonly project:Project,connectionString:string){this.prefix=project==='vehicle-power'?'vehicle_power.sync_':'public.vehicle_power_sync_';this.pool=new Pool({connectionString,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,application_name:`${project}-reference-sync`});}
 private table(name:string){if(!['native','state','outbox','inbox','heads','checkpoint','apply','reconcile'].includes(name))throw new Error('invalid_table');return this.prefix+name;}
 private async transaction<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('begin');const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
 async verifyIdentity(){
  const role=this.project==='vehicle-power'?'vehicle_power_sync':'tl_auto_power_sync';
  const native=this.project==='vehicle-power'?'vehicle_power.specifications':'public.vehicle_power_specs';
  const row=(await this.pool.query(`select r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,pg_has_role(current_user,$1,'USAGE') as member,has_table_privilege(current_user,$2,'INSERT,UPDATE,DELETE') as native_write from pg_roles r where r.rolname=current_user`,[role,native])).rows[0];
  if(!row||!row.member||row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||row.native_write)throw new Error('sync_credential_not_isolated');
 }
 async receive(value:unknown){
  const peer=this.project==='vehicle-power'?'tl-auto':'vehicle-power';const e=validateEvent(value,peer),r=e.record;
  return this.transaction(async c=>{
   await c.query('select pg_advisory_xact_lock(71032004)');
   const prior=await c.query(`select event_id,raw_event from ${this.table('inbox')} where event_id=$1 or (origin=$2 and record_id=$3 and revision=$4)`,[e.eventId,peer,r.origin.recordId,r.origin.revision]);
   if(prior.rows.length){if(prior.rows[0].event_id!==e.eventId||digest(prior.rows[0].raw_event)!==digest(e))throw new Error('revision_collision');return {eventId:e.eventId,status:'duplicate'};}
   const head=(await c.query(`select revision::text,record from ${this.table('heads')} where origin=$1 and record_id=$2 for update`,[peer,r.origin.recordId])).rows[0];
   let state='review',reason='untrusted_origin';
   if(head&&BigInt(head.revision)>=BigInt(r.origin.revision)){state='stale';reason='out_of_order';}
   else if(e.operation!=='upsert'){state=e.operation==='revoke'?'revoked':'retired';reason='origin_tombstone';}
   else {
    const native=(await c.query(`select n.record_id,n.raw,coalesce(s.revision,1)::text as revision,coalesce(s.updated_at,now()) as created_at from ${this.table('native')} n left join ${this.table('state')} s using(record_id)`)).rows;
    const local=native.flatMap(n=>{try{return [nativeEvent(this.project,{...n,operation:'upsert'}).record];}catch{return [];}});
    const others=(await c.query(`select record from ${this.table('heads')} where not(origin=$1 and record_id=$2)`,[peer,r.origin.recordId])).rows.map(n=>n.record);
    const competitors=[...local,...others].filter(x=>!['retired','revoked'].includes(x.approvalState)&&rangesOverlap(x.vehicle,r.vehicle)&&compareConfiguration(x.vehicle,r.vehicle).quality!=='conflict'&&x.vehicle.brand&&x.vehicle.model);
    if(competitors.some(x=>!samePower(x,r))){state='conflict';reason='configuration_power_conflict';}
    else if(competitors.some(x=>x.approvalState==='approved'))reason='local_approved_preserved';
   }
   await c.query(`insert into ${this.table('inbox')}(event_id,origin,record_id,revision,fingerprint,raw_event,state,reason) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,[e.eventId,peer,r.origin.recordId,r.origin.revision,r.configurationFingerprint,JSON.stringify(e),state,reason]);
   if(state!=='stale'){
    const imported=importRecord(e);
    await c.query(`insert into ${this.table('heads')}(origin,record_id,revision,fingerprint,record) values($1,$2,$3,$4,$5::jsonb) on conflict(origin,record_id) do update set revision=excluded.revision,fingerprint=excluded.fingerprint,record=excluded.record`,[peer,r.origin.recordId,r.origin.revision,r.configurationFingerprint,JSON.stringify(imported)]);
    await c.query(`select ${this.table('apply')}($1::jsonb,$2)`,[JSON.stringify(imported),e.operation!=='upsert']);
   }
   return {eventId:e.eventId,status:state};
  });
 }
 async claim(){return this.transaction(async c=>{
  await c.query(`update ${this.table('outbox')} set state='dead',lease_until=null,error_code='lease_exhausted' where state='sending' and lease_until<now() and attempts>=6`);
  const row=(await c.query(`select seq::text,record_id,revision::text,raw,operation,event,created_at,attempts from ${this.table('outbox')} where attempts<6 and ((state='pending' and next_at<=now()) or (state='sending' and lease_until<now())) order by seq limit 1 for update skip locked`)).rows[0];
  if(!row)return null;
  await c.query(`update ${this.table('outbox')} set state='sending',attempts=attempts+1,lease_until=now()+interval '30 seconds' where seq=$1`,[row.seq]);
  return {...row,attempts:row.attempts+1} as NativeChange&{seq:string;event:SyncEvent|null;attempts:number};
 });}
 /** Read-only discovery. Hard-capped before querying and never invokes reconcile. */
 async previewCandidates(limit:number){
  if(!Number.isInteger(limit)||limit<1||limit>3)throw new Error('canary_limit_exceeded');
  const rows=(await this.pool.query(`select seq::text,record_id,revision::text,raw,operation,event,created_at,attempts from ${this.table('outbox')} where state='pending' and attempts<6 and next_at<=now() order by seq limit $1`,[limit])).rows;
  return rows.map((row:any)=>{const event=row.event??nativeEvent(this.project,row);validateEvent(event,this.project);return {...row,event};});
 }
 /** Read-only exact selection; each sequence must recompute to its allowlisted event ID. */
 async inspectCanary(targets:CanaryTarget[]){
  validateCanaryTargets(targets);
  const rows=(await this.pool.query(`select seq::text,record_id,revision::text,raw,operation,event,created_at,attempts,state,next_at<=now() as ready from ${this.table('outbox')} where seq=any($1::bigint[]) order by seq`,[targets.map(t=>t.seq)])).rows;
  if(rows.length!==targets.length)throw new Error('canary_event_missing');
  const bySeq=new Map(rows.map((r:any)=>[String(r.seq),r]));
  return targets.map(target=>{
   const row:any=bySeq.get(target.seq);if(!row||row.state!=='pending'||!row.ready||Number(row.attempts)>=6)throw new Error('canary_event_not_ready');
   const event=row.event??nativeEvent(this.project,row);validateEvent(event,this.project);
   if(event.eventId!==target.eventId)throw new Error('canary_event_id_mismatch');
   return {...row,event};
  });
 }
 /** Claims and serializes exactly one allowlisted event under row lock; no queue scan. */
 async claimCanary(target:CanaryTarget){
  validateCanaryTargets([target]);
  return this.transaction(async c=>{
   const row=(await c.query(`select seq::text,record_id,revision::text,raw,operation,event,created_at,attempts,state,next_at<=now() as ready from ${this.table('outbox')} where seq=$1 for update`,[target.seq])).rows[0] as any;
   if(!row||row.state!=='pending'||!row.ready||Number(row.attempts)>=6)throw new Error('canary_event_not_ready');
   const event=row.event??nativeEvent(this.project,row);validateEvent(event,this.project);
   if(event.eventId!==target.eventId)throw new Error('canary_event_id_mismatch');
   await c.query(`update ${this.table('outbox')} set event=coalesce(event,$2::jsonb),state='sending',attempts=attempts+1,lease_until=now()+interval '30 seconds' where seq=$1`,[target.seq,JSON.stringify(event)]);
   return {...row,event,attempts:Number(row.attempts)+1};
  });
 }
 async prepare(seq:string,event:SyncEvent){await this.pool.query(`update ${this.table('outbox')} set event=$2::jsonb where seq=$1 and event is null`,[seq,JSON.stringify(event)]);}
 async acknowledge(seq:string){await this.transaction(async c=>{
  await c.query(`update ${this.table('outbox')} set state='delivered',lease_until=null,error_code=null where seq=$1`,[seq]);
  // Observation only: claims never skip based on this watermark. Dead letters remain durable.
  const r=(await c.query(`select coalesce(max(seq),0)::text as value from ${this.table('outbox')} where state='delivered' and seq<coalesce((select min(seq) from ${this.table('outbox')} where state<>'delivered'),9223372036854775807)`)).rows[0];
  await c.query(`insert into ${this.table('checkpoint')}(name,value) values('delivered',$1) on conflict(name) do update set value=excluded.value,updated_at=now()`,[r.value]);
 });}
 async fail(seq:string,attempts:number,permanent=false){const seconds=Math.min(3600,2**Math.min(attempts,12));await this.pool.query(`update ${this.table('outbox')} set state=$2,next_at=now()+($3::integer*interval '1 second'),lease_until=null,error_code=$4 where seq=$1`,[seq,permanent||attempts>=6?'dead':'pending',seconds,permanent?'invalid_event':'delivery_failed']);}
 async reconcile(){await this.transaction(async c=>{await c.query('select pg_advisory_xact_lock(71032003)');const current=(await c.query(`select value from ${this.table('checkpoint')} where name='reconcile'`)).rows[0]?.value??'';const next=(await c.query(`select ${this.table('reconcile')}($1,100) as cursor`,[current])).rows[0].cursor??'';await c.query(`insert into ${this.table('checkpoint')}(name,value) values('reconcile',$1) on conflict(name) do update set value=excluded.value,updated_at=now()`,[next]);});}
 async redrive(seq:string){if(!/^\d+$/.test(seq))throw new Error('invalid_sequence');await this.pool.query(`update ${this.table('outbox')} set state='pending',attempts=0,next_at=now(),lease_until=null,error_code=null where seq=$1 and state='dead'`,[seq]);}
 async close(){await this.pool.end();}
}
