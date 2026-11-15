import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationFingerprint,measurement,type PowerRecord } from '../power/contract.js';
import type {PowerBasis} from '../power/types.js';
import {eventFor,validateEvent,importRecord,MAX_BYTES,samePower,rangesOverlap} from './protocol.js';
import {nativeEvent} from './native.js';
import {createSyncServer,deliverOne,runCanary,validateCanaryTargets,type CanaryTarget} from './service.js';
const record:PowerRecord={contractVersion:'power-record-v1',vehicle:{brand:'Hyundai',model:'Test',year:2023,engineCc:1998,fuelType:'gasoline',market:'KR',driveType:'AWD'},propulsion:'ice',measurements:[measurement(150,'PS','combustion_rated')],resolutionClass:'CONFIRMED',approvalState:'approved',origin:{project:'tl-auto',recordId:'spec:one:match',revision:'1'},configurationFingerprint:'',sources:[{uri:'https://manufacturer.example/spec',retrievedAt:'2026-10-24',verification:'corroborated',provenance:{document:'test'}}],rationale:'offline test',createdAt:'2026-10-24',updatedAt:'2026-10-24'};
record.configurationFingerprint=configurationFingerprint(record.vehicle,record.propulsion);
test('contract event stable hash, source confidence retained, import provisional without mutation',()=>{const e=eventFor(record,{evidence:{source:'test'}});assert.equal(validateEvent(e,'tl-auto').eventId,e.eventId);assert.equal(eventFor(structuredClone(record),{evidence:{source:'test'}}).eventId,e.eventId);const imported=importRecord(e);assert.equal(imported.resolutionClass,'PROBABLE');assert.equal(imported.approvalState,'provisional');assert.equal(e.record.approvalState,'approved');assert.deepEqual(imported.sources,e.record.sources);});
test('reject wrong origin, changed payload, invalid basis, correlation, oversize and arbitrary revisions',()=>{
 const e=eventFor(record,{});assert.throws(()=>validateEvent(e,'vehicle-power'));
 assert.throws(()=>validateEvent({...e,raw:{tampered:true}},'tl-auto'));
 for(const mutate of [(r:PowerRecord)=>{r.origin.revision='2026-01-01';},(r:PowerRecord)=>{r.measurements[0]!.basis='unknown' as unknown as PowerBasis;},(r:PowerRecord)=>{r.vehicle.correlation={masterId:'forbidden'};},(r:PowerRecord)=>{r.configurationFingerprint='bad';}]){const r=structuredClone(record);mutate(r);assert.throws(()=>validateEvent(eventFor(r,{}),'tl-auto'));}
 assert.throws(()=>validateEvent(eventFor(record,{large:'a'.repeat(MAX_BYTES)}),'tl-auto'));
});
test('native automatic engine fallback is estimated, raw retained and never approved',()=>{const e=nativeEvent('tl-auto',{record_id:'auto:1',revision:'1',operation:'upsert',created_at:'2026-10-24',raw:{automatic:{brand:'Hyundai',model:'Test',engine_cc:1998,fuel_type:'gasoline',power_kw:100,status:'confirmed',source:'engine_fallback'}}});assert.equal(e.record.resolutionClass,'ESTIMATED');assert.equal(e.record.approvalState,'provisional');assert.equal(e.raw.automatic&&typeof e.raw.automatic,'object');});
test('automatic EV unknown basis never invents continuous rating',()=>{const e=nativeEvent('tl-auto',{record_id:'auto:1',revision:'1',operation:'upsert',created_at:'2026-10-24',raw:{automatic:{brand:'Hyundai',model:'EV',fuel_type:'electric',power_kw:100,status:'automatic',source:'unknown'}}});assert.equal(e.record.resolutionClass,'INSUFFICIENT_DATA');assert.deepEqual(e.record.measurements,[]);});
test('tombstone keeps identity and evidence; inconsistent operation rejected',()=>{const r={...record,approvalState:'revoked' as const};const e=eventFor(r,{},'revoke');assert.equal(validateEvent(e,'tl-auto').operation,'revoke');assert.equal(importRecord(e).approvalState,'revoked');assert.throws(()=>validateEvent(eventFor(r,{},'upsert'),'tl-auto'));});
test('delivery failure retries durable row, ack mismatch cannot move checkpoint',async()=>{const e=eventFor({...record,origin:{...record.origin,project:'vehicle-power'}},{});let ack=0,failed=0;const store={project:'vehicle-power' as const,claim:async()=>({seq:'1',event:e,attempts:1}),prepare:async()=>{},acknowledge:async()=>{ack++;},fail:async()=>{failed++;}} as unknown as Parameters<typeof deliverOne>[0];
 await deliverOne(store,'https://peer.test/v1/reference-sync/events','x'.repeat(32),async()=>{throw new Error('offline');});
 await deliverOne(store,'https://peer.test/v1/reference-sync/events','x'.repeat(32),async()=>new Response(JSON.stringify({eventId:'wrong'})));
 assert.equal(ack,0);assert.equal(failed,2);
 await deliverOne(store,'https://peer.test/v1/reference-sync/events','x'.repeat(32),async()=>new Response(JSON.stringify({eventId:e.eventId})));
 assert.equal(ack,1);
});
test('sync HTTP auth, body limit and malformed JSON never reach importer',async()=>{let calls=0;const server=createSyncServer({receive:async()=>{calls++;return {eventId:'test',status:'review'};}},'s'.repeat(32));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert(a&&typeof a==='object');const url=`http://127.0.0.1:${a.port}/v1/reference-sync/events`;
 try{assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);assert.equal((await fetch(url,{method:'POST',headers:{authorization:`Bearer ${'s'.repeat(32)}`},body:'{bad'})).status,400);assert.equal((await fetch(url,{method:'POST',headers:{authorization:`Bearer ${'s'.repeat(32)}`},body:'a'.repeat(MAX_BYTES+1)})).status,413);assert.equal(calls,0);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('equivalent units do not conflict; disjoint year and displacement ranges stay separate',()=>{const b=structuredClone(record);b.measurements=[measurement(record.measurements[0]!.kw,'kW','combustion_rated')];assert.ok(samePower(record,b));assert.equal(rangesOverlap({brand:'A',model:'B',yearFrom:2020,yearTo:2021},{brand:'A',model:'B',yearFrom:2022,yearTo:2023}),false);assert.equal(rangesOverlap({brand:'A',model:'B',engineCcFrom:1500,engineCcTo:1600},{brand:'A',model:'B',engineCcFrom:1900,engineCcTo:2000}),false);});

test('optional powertrain/topology hints remain sync-compatible without promoting imported confidence',()=>{const r=structuredClone(record);r.vehicle={...r.vehicle,fuelType:'phev',powertrain:'hybrid_phev',hybridTopology:'sequential'};r.propulsion='hybrid_phev';r.measurements=[measurement(30,'kW','electric_30min')];r.configurationFingerprint=configurationFingerprint(r.vehicle,r.propulsion);const event=eventFor(r,{});assert.equal(validateEvent(event,'tl-auto').record.vehicle.hybridTopology,'sequential');assert.equal(importRecord(event).approvalState,'provisional');});

test('canary allowlist is strict, unique and hard capped at three event IDs',()=>{
 const target={seq:'7',eventId:'a'.repeat(64)};validateCanaryTargets([target]);
 assert.throws(()=>validateCanaryTargets([target,target]),/duplicate_canary_allowlist/);
 assert.throws(()=>validateCanaryTargets(Array.from({length:4},(_,i)=>({seq:String(i+1),eventId:String(i+1).padStart(64,'0')}))),/canary_limit_exceeded/);
 assert.throws(()=>validateCanaryTargets([{seq:'0',eventId:'x'}]),/invalid_canary_allowlist/);
});

test('canary dry-run reads only exact allowlisted events and performs no claims, sends, acks or retries',async()=>{
 const target={seq:'7',eventId:'a'.repeat(64)},event=eventFor(record,{});event.eventId=target.eventId;
 let inspect=0,claim=0,ack=0,fail=0,transport=0;
 const store={project:'tl-auto' as const,inspectCanary:async(ids:CanaryTarget[])=>{inspect++;assert.deepEqual(ids,[target]);return [{seq:target.seq,event,attempts:0}];},claimCanary:async()=>{claim++;return {seq:target.seq,event,attempts:1};},acknowledge:async()=>{ack++;},fail:async()=>{fail++;}} as Parameters<typeof runCanary>[0];
 const result=await runCanary(store,[target],{send:false,transport:async()=>{transport++;throw new Error('must_not_send');}});
 assert.equal(result.status,'dry-run');assert.deepEqual(result.events.map(e=>e.eventId),[target.eventId]);
 assert.deepEqual([inspect,claim,ack,fail,transport],[1,0,0,0,0]);
});

test('canary send claims and posts only explicit events; never reconciles or starts a listener',async()=>{
 const target={seq:'9',eventId:'b'.repeat(64)},event=eventFor(record,{});event.eventId=target.eventId;
 const claimed:string[]=[],acked:string[]=[],posted:string[]=[];
 const store={project:'tl-auto' as const,inspectCanary:async(ids:CanaryTarget[])=>ids.map(id=>({seq:id.seq,event,attempts:0})),claimCanary:async(id:CanaryTarget)=>{claimed.push(id.eventId);return {seq:id.seq,event,attempts:1};},acknowledge:async(seq:string)=>{acked.push(seq);},fail:async()=>{throw new Error('unexpected_retry');}} as Parameters<typeof runCanary>[0];
 const result=await runCanary(store,[target],{send:true,endpoint:'https://vehicle-power.example/v1/reference-sync/events',token:'t'.repeat(32),transport:async(_url,init)=>{const sent=JSON.parse(String(init?.body));posted.push(sent.eventId);return new Response(JSON.stringify({eventId:sent.eventId}));}});
 assert.equal(result.status,'sent');assert.deepEqual(claimed,[target.eventId]);assert.deepEqual(posted,[target.eventId]);assert.deepEqual(acked,['9']);
});
