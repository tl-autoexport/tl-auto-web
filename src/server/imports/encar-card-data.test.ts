import assert from 'node:assert/strict';
import { mapChoiceOptions, mapStandardOptions } from './encar-options';
import { mapEncarOpenHistory } from './encar-history';
import { resolveEncarVehicleId } from './encar-identity';
assert.equal(resolveEncarVehicleId('42481636', {vehicleId:42470581,queryCarId:42481636}), '42470581');
assert.equal(resolveEncarVehicleId('42470581', {vehicleId:42470581}), '42470581');
assert.equal(resolveEncarVehicleId('42481636', {vehicleId:42470581}), '42470581');
assert.equal(resolveEncarVehicleId('42481636', {spec:{displacement:2999}}), '42481636');
assert.throws(() => resolveEncarVehicleId('42481636', {vehicleId:42188411,queryCarId:42188411}), /mismatch/);
assert.throws(() => resolveEncarVehicleId('42481636', {}), /Missing/);
assert.throws(() => resolveEncarVehicleId('42481636', {vehicleId:'invalid'}), /mismatch/);
const catalog = { options: [
  { optionCd: '001', optionName: '헤드램프', subOptions: [{optionCd:'075',optionName:'헤드램프(LED)'}] },
  { optionCd: '001', optionName: '브레이크 잠김 방지(ABS)' },
] };
const standard = mapStandardOptions(catalog,['001']);
assert.equal(standard[0].is_present,false,'group code must not collide with ABS code');
assert.equal(standard[1].is_present,true);
const choices = [{optionCd:'1149',optionName:'컨비니언스'},{optionCd:'1153',optionName:'내비게이션'}];
assert.deepEqual(mapChoiceOptions(choices,['1149']).map(o=>o.is_present),[true,false]);
assert.deepEqual(mapChoiceOptions(choices).map(o=>o.is_present),[null,null]);
const history = mapEncarOpenHistory({openData:true,ownerChangeCnt:3,loan:1,myAccidentCnt:2,
  ownerChanges:['2026-05-11','2026-05-04','2026-04-30'],notJoinDate1:'202104~202602',
  accidents:[{date:'2022-07-17',insuranceBenefit:1320642},{date:'2021-09-14',insuranceBenefit:2000000}]});
assert.equal(history?.summary.owner_changed_count,3);
assert.equal(history?.summary.loan_count,1);
assert.equal(history?.summary.insurance_payout_total_krw,3320642);
assert.equal(history?.raw_payload.ownerHistoryResponse.length,3);
assert.equal(mapEncarOpenHistory({openData:false}),null);
console.log('Encar card data tests passed');
