import { categorizeOption, translateOption } from "@/server/normalization/display";

type EncarOptionDefinition = {
  optionCd?: string | number;
  optionName?: string;
  optionTypeCd?: string | null;
  sort?: number;
  description?: string | null;
  optionTitle?: string | null;
  groupOptionName?: string | null;
  subOptions?: EncarOptionDefinition[] | null;
};

export type EncarOptionCatalog = {
  metas?: Array<{ key?: string | null; value?: string | null }>;
  options?: EncarOptionDefinition[];
};

export type EncarOptionRow = {
  category: string;
  source_code: string | null;
  name_original: string | null;
  name_ru: string | null;
  value_original: string | null;
  value_ru: string | null;
  price_krw: number | null;
  description_original: string | null;
  description_ru: string | null;
  is_present: boolean | null;
  sort_order: number;
};

export function isEncarOptionDisplayable(row: Pick<EncarOptionRow, "name_ru" | "name_original">): boolean {
  return Boolean(row.name_ru || translateOption(row.name_original));
}

const OPTION_CATEGORY_RU: Record<string, string> = {
  "01": "Экстерьер и интерьер",
  "02": "Безопасность",
  "03": "Комфорт и мультимедиа",
  "04": "Сиденья",
};

const code = (value: string | number | null | undefined) =>
  value == null || String(value).trim() === "" ? null : String(value).trim();

function selectedOptionNames(
  option: EncarOptionDefinition,
  selectedCodes: Set<string>,
) {
  const selectedSubOptions = (option.subOptions ?? []).filter((subOption) => {
    const optionCode = code(subOption.optionCd);
    return optionCode != null && selectedCodes.has(optionCode);
  });
  const names = selectedSubOptions
    .map((subOption) => subOption.groupOptionName ?? subOption.optionName)
    .filter((name): name is string => Boolean(name));
  return {
    original: names.join(", ") || null,
    ru: names.map((name) => translateOption(name)).filter(Boolean).join(", ") || null,
  };
}

/** Turn Encar's standard option codes into display rows. */
export function mapStandardOptions(
  catalog: EncarOptionCatalog,
  installedCodes: Array<string | number>,
): EncarOptionRow[] {
  const normalizedCodes = installedCodes.map(code).filter((value): value is string => value != null);
  const selectedCodes = new Set(normalizedCodes);
  return (catalog.options ?? []).map((option, index) => {
    const sourceCode = code(option.optionCd);
    const selectedSubOption = selectedOptionNames(option, selectedCodes);
    const present = Boolean(
      (sourceCode && selectedCodes.has(sourceCode)) ||
      (option.subOptions ?? []).some((subOption) => {
        const optionCode = code(subOption.optionCd);
        return optionCode != null && selectedCodes.has(optionCode);
      }),
    );
    const originalName = option.optionTitle ?? option.groupOptionName ?? option.optionName ?? null;
    return {
      category: OPTION_CATEGORY_RU[String(option.optionTypeCd ?? "")] ?? "Другое",
      source_code: sourceCode,
      name_original: originalName,
      name_ru: translateOption(originalName),
      value_original: selectedSubOption.original,
      value_ru: selectedSubOption.ru,
      price_krw: null,
      description_original: option.description ?? null,
      description_ru: null,
      is_present: normalizedCodes.length ? present : null,
      sort_order: option.sort ?? index,
    };
  });
}

/** Map Encar's optional choice list. */
export function mapChoiceOptions(value: unknown): EncarOptionRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const option = raw as { optionName?: unknown; price?: unknown };
    const original = typeof option.optionName === "string" && option.optionName.trim()
      ? option.optionName.trim()
      : null;
    if (!original) return [];
    const translated = translateOption(original);
    return [{
      category: categorizeOption(original, translated),
      source_code: null,
      name_original: original,
      name_ru: translated,
      value_original: null,
      value_ru: null,
      price_krw: typeof option.price === "number" && Number.isFinite(option.price) ? option.price : null,
      description_original: null,
      description_ru: null,
      is_present: true,
      sort_order: 1000 + index,
    }];
  });
}

/** Installed standard options are the fallback when Encar omits choiceOptions. */
export function mapEncarOptions(
  catalog: EncarOptionCatalog,
  installedCodes: Array<string | number>,
  choiceOptions: unknown,
): EncarOptionRow[] {
  const standard = mapStandardOptions(catalog, installedCodes).filter((row) => row.is_present === true);
  const choices = mapChoiceOptions(choiceOptions);
  const seen = new Set<string>();
  return [...standard, ...choices].filter((row) => {
    const key = `${row.category.toLocaleLowerCase()}|${(row.name_original ?? "").trim().toLocaleLowerCase()}|${row.price_krw ?? ""}`;
    if (!isEncarOptionDisplayable(row) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
