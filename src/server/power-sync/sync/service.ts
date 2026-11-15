import { createServer } from 'node:http';
import { createHash,timingSafeEqual } from 'node:crypto';
import { nativeEvent } from './native.js';
import { MAX_BYTES,validateEvent,type Project,type SyncEvent } from './protocol.js';
import type { SyncStore } from './store.js';
import { validatePowerRecord } from '../power/contract.js';
const hash=(s:string)=>createHash('sha256').update(s).digest();
export function createSyncServer(store:Pick<SyncStore,'receive'>,token:string){
 if(token.length<32)throw new Error('sync_token_too_short');
 return createServer(async(req,res)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(req.url!=='/v1/reference-sync/events'||req.method!=='POST')return send(404,{error:'not_found'});
  const supplied=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
  if(!timingSafeEqual(hash(supplied),hash(token)))return send(401,{error:'unauthorized'});
  const declared=Number(req.headers['content-length']??0);if(declared>MAX_BYTES)return send(413,{error:'payload_too_large'});
  let body='',bytes=0;
  try{for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>MAX_BYTES){send(413,{error:'payload_too_large'});return;}body+=chunk;}
   let value:unknown;try{value=JSON.parse(body);}catch{return send(400,{error:'invalid_json'});}
   try{return send(200,await store.receive(value));}catch(error){const code=error instanceof Error?error.message:'';const invalid=/^(invalid_|missing_|unconfirmed_|conflicting_|incompatible_|inconsistent_|payload_|reference_only|event_hash_|revision_collision)/.test(code);return send(invalid?422:503,{error:invalid?'invalid_event':'temporarily_unavailable'});}
  }catch{if(!res.headersSent)send(400,{error:'invalid_request'});}
 });
}
export async function deliverOne(store:Pick<SyncStore,'claim'|'prepare'|'acknowledge'|'fail'|'project'>,endpoint:string,token:string,transport:typeof fetch=fetch){
 const row=await store.claim();if(!row)return false;
 let event:SyncEvent;
 try{event=row.event??nativeEvent(store.project,row);validateEvent(event,store.project);await store.prepare(row.seq,event);}catch{await store.fail(row.seq,row.attempts,true);return true;}
 try{
  const response=await transport(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)throw new Error('delivery_failed');
  const ack=await response.json() as {eventId?:string};if(ack.eventId!==event.eventId)throw new Error('invalid_ack');
  await store.acknowledge(row.seq);
 }catch{await store.fail(row.seq,row.attempts);}
 return true;
}
export type CanaryTarget={seq:string;eventId:string};
export function validateCanaryTargets(targets:CanaryTarget[]){
 if(!Array.isArray(targets)||targets.length<1||targets.length>3)throw new Error('canary_limit_exceeded');
 const seqs=new Set<string>(),ids=new Set<string>();
 for(const t of targets){if(!t||!/^[1-9]\d*$/.test(t.seq)||!/^[a-f0-9]{64}$/.test(t.eventId))throw new Error('invalid_canary_allowlist');if(seqs.has(t.seq)||ids.has(t.eventId))throw new Error('duplicate_canary_allowlist');seqs.add(t.seq);ids.add(t.eventId);}
}
export type CanaryPreview={seq:string;eventId:string;recordId:string;revision:string;operation:string;configurationFingerprint:string;approvalState:string;resolutionClass:string};
type CanaryRow={seq:string;event:SyncEvent;attempts:number};
type CanaryStore=Pick<SyncStore,'inspectCanary'|'claimCanary'|'acknowledge'|'fail'|'project'>;
function canarySummary(row:CanaryRow):CanaryPreview{return {seq:row.seq,eventId:row.event.eventId,recordId:row.event.record.origin.recordId,revision:row.event.record.origin.revision,operation:row.event.operation,configurationFingerprint:row.event.record.configurationFingerprint,approvalState:row.event.record.approvalState,resolutionClass:row.event.record.resolutionClass};}
/** Exact-ID canary path: no listener, queue scan, reconciliation, or implicit retries. */
export async function runCanary(store:CanaryStore,targets:CanaryTarget[],options:{send:boolean;endpoint?:string;token?:string;transport?:typeof fetch}){
 validateCanaryTargets(targets);
 const inspected=await store.inspectCanary(targets) as CanaryRow[];
 const summaries=inspected.map(canarySummary);
 if(!options.send)return {status:'dry-run' as const,events:summaries};
 if(!options.endpoint||!options.token||options.token.length<32)throw new Error('sync_outbound_not_configured');
 const url=new URL(options.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/v1/reference-sync/events'||url.search||url.hash)throw new Error('invalid_sync_config');
 const delivered:CanaryPreview[]=[];
 for(const target of targets){
  const row=await store.claimCanary(target) as CanaryRow;
  try{
   validatePowerRecord(row.event.record);
   const response=await (options.transport??fetch)(options.endpoint,{method:'POST',headers:{authorization:`Bearer ${options.token}`,'content-type':'application/json'},body:JSON.stringify(row.event),signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!response.ok)throw new Error('delivery_failed');
   const ack=await response.json() as {eventId?:string};if(ack.eventId!==target.eventId)throw new Error('invalid_ack');
   await store.acknowledge(target.seq);delivered.push(canarySummary(row));
  }catch{await store.fail(target.seq,row.attempts);throw new Error('canary_delivery_failed');}
 }
 return {status:'sent' as const,events:delivered};
}
/** Sender-only steady worker. It never opens the inbound HTTP listener and does not reconcile/backfill. */
export function startSyncSender(store:SyncStore,endpoint:string,token:string){
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/v1/reference-sync/events'||url.search||token.length<32)throw new Error('invalid_sync_config');
 let busy=false,stopped=false;
 const tick=async()=>{if(busy||stopped)return;busy=true;try{await deliverOne(store,endpoint,token);}catch{/* Durable rows remain pending; do not log secrets or connection details. */}finally{busy=false;}};
 const timer=setInterval(()=>void tick(),1000);void tick();return ()=>{stopped=true;clearInterval(timer);};
}
export function startSyncWorker(store:SyncStore,endpoint:string,token:string){
 const url=new URL(endpoint);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('sync_https_required');
 if(url.username||url.password||url.pathname!=='/v1/reference-sync/events'||url.search||token.length<32)throw new Error('invalid_sync_config');
 let busy=false,stopped=false,reconcileAt=0;
 const tick=async()=>{if(busy||stopped)return;busy=true;try{if(Date.now()>=reconcileAt){await store.reconcile();reconcileAt=Date.now()+60000;}await deliverOne(store,endpoint,token);}catch{/* Durable rows remain pending; no secrets or database errors are logged. */}finally{busy=false;}};
 const timer=setInterval(()=>void tick(),1000);timer.unref();void tick();return ()=>{stopped=true;clearInterval(timer);};
}
export type { Project };
