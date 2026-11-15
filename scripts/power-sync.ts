import { SyncStore } from '../src/server/power-sync/sync/store.js';
import { createSyncServer,startSyncSender,startSyncWorker,runCanary,type CanaryTarget } from '../src/server/power-sync/sync/service.js';
const project='tl-auto' as const;

function parseTargets(args:string[]):CanaryTarget[]{
 const values:string[]=[];for(let i=0;i<args.length;i++){if(args[i]==='--event'){const v=args[++i];if(!v)throw new Error('invalid_canary_allowlist');values.push(v);}else if(args[i]==='--send'){}else throw new Error('invalid_canary_argument');}
 if(values.length<1||values.length>3)throw new Error('canary_limit_exceeded');
 const targets=values.map(v=>{const m=/^([1-9]\d*):([a-f0-9]{64})$/.exec(v);if(!m)throw new Error('invalid_canary_allowlist');return {seq:m[1]!,eventId:m[2]!};});
 return targets;
}
function databaseUrl(){
 const raw=process.env.POWER_SYNC_DATABASE_URL;if(!raw)throw new Error('sync_database_not_configured');
 const u=new URL(raw);const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(!local&&u.searchParams.get('sslmode')!=='verify-full')throw new Error('sync_database_tls_verify_full_required');
 return raw;
}
function peerConfig(){
 const endpoint=process.env.POWER_SYNC_PEER_URL??'',token=process.env.POWER_SYNC_OUTBOUND_TOKEN??'';
 const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/v1/reference-sync/events'||u.search||u.hash||token.length<32)throw new Error('invalid_sync_config');
 return {endpoint,token};
}
async function main(){
 const action=process.argv[2]??'run';
 const store=new SyncStore(project,databaseUrl());
 try{
  await store.verifyIdentity();
  if(action==='reconcile'){await store.reconcile();await store.close();return;}
  if(action==='redrive'){await store.redrive(process.argv[3]??'');await store.close();return;}
  if(action==='preview'){
   const args=process.argv.slice(3);let limit=3;
   for(let i=0;i<args.length;i++){if(args[i]==='--limit'){const n=Number(args[++i]);if(!Number.isInteger(n)||n<1||n>3)throw new Error('canary_limit_exceeded');limit=n;}else throw new Error('invalid_preview_argument');}
   const rows=await store.previewCandidates(limit);
   console.log(JSON.stringify({status:'read-only-preview',limit,events:rows.map(r=>({seq:r.seq,eventId:r.event.eventId,recordId:r.event.record.origin.recordId,revision:r.event.record.origin.revision,operation:r.event.operation,configurationFingerprint:r.event.record.configurationFingerprint,approvalState:r.event.record.approvalState,resolutionClass:r.event.record.resolutionClass}))},null,2));await store.close();return;
  }
  if(action==='canary'){
   const args=process.argv.slice(3),send=args.includes('--send'),targets=parseTargets(args);
   const config=send?peerConfig():{};
   const result=await runCanary(store,targets,{send,...config});
   console.log(JSON.stringify(result,null,2));await store.close();return;
  }
  if(action==='send-only'){
   const {endpoint,token}=peerConfig();const stop=startSyncSender(store,endpoint,token);
   const shutdown=()=>{stop();void store.close();};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);return;
  }
  if(action!=='run')throw new Error('invalid_action');
  const incoming=process.env.POWER_SYNC_INBOUND_TOKEN??'',outgoing=process.env.POWER_SYNC_OUTBOUND_TOKEN??'',peer=process.env.POWER_SYNC_PEER_URL??'';
  const server=createSyncServer(store,incoming);const stop=startSyncWorker(store,peer,outgoing);
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.listen(Number(process.env.POWER_SYNC_PORT??3192),'127.0.0.1');
  const shutdown=()=>{stop();server.close(()=>void store.close());server.closeAllConnections();};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
 }catch(error){await store.close();throw error;}
}
void main().catch(()=>{console.error('power_sync_failed');process.exitCode=1;});
