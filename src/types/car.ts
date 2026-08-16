export type SourceKind = "encar";

export interface CarSummary {
  id: string;
  primarySource: SourceKind;
  sourceId: string;
  sourceUrl: string;
  brand: string;
  model: string;
  grade?: string;
  year: number;
  registrationMonth: number;
  mileageKm: number;
  priceKrw: number;
  engineCc: number;
  powerHp: number;
  fuelType: string;
  transmission?: string;
  driveType?: string;
  color?: string;
  photoUrl?: string;
  has360Interior?: boolean;
  hasUnderbodyPhoto?: boolean;
}
