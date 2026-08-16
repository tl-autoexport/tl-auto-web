export const VEHICLE_TYPES = [
  "car",
  "motorcycle",
  "scooter",
  "jetski",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export type VehicleSourceStatus = "active" | "research" | "excluded";

export type VehicleSourcePlan = {
  label: string;
  source: string | null;
  status: VehicleSourceStatus;
  note: string;
};

export const VEHICLE_SOURCE_PLAN: Record<VehicleType, VehicleSourcePlan> = {
  car: {
    label: "Автомобили",
    source: "encar",
    status: "active",
    note: "Единственный активный источник автомобилей TL Auto.",
  },
  motorcycle: {
    label: "Мотоциклы",
    source: null,
    status: "research",
    note: "Источник и правила импорта требуют отдельного исследования.",
  },
  scooter: {
    label: "Скутеры",
    source: null,
    status: "research",
    note: "Источник и правила импорта требуют отдельного исследования.",
  },
  jetski: {
    label: "Гидроциклы",
    source: null,
    status: "research",
    note: "Источник и правила импорта требуют отдельного исследования.",
  },
};

export function isVehicleType(value: string): value is VehicleType {
  return (VEHICLE_TYPES as readonly string[]).includes(value);
}
