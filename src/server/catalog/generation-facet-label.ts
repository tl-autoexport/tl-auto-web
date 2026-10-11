import taxonomy from "../../../data/catalog-naming/encar-taxonomy-v1.json";
import { canonicalCatalogBrand, canonicalCatalogModel, generationPresentation, namingKey } from "./catalog-naming";

/** Enrich display only. Existing grouped filter keys and predicates remain unchanged. */
export function generationFacetLabel(value: string, fallback: string, brand?: string | null, model?: string | null) {
  fallback = fallback.replace(/\bIg\b/g, "IG");
  if (!brand || !model || /\(((?:с |до )?\d{4}(?:–\d{4})?)\)$/.test(fallback)) return fallback;
  const descriptor = value.startsWith("ordinal:") ? value.split(":").slice(3).join(":") : value;
  const matches = taxonomy.nodes.filter(node => node.level === "model" &&
    namingKey(canonicalCatalogBrand(node.canonical_brand)) === namingKey(canonicalCatalogBrand(brand)) &&
    namingKey(canonicalCatalogModel(node.canonical_model)) === namingKey(canonicalCatalogModel(model)) &&
    namingKey(generationPresentation(node.name_kr, node.name_en, model).display) === namingKey(descriptor));
  if (!matches.length) return fallback;
  // A chassis key may group facelift/powertrain nodes. Describe the complete
  // period of that group, never assign the first node's narrower dates to it.
  const starts = matches.map(node => node.year_from?.slice(0, 4));
  const ends = matches.map(node => node.year_to?.slice(0, 4));
  if (starts.some(year => !year || !/^\d{4}$/.test(year))) return fallback;
  const from = starts.reduce((a, b) => a! < b! ? a : b)!;
  const to = ends.every(year => year && /^\d{4}$/.test(year)) ? ends.reduce((a, b) => a! > b! ? a : b)! : null;
  const name = /^[a-z0-9 /-]+$/i.test(descriptor) ? `${canonicalCatalogModel(model)} (${descriptor.toUpperCase()})` : `${canonicalCatalogModel(model)}, ${descriptor}`;
  return `${name} (${to ? from === to ? from : `${from}–${to}` : `с ${from}`})`;
}
