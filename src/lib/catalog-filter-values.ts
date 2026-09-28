/** Values shown in the filter UI and their source-specific database spellings. */
export const BODY_TYPES: Record<string, string[]> = {
  "Седан": ["Седан", "sedan", "Sedan", "Среднеразмерный автомобиль", "Большой автомобиль", "준중형차", "중형차", "대형차"],
  "Хэтчбек": ["Хэтчбек", "hatchback", "Компактный автомобиль", "Микроавтомобиль", "소형차"],
  "Кроссовер": ["Кроссовер", "SUV"],
  "Универсал": ["Универсал", "wagon"],
  "Минивэн": ["Минивэн", "minivan", "RV", "승합차"],
  "Малолитражка": ["Малолитражка", "경차"],
  "Спорткар": ["Спорткар", "스포츠카"],
  "Другой": ["Другой", "Коммерческий автомобиль", "화물차"],
};

export const TRANSMISSIONS: Record<string, string[]> = {
  automatic: ["automatic", "auto", "Автомат", "오토", "오토(A/T)"],
  manual: ["manual", "Механика", "수동", "수동(M/T)"],
  cvt: ["cvt"],
  dct: ["dct"],
};

export function bodyTypeValues(value: string): string[] {
  return BODY_TYPES[value] ?? [value];
}

export function bodyTypeFilterValue(value: string | null): string | null {
  if (!value) return null;
  return Object.entries(BODY_TYPES).find(([, raw]) => raw.includes(value))?.[0] ?? value;
}

export function transmissionValues(value: string): string[] {
  return TRANSMISSIONS[value] ?? [value];
}

export function transmissionFilterValue(value: string | null): string | null {
  if (!value || value === "-") return null;
  const raw = value.trim().toLowerCase();
  return Object.entries(TRANSMISSIONS).find(([, values]) => values.some((item) => item.toLowerCase() === raw))?.[0] ?? value;
}

/** Canonical drive values stored by the vehicle normalizer, with legacy spellings. */
export const DRIVE_TYPES: Record<string, string[]> = {
  FWD: ["FWD", "Передний", "전륜", "전륜구동"],
  RWD: ["RWD", "Задний", "후륜", "후륜구동"],
  "2WD": ["2WD", "2륜", "2륜구동"],
  "4WD": ["4WD", "AWD", "4륜", "4륜구동", "사륜", "사륜구동"],
};

export function driveTypeValues(value: string): string[] {
  const canonical = driveTypeFilterValue(value);
  return canonical ? DRIVE_TYPES[canonical] ?? [canonical] : [value];
}

export function driveTypeFilterValue(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  return Object.entries(DRIVE_TYPES).find(([, values]) => values.some((item) => item.toLowerCase() === raw))?.[0] ?? value;
}
