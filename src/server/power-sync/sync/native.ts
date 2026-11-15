import { configurationFingerprint, measurement, validatePowerRecord, type PowerRecord, type PowerMeasurement } from '../power/contract.js';
import type { Project } from './protocol.js';
import { eventFor } from './protocol.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Native JSONB snapshots intentionally retain two different schema shapes; the normalized PowerRecord is validated below.
export type NativeChange={record_id:string;revision:string;raw:any;operation:'upsert'|'retire'|'revoke';created_at:string|Date};
/** Only reference snapshots captured transactionally by the native-table triggers enter here. */
export function nativeEvent(project:Project,row:NativeChange){
 const raw=row.raw,s=raw.spec??raw.automatic,e=raw.evidence??{},m=raw.match??{};
 if(!s)throw new Error('missing_native_reference');
 const vp=project==='vehicle-power';const auto=!!raw.automatic;
 const propulsion:PowerRecord['propulsion']=vp?s.propulsion:auto?(/electric/i.test(s.fuel_type)?'electric':/phev/i.test(s.fuel_type)?'hybrid_phev':/hybrid/i.test(s.fuel_type)?'hybrid_parallel':'ice'):s.propulsion_type;
 const vehicle:PowerRecord['vehicle']=vp?{...m}:{brand:m.brand??s.brand??e.brand,model:m.model??s.model??e.model,generation:m.generation??e.generation??undefined,trim:m.trim??e.trim??s.badge_detail??s.badge??undefined,modelCode:m.model_code??e.model_code??undefined,engineCode:m.engine_code??e.engine_code??undefined,fuelType:m.fuel_type??s.fuel_type??e.fuel_type??undefined,driveType:m.drive_type??s.drive_type??undefined,yearFrom:m.production_year_from??s.year_from??e.production_year_from??undefined,yearTo:m.production_year_to??s.year_to??e.production_year_to??undefined,engineCc:auto?s.engine_cc:m.engine_cc_from!=null&&m.engine_cc_from===m.engine_cc_to?m.engine_cc_from:s.engine_cc_from!=null&&s.engine_cc_from===s.engine_cc_to?s.engine_cc_from:undefined,engineCcFrom:auto?undefined:m.engine_cc_from??s.engine_cc_from??undefined,engineCcTo:auto?undefined:m.engine_cc_to??s.engine_cc_to??undefined};
 delete vehicle.correlation;
 if(!vehicle.brand||!vehicle.model)throw new Error('native_configuration_missing');
 const measurements:PowerMeasurement[]=[];
 const add=(value:unknown,unit:'kW'|'PS'|'hp',basis:PowerMeasurement['basis'])=>{if(value!=null&&Number(value)>0)measurements.push(measurement(Number(value),unit,basis));};
 if(vp){for(const c of s.components??[])add(c.original?.value??c.kw,c.original?.unit??'kW',c.kind??c.basis);if(!measurements.length)add(s.calculation_power_kw,'kW',s.calculation_basis);}
 else if(auto){
  // Legacy automatic rows do not specify electric/system basis. Never infer it.
  if(propulsion==='ice')add(s.power_kw??(s.power_hp?Number(s.power_hp)*0.73549875:null),'kW','combustion_rated');
 }else {add(s.dvs_power_kw,'kW','combustion_rated');add(s.electric_power_kw_30min,'kW','electric_30min');add(e.peak_power_kw,'kW','electric_peak');if(s.system_power_hp)add(s.system_power_hp,'PS','system_combined');}
 const stamp=new Date(row.created_at).toISOString();const uri=e.source_uri??s.source_uri;
 const sources:PowerRecord['sources']=uri?[{uri:String(uri),retrievedAt:e.source_retrieved_at??e.retrieved_at??e.captured_at??stamp,evidenceId:e.id,verification:'unverified',provenance:{nativeEvidence:e,automaticSource:auto?s.source:undefined,rawApproval:s.status}}]:[];
 // An internal source name is provenance, not an externally verified document.
 if(!sources.length)sources.push({uri:`urn:${project}:reference:${row.record_id}`,retrievedAt:stamp,verification:'unverified',provenance:{nativeEvidence:e,automaticSource:auto?s.source:undefined,missingExternalEvidence:true}});
 const approved=!auto&&s.status==='approved'&&(vp?e.status==='approved':e.review_status==='verified');
 if(approved&&sources[0])sources[0].verification='corroborated';
 const record:PowerRecord={contractVersion:'power-record-v1',vehicle,propulsion,measurements,resolutionClass:!measurements.length?'INSUFFICIENT_DATA':approved?'CONFIRMED':auto?'ESTIMATED':'PROBABLE',approvalState:row.operation==='retire'?'retired':row.operation==='revoke'?'revoked':approved?'approved':'provisional',origin:{project,recordId:row.record_id,revision:String(row.revision)},configurationFingerprint:configurationFingerprint(vehicle,propulsion),sources,rationale:'Native reference export; raw approval and evidence preserved without receiver trust promotion',createdAt:s.created_at??stamp,updatedAt:stamp};
 validatePowerRecord(record);return eventFor(record,raw,row.operation);
}
