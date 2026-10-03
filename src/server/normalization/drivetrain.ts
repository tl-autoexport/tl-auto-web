/** Canonical catalogue categories; source confidence is stored separately. */
export type TransmissionType = 'automatic' | 'dct' | 'cvt' | 'manual';
export function normalizeTransmissionType(value: unknown): TransmissionType | null {
 const s=String(value??'').trim().toLowerCase();
 if(!s||s==='-'||s==='unknown')return null;
 if(/cvt|ivt|e-cvt|вариатор|무단|c.tech/.test(s))return 'cvt';
 if(/dct|dsg|edc|s.tronic|pdk|робот|듀얼|세미오토|semi.auto/.test(s))return 'dct';
 if(/manual|mechanic|механ|수동|m\/t|\bmt\b/.test(s))return 'manual';
 if(/automatic|автомат|акпп|오토|자동|a\/t|\bat\b|tiptronic|steptronic/.test(s))return 'automatic';
 return null;
}
export type CatalogDriveType = 'FWD'|'RWD'|'2WD'|'4WD';
export function catalogDriveType(value: unknown): CatalogDriveType|null {
 const s=String(value??'').trim().toLowerCase();
 if((s.includes('передний')&&s.includes('задний'))||(s.includes('fwd')&&s.includes('rwd')))return null;
 if(/4wd|awd|4matic|xdrive|quattro|4motion|all.?4|4륜|4х4|4x4|полный|사륜/.test(s))return '4WD';
 if(/\bfwd\b|передний|전륜/.test(s))return 'FWD';
 if(/\brwd\b|задний|후륜/.test(s))return 'RWD';
 if(/2wd|2륜/.test(s))return '2WD';
 return null;
}
