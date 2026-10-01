const BRAND_ALIASES: Record<string, { label: string; values: string[] }> = {
  kgm: {
    label: "KGM",
    values: ["KGM", "KG_Mobility_Ssangyong", "KG__Mobility_Ssangyong", "Kg__mobility_ssangyong", "KG__mobility__ssangyong", "SsangYong", "Ssangyong", "KG Mobility"],
  },
  kgmobilityssangyong: {
    label: "KGM",
    values: ["KGM", "KG_Mobility_Ssangyong", "KG__Mobility_Ssangyong", "Kg__mobility_ssangyong", "KG__mobility__ssangyong", "SsangYong", "Ssangyong", "KG Mobility"],
  },
  ssangyong: {
    label: "KGM",
    values: ["KGM", "KG_Mobility_Ssangyong", "KG__Mobility_Ssangyong", "Kg__mobility_ssangyong", "KG__mobility__ssangyong", "SsangYong", "Ssangyong", "KG Mobility"],
  },
  kgmobility: {
    label: "KGM",
    values: ["KGM", "KG_Mobility_Ssangyong", "KG__Mobility_Ssangyong", "Kg__mobility_ssangyong", "KG__mobility__ssangyong", "SsangYong", "Ssangyong", "KG Mobility"],
  },
  mini: { label: "MINI", values: ["MINI", "Mini"] },
};

function brandKey(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "");
}

/** Stable customer-facing name for known source spelling variants. */
export function normalizeCatalogBrand(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  return BRAND_ALIASES[brandKey(raw)]?.label ?? raw;
}

/** Raw source values represented by one canonical brand filter. */
export function catalogBrandValues(value: string) {
  const raw = value.trim();
  if (!raw) return [];
  return BRAND_ALIASES[brandKey(raw)]?.values ?? [raw];
}
