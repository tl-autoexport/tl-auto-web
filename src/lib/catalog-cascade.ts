export const CASCADE_LEVELS = ["brand", "model", "generation", "modification", "trim"] as const;
export type CascadeLevel = typeof CASCADE_LEVELS[number];

export function cascadeChange(level: CascadeLevel, value: string | null) {
  return Object.fromEntries(CASCADE_LEVELS.slice(CASCADE_LEVELS.indexOf(level)).map(key => [key, key === level ? value : null]));
}

export function cascadeFacetQuery(query: string, level: CascadeLevel) {
  const params = new URLSearchParams(query);
  params.delete("page");
  for (const key of CASCADE_LEVELS.slice(CASCADE_LEVELS.indexOf(level))) params.delete(key);
  if (level === "generation") {
    const identity = new URLSearchParams();
    for (const key of ["brand", "model", "source"]) {
      const value = params.get(key);
      if (value) identity.set(key, value);
    }
    return identity.toString();
  }
  return params.toString();
}

export function splitGenerationLabel(label: string) {
  const match = label.match(/^(.*?)\s*\(((?:с |до )?\d{4}(?:–\d{4})?)\)$/);
  return match ? { name: match[1], period: match[2] } : { name: label, period: null };
}
