import { createHash } from 'node:crypto';
import { canonicalInput } from '../normalization/canonical.js';
import type { ResolveInput, PowerBasis, Propulsion } from './types.js';
export type ResolutionClass = 'CONFIRMED' | 'PROBABLE' | 'ESTIMATED' | 'INSUFFICIENT_DATA';
export type PowerUnit = 'kW' | 'hp' | 'PS';
export type PowerMeasurement = { basis: PowerBasis; kw: number; original: { value: number; unit: PowerUnit } };
export type PowerRecord = {
  contractVersion: 'power-record-v1';
  vehicle: ResolveInput & { yearFrom?: number; yearTo?: number; engineCcFrom?: number; engineCcTo?: number; firstRegistration?: string };
  propulsion: Propulsion;
  measurements: PowerMeasurement[];
  resolutionClass: ResolutionClass;
  rationale: string;
  approvalState: 'draft' | 'provisional' | 'approved' | 'retired' | 'revoked';
  origin: { project: string; recordId: string; revision: string };
  configurationFingerprint: string;
  sources: Array<{ uri: string; sourceHash?: string; retrievedAt: string; evidenceId?: string; verification?: 'official_exact' | 'corroborated' | 'unverified'; provenance: Record<string, unknown> }>;
  createdAt: string; updatedAt: string;
};
export function toKw(value: number, unit: PowerUnit): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('invalid_power');
  if (!['kW', 'PS', 'hp'].includes(unit)) throw new Error('invalid_power_unit');
  return value * (unit === 'PS' ? 0.73549875 : unit === 'hp' ? 0.7456998715822702 : 1);
}
export function measurement(value: number, unit: PowerUnit, basis: PowerBasis): PowerMeasurement {
  if (!['combustion_rated','electric_peak','electric_30min','system_combined'].includes(basis)) throw new Error('invalid_power_basis');
  return { basis, kw: toKw(value, unit), original: { value, unit } };
}
export function configurationFingerprint(vehicle: PowerRecord['vehicle'], propulsion: Propulsion): string {
  return createHash('sha256').update(JSON.stringify({ ...canonicalInput(vehicle), propulsion, yearFrom: vehicle.yearFrom ?? null, yearTo: vehicle.yearTo ?? null, ...(vehicle.engineCcFrom != null || vehicle.engineCcTo != null ? { engineCcFrom:vehicle.engineCcFrom??null,engineCcTo:vehicle.engineCcTo??null } : {}) })).digest('hex');
}
/** Missing identifiers reduce specificity; known contradictions always reject a match. */
export function compareConfiguration(left: ResolveInput, right: ResolveInput) {
  const a = canonicalInput(left), b = canonicalInput(right);
  const conflicts: string[] = [], matched: string[] = [], missing: string[] = [];
  for (const field of Object.keys(a) as Array<keyof typeof a>) {
    if (a[field] == null || b[field] == null) { missing.push(field); continue; }
    const compatibleDrive = field === 'driveType' && ([a[field], b[field]].includes('2WD')) && [a[field], b[field]].every(v => ['2WD','FWD','RWD'].includes(String(v)));
    if (a[field] === b[field] || compatibleDrive) matched.push(field); else conflicts.push(field);
  }
  return { quality: conflicts.length ? 'conflict' : missing.length ? 'partial' : 'exact', conflicts, matched, missing } as const;
}
export function validatePowerRecord(record: PowerRecord): void {
  if (!record.rationale.trim() || !record.origin.project || !record.origin.recordId || !record.origin.revision) throw new Error('missing_provenance');
  if (record.configurationFingerprint !== configurationFingerprint(record.vehicle, record.propulsion)) throw new Error('invalid_fingerprint');
  if (record.vehicle.yearFrom != null && record.vehicle.yearTo != null && record.vehicle.yearFrom > record.vehicle.yearTo) throw new Error('invalid_year_range');
  if (record.vehicle.engineCcFrom != null && record.vehicle.engineCcTo != null && record.vehicle.engineCcFrom > record.vehicle.engineCcTo) throw new Error('invalid_engine_range');
  if (record.resolutionClass !== 'INSUFFICIENT_DATA' && (!record.measurements.length || !record.sources.length)) throw new Error('missing_support');
  if (record.resolutionClass === 'CONFIRMED' && !record.sources.some(s => s.verification === 'official_exact' || s.verification === 'corroborated')) throw new Error('unconfirmed_sources');
  for (const m of record.measurements) {
    const expected = measurement(m.original.value, m.original.unit, m.basis);
    if (Math.abs(expected.kw - m.kw) > 0.0001) throw new Error('inconsistent_power_conversion');
    if (record.propulsion === 'ice' && m.basis !== 'combustion_rated' || record.propulsion === 'electric' && m.basis === 'combustion_rated') throw new Error('incompatible_powertrain');
  }
  const groups = new Map<PowerBasis, number>();
  for (const m of record.measurements) {
    if (groups.has(m.basis) && Math.abs(groups.get(m.basis)! - m.kw) > 0.0001) throw new Error('conflicting_power');
    groups.set(m.basis, m.kw);
  }
}
/** TKS compatibility selection never substitutes peak/system power for continuous power. */
export function tksMeasurement(record: PowerRecord): PowerMeasurement | null {
  validatePowerRecord(record);
  if (record.resolutionClass === 'INSUFFICIENT_DATA' || ['retired','revoked'].includes(record.approvalState)) return null;
  const basis = record.propulsion === 'electric' || record.propulsion === 'hybrid_sequential' ? 'electric_30min' : record.propulsion === 'ice' ? 'combustion_rated' : null;
  return basis ? record.measurements.find(m => m.basis === basis) ?? null : null;
}

export function tksPowerInput(record: PowerRecord, topology?: 'parallel' | 'sequential') {
  validatePowerRecord(record);
  if (record.resolutionClass === 'INSUFFICIENT_DATA' || ['retired','revoked'].includes(record.approvalState)) return null;
  const combustion = record.measurements.find(m => m.basis === 'combustion_rated');
  const continuous = record.measurements.find(m => m.basis === 'electric_30min');
  const selected = record.propulsion === 'hybrid_phev' && topology === 'sequential' ? continuous ?? null : tksMeasurement(record);
  if(record.propulsion === 'hybrid_phev' && !topology) return null;
  const parallel = record.propulsion === 'hybrid_parallel' || record.propulsion === 'hybrid_phev' && topology === 'parallel';
  if (parallel && (!combustion || !continuous) || !parallel && !selected) return null;
  return { calculationPowerKw: parallel ? combustion!.kw + continuous!.kw : selected!.kw, basis: parallel ? 'combustion_rated' as const : selected!.basis, confidence: record.resolutionClass, sourceRef: `${record.origin.project}:${record.origin.recordId}:${record.origin.revision}`, combustionPowerKw: combustion?.kw, electric30MinPowerKw: continuous?.kw };
}
