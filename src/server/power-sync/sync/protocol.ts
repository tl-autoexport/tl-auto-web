import { createHash } from 'node:crypto';
import { configurationFingerprint, validatePowerRecord, type PowerRecord } from '../power/contract.js';
export type Project = 'vehicle-power' | 'tl-auto';
export type SyncEvent = { version:'power-sync-v1'; eventId:string; operation:'upsert'|'retire'|'revoke'; record:PowerRecord; raw:Record<string,unknown> };
export const MAX_BYTES=256*1024;
export function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value)??'null';
}
export function digest(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
export function eventFor(record:PowerRecord,raw:Record<string,unknown>,operation:SyncEvent['operation']='upsert'):SyncEvent {
 const body={version:'power-sync-v1' as const,operation,record,raw};return {...body,eventId:digest(body)};
}
export function validateEvent(value:unknown,peer:Project):SyncEvent {
 if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)throw new Error('payload_too_large');
 const e=value as SyncEvent;if(!e||e.version!=='power-sync-v1'||!['upsert','retire','revoke'].includes(e.operation)||!e.raw||typeof e.raw!=='object'||Array.isArray(e.raw))throw new Error('invalid_event');
 const r=e.record;if(!r||r.contractVersion!=='power-record-v1'||!r.vehicle||!r.origin||r.origin.project!==peer||!/^[1-9]\d{0,17}$/.test(r.origin.revision)||BigInt(r.origin.revision)<BigInt(1)||typeof r.origin.recordId!=='string'||r.origin.recordId.length>512)throw new Error('invalid_origin');
 if(!['ice','electric','hybrid_parallel','hybrid_sequential','hybrid_phev'].includes(r.propulsion)||!['CONFIRMED','PROBABLE','ESTIMATED','INSUFFICIENT_DATA'].includes(r.resolutionClass)||!['draft','provisional','approved','retired','revoked'].includes(r.approvalState))throw new Error('invalid_record');
 if(!Array.isArray(r.measurements)||r.measurements.length>8||!Array.isArray(r.sources)||r.sources.length>32||!r.vehicle.brand||!r.vehicle.model||r.vehicle.correlation)throw new Error('reference_only');
 if(typeof r.rationale!=='string'||r.rationale.length>8000)throw new Error('invalid_rationale');
 for(const [key,v] of Object.entries(r.vehicle)){if(v==null)continue;if(['year','yearFrom','yearTo','engineCc','engineCcFrom','engineCcTo'].includes(key)){if(!Number.isInteger(v)||Number(v)<0||Number(v)>100000)throw new Error('invalid_vehicle');}else if(typeof v!=='string'||v.length>512)throw new Error('invalid_vehicle');}
 for(const m of r.measurements)if(!m||typeof m.kw!=='number'||!Number.isFinite(m.kw)||m.kw<=0||!m.original)throw new Error('invalid_measurement');
 for(const date of [r.createdAt,r.updatedAt])if(!Number.isFinite(Date.parse(date)))throw new Error('invalid_timestamp');
 for(const s of r.sources){if(typeof s.uri!=='string'||s.uri.length>4096||!s.provenance||typeof s.provenance!=='object'||!Number.isFinite(Date.parse(s.retrievedAt)))throw new Error('invalid_evidence');}
 if(e.operation==='upsert'&&['retired','revoked'].includes(r.approvalState)||e.operation==='retire'&&r.approvalState!=='retired'||e.operation==='revoke'&&r.approvalState!=='revoked')throw new Error('invalid_tombstone');
 validatePowerRecord(r);if(e.eventId!==eventFor(r,e.raw,e.operation).eventId)throw new Error('event_hash_mismatch');return e;
}
export function importRecord(e:SyncEvent):PowerRecord {
 const r=structuredClone(e.record);r.approvalState=e.operation==='upsert'?'provisional':e.operation==='retire'?'retired':'revoked';if(r.resolutionClass==='CONFIRMED')r.resolutionClass='PROBABLE';return r;
}
export function samePower(a:PowerRecord,b:PowerRecord){return a.propulsion===b.propulsion&&a.measurements.length===b.measurements.length&&a.measurements.every(m=>b.measurements.some(n=>m.basis===n.basis&&Math.abs(m.kw-n.kw)<=0.0001));}
export function fingerprint(record:PowerRecord){return configurationFingerprint(record.vehicle,record.propulsion);}

/** Unspecified ranges are not assumed exact; incompatible ranges cannot conflict-match. */
export function rangesOverlap(a:PowerRecord['vehicle'],b:PowerRecord['vehicle']){
 const overlap=(af:number|undefined,at:number|undefined,bf:number|undefined,bt:number|undefined)=>(af??-Infinity)<=(bt??Infinity)&&(bf??-Infinity)<=(at??Infinity);
 return overlap(a.year??a.yearFrom,a.year??a.yearTo,b.year??b.yearFrom,b.year??b.yearTo)&&overlap(a.engineCc??a.engineCcFrom,a.engineCc??a.engineCcTo,b.engineCc??b.engineCcFrom,b.engineCc??b.engineCcTo);
}
