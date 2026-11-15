import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { SyncStore } from './store.js';

const adminUrl=process.env.POWER_SYNC_TEST_ADMIN_URL,workerUrl=process.env.POWER_SYNC_TEST_WORKER_URL;
test('isolated PostgreSQL canary reads and claims only explicit event IDs without reconciliation', {skip:!adminUrl||!workerUrl}, async()=>{
 const admin=new Pool({connectionString:adminUrl}),store=new SyncStore('tl-auto',workerUrl!);
 try{
  await store.verifyIdentity();
  for(let i=1;i<=4;i++){
   const evidence=(await admin.query(`insert into public.vehicle_power_evidence(source_kind,source_uri,propulsion_type,dvs_power_kw,review_status,brand,model,fuel_type) values('manual',$1,'ice',${90+i},'verified','TestMake',$2,'gasoline') returning id`,[`https://example.test/spec/${i}`,`TestModel${i}`])).rows[0].id;
   const spec=(await admin.query(`insert into public.vehicle_power_specs(spec_key,status,vehicle_category,propulsion_type,dvs_power_kw,calculation_power_kw,evidence_id) values($1,'draft','M1','ice',${90+i},${90+i},$2) returning id`,[`canary-test-${i}`,evidence])).rows[0].id;
   await admin.query(`insert into public.vehicle_power_spec_matches(spec_id,brand,model,fuel_type) values($1,'TestMake',$2,'gasoline')`,[spec,`TestModel${i}`]);
  }
  const discovered=await store.previewCandidates(3);assert.equal(discovered.length,3);
  assert.equal(new Set(discovered.map(r=>r.event.eventId)).size,3);
  const selected=discovered[1]!;const target={seq:selected.seq,eventId:selected.event.eventId};
  const inspected=await store.inspectCanary([target]);assert.equal(inspected.length,1);assert.equal(inspected[0]!.seq,target.seq);
  let state=(await admin.query(`select state,event,attempts from public.vehicle_power_sync_outbox where seq=$1`,[target.seq])).rows[0];
  assert.equal(state.state,'pending');assert.equal(state.event,null);assert.equal(Number(state.attempts),0);
  await assert.rejects(()=>store.inspectCanary([{seq:target.seq,eventId:'0'.repeat(64)}]),/canary_event_id_mismatch/);
  const claimed=await store.claimCanary(target);assert.equal(claimed.event.eventId,target.eventId);
  state=(await admin.query(`select state,event,attempts from public.vehicle_power_sync_outbox where seq=$1`,[target.seq])).rows[0];
  assert.equal(state.state,'sending');assert.equal(state.event.eventId,target.eventId);assert.equal(Number(state.attempts),1);
  await store.acknowledge(target.seq);
  state=(await admin.query(`select state,attempts from public.vehicle_power_sync_outbox where seq=$1`,[target.seq])).rows[0];
  assert.equal(state.state,'delivered');assert.equal(Number(state.attempts),1);
  const untouched=(await admin.query(`select count(*)::int as n from public.vehicle_power_sync_outbox where state='pending'`)).rows[0].n;
  assert.equal(untouched,3);
  const checkpoint=(await admin.query(`select value from public.vehicle_power_sync_checkpoint where name='delivered'`)).rows[0].value;
  assert.equal(checkpoint,'0'); // later canary acknowledgement cannot move checkpoint past older pending events
  await assert.rejects(()=>store.previewCandidates(4),/canary_limit_exceeded/);
 }finally{await store.close();await admin.end();}
});
