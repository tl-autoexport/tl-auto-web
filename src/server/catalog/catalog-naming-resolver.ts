/** Shared scoped naming resolver used by audits and future imports. */
import rules from "../../../data/catalog-naming/label-rules-v1.json";
import {
  canonicalCatalogBrand, canonicalCatalogModel, compactModificationName, generationPresentation,
  isAbsentName, isOrdinalOnlyName, looksLikeModification, namingKey,
  normalizeVehicleName, splitVersionName, sourceGenerationOrdinal,
} from "./catalog-naming";

export type SourceNames = {
  manufacturerCode: string | null; modelGroupCode: string | null; generationCode: string | null;
  modificationCode: string | null; trimCode: string | null; domestic: string | null;
  generationKr: string | null; modificationEn: string | null; modificationKr: string | null;
  trimEn: string | null; trimKr: string | null; listGenerationKr: string | null;
  listModificationKr: string | null; listTrimKr: string | null;
};
export type Car = {
  id: string; primary_source: string; source_id: string; brand: string | null; model: string | null;
  generation: string | null; generation_code: string | null; trim: string | null; grade: string | null;
  badge: string | null; badge_detail: string | null; year: number | null;
  staging_generation: string | null; staging_trim: string | null; source_names: SourceNames;
};
export type Node = {
  key: string; car_type: string; level: string; code: string; parent_key: string | null;
  name_kr: string; name_en: string | null; year_from: string | null; year_to: string | null;
};
export type GenerationAlias = { brand: string; model: string; source_value: string; code: string | null; label_ru: string | null; status: string };
type LabelResult = { label: string | null; status: string; basis: string; nodeKeys: string[] };
const present = (value: string | null | undefined): value is string => !isAbsentName(value);

export function createCatalogNamingResolver(nodes:Node[],aliases:GenerationAlias[]) {
  const snapshot={nodes};
  const ruleConfig=rules;
  const byKey = new Map(snapshot.nodes.map(n => [n.key,n]));
  function path(node: Node): Node[] {
    const out: Node[] = [], seen = new Set<string>(); let n: Node | undefined = node;
    while (n && !seen.has(n.key)) { out.push(n); seen.add(n.key); n = n.parent_key ? byKey.get(n.parent_key) : undefined; }
    return out;
  }
  function context(n: Node) {
    const lineage = path(n);
    const manufacturer = lineage.find(p => p.level === "manufacturer");
    const group = lineage.find(p => p.level === "model_group");
    const generation = lineage.find(p => p.level === "model");
    return { lineage,manufacturer,group,generation,
      brand: canonicalCatalogBrand(manufacturer?.name_en ?? manufacturer?.name_kr),
      model: canonicalCatalogModel(group?.name_en ?? group?.name_kr) };
  }
  function nodeLabel(n: Node) {
    return n.level === "manufacturer" ? canonicalCatalogBrand(n.name_en ?? n.name_kr) :
      n.level === "model_group" ? canonicalCatalogModel(n.name_en ?? n.name_kr) : normalizeVehicleName(n.name_en ?? n.name_kr);
  }
  function select(nodes: Node[],basis: string,sourceName?: string | null): LabelResult {
    const bySource = sourceName ? nodes.filter(n => namingKey(n.name_kr)===namingKey(sourceName) || namingKey(n.name_en)===namingKey(sourceName)) : [];
    const candidates = bySource.length ? bySource : nodes;
    if(candidates.length && candidates.every(n=>isAbsentName(n.name_kr)&&isAbsentName(n.name_en))) {
      return {label:null,status:"not_specified",basis,nodeKeys:candidates.map(n=>n.key)};
    }
    const labels = [...new Set(candidates.map(nodeLabel).filter(present))];
    if (candidates.length && labels.length === 1 && candidates.every(n => nodeLabel(n)===labels[0])) {
      return { label: labels[0],status: "resolved",basis: candidates.length>1 ? `${basis}_same_label_aliases` : basis,nodeKeys: candidates.map(n => n.key) };
    }
    return { label: null,status: candidates.length ? "conflict" : "missing",basis,nodeKeys: candidates.map(n => n.key) };
  }
  const generations = snapshot.nodes.filter(n => n.level === "model");
  const modifications = snapshot.nodes.filter(n => n.level === "badge");
  const trims = snapshot.nodes.filter(n => n.level === "badge_detail");
  const generationContext = new Map(generations.map(n => [n.key,context(n)]));
  const repairs: Array<{ key: string; sourceLabel: string | null; proposedLabel: string | null }> = [];
  const dictionaryNodes = snapshot.nodes.map(n => {
    const ctx = context(n), displayName = nodeLabel(n);
    if (displayName !== n.name_en) repairs.push({ key:n.key,sourceLabel:n.name_en,proposedLabel:displayName });
    return { ...n, display_name:displayName,canonical_brand:ctx.brand,canonical_model:ctx.model,
      source_code_path:ctx.lineage.toReversed().map(p => ({ level:p.level,code:p.code })),
      generation_presentation:n.level === "model" && ctx.model ? generationPresentation(n.name_kr,n.name_en,ctx.model) : null,
      label_status:displayName ? "proposed" : isAbsentName(n.name_en)&&isAbsentName(n.name_kr) ? "not_specified" : "review" };
  });
  const sameLabelGroups = new Map<string,string[]>();
  for (const n of dictionaryNodes) {
    const identity = [n.car_type,...n.source_code_path.map(p => `${p.level}:${p.code}`),n.display_name].join("|");
    sameLabelGroups.set(identity,[...(sameLabelGroups.get(identity) ?? []),n.key]);
  }
  const duplicateNameGroups = [...sameLabelGroups.values()].filter(keys => keys.length>1);
  return (cars:Car[]) => {
  const rowProposals = cars.map(car => {
    const source = car.source_names;
    let brand = canonicalCatalogBrand(car.brand) ?? "";
    let model = canonicalCatalogModel(car.model) ?? "";
    const issues: string[] = [];
    const genRaw = [source.generationKr,source.listGenerationKr,car.generation,car.staging_generation].filter(present);
    const carType = source.domestic === "true" ? "kor" : source.domestic === "false" ? "for" : null;
    let genNodes = generations.filter(n => {
      const ctx = generationContext.get(n.key)!;
      return present(source.manufacturerCode) && present(source.modelGroupCode) && present(source.generationCode) &&
        ctx.manufacturer?.code===source.manufacturerCode && ctx.group?.code===source.modelGroupCode && n.code===source.generationCode && (!carType || n.car_type===carType);
    });
    let genBasis = "taxonomy_code_path";
    if (!genNodes.length) {
      genNodes = generations.filter(n => {
        const ctx = generationContext.get(n.key)!;
        return namingKey(ctx.brand)===namingKey(brand) && namingKey(ctx.model)===namingKey(model) &&
          genRaw.some(raw => [n.name_kr,n.name_en].some(name => present(name) && namingKey(name)===namingKey(raw)));
      });
      genBasis = "taxonomy_scoped_source_name";
    }
    const genMatch = select(genNodes,genBasis,genRaw[0]);
    const chosenGen = genMatch.status === "resolved" ? byKey.get(genMatch.nodeKeys[0]) : undefined;
    if (chosenGen) {
      const ctx = generationContext.get(chosenGen.key)!;
      if (ctx.brand && namingKey(ctx.brand)!==namingKey(brand)) issues.push("source_brand_differs_from_catalog");
      if (ctx.model && namingKey(ctx.model)!==namingKey(model)) issues.push("source_model_differs_from_catalog");
      brand = ctx.brand ?? brand; model = ctx.model ?? model;
    }
    const legacy = aliases.filter(a => a.status === "approved" && namingKey(canonicalCatalogBrand(a.brand))===namingKey(brand) &&
      namingKey(canonicalCatalogModel(a.model))===namingKey(model) && genRaw.some(raw => namingKey(raw)===namingKey(a.source_value)));
    if (new Set(legacy.map(a => a.code)).size>1) issues.push("legacy_generation_alias_conflict");
    const legacyOne = new Set(legacy.map(a => a.code)).size===1 ? legacy[0] : undefined;
    const genPresentation = generationPresentation(chosenGen?.name_kr ?? genRaw[0] ?? "",chosenGen?.name_en ?? null,model,legacyOne?.code);
    const generation = {
      ...genMatch,label:genPresentation.display,fullName:genPresentation.fullName,
      status:genMatch.status === "resolved" ? "resolved" : legacyOne ? "resolved" : genPresentation.display ? "source_descriptor" : genPresentation.fullName ? "source_label" : genRaw.length ? "needs_review" : "missing",
      basis:genMatch.status === "resolved" ? genMatch.basis : legacyOne ? "tl_auto_approved_generation_alias" : "retained_source_name",
      chassisCodes:genPresentation.chassisCodes,ordinal:genPresentation.ordinal,facelift:genPresentation.facelift,sourceValues:genRaw,
    };
    if (genMatch.status === "conflict") { generation.status="conflict";generation.label=null;issues.push("generation_taxonomy_conflict"); }
    const branchKeys = new Set(genMatch.nodeKeys);
    const inBranch = (n: Node) => path(n).some(p => p.level === "model" && branchKeys.has(p.key));
    const modNodes = modifications.filter(n => inBranch(n) && present(source.modificationCode) && n.code===source.modificationCode);
    const modCodeMatch = select(modNodes,"taxonomy_code_path",source.modificationKr);
    const modInputs = [source.modificationEn,source.modificationKr,car.grade,car.badge,source.listModificationKr].filter(present);
    if(!modInputs.length)for(const raw of [car.staging_trim,car.trim,car.badge_detail].filter(present)) {
      const label=normalizeVehicleName(raw);
      if(label && looksLikeModification(label))modInputs.push(raw);
    }
    const modRaw = modCodeMatch.label ?? modInputs.map(normalizeVehicleName).find(present) ?? null;
    const split = splitVersionName(modRaw,brand);
    const modification = { label:split.modification,status:split.modification ? "resolved" : split.trim ? "trim_only" : modInputs.length ? "needs_review" : "missing",
      basis:modCodeMatch.status === "resolved" ? modCodeMatch.basis : "retained_source_name",sourceValues:modInputs,nodeKeys:modCodeMatch.nodeKeys };
    if (modCodeMatch.status === "conflict") { modification.status="conflict";issues.push("modification_taxonomy_conflict"); }
    const trimNodes = trims.filter(n => inBranch(n) && present(source.trimCode) && n.code===source.trimCode &&
      path(n).some(p => p.level === "badge" && p.code===source.modificationCode));
    let trim = select(trimNodes,"taxonomy_code_path",source.trimKr);
    const explicitTrimInputs = [source.trimEn,source.trimKr,source.listTrimKr,car.trim,car.staging_trim].filter(present);
    const trimInputs = [...explicitTrimInputs];
    if (present(car.badge_detail) && !modInputs.some(v => namingKey(v)===namingKey(car.badge_detail))) trimInputs.push(car.badge_detail);
    if (trimInputs.some(isOrdinalOnlyName)) issues.push("ordinal_stored_as_trim");
    if (trim.status === "missing") {
      for (const raw of trimInputs) {
        if (isOrdinalOnlyName(raw)) continue;
        const label = normalizeVehicleName(raw);
        if (!label || looksLikeModification(label)) continue;
        const scopedNodes = trims.filter(n => inBranch(n) && [n.name_kr,n.name_en].some(v => namingKey(v)===namingKey(raw)));
        const matched = select(scopedNodes,"taxonomy_scoped_source_name",raw);
        if (matched.status === "conflict") {trim=matched;break;}
        trim=matched.status === "resolved" ? matched : { label,status:"resolved",basis:explicitTrimInputs.includes(raw) ? "retained_explicit_trim" : "retained_badge_detail",nodeKeys:[] };
        break;
      }
    }
    if (trim.status === "missing" && split.trim) trim={ label:split.trim,status:"resolved",basis:"brand_scoped_composite_suffix",nodeKeys:[] };
    if (trim.status === "missing") {
      const unknown = trimInputs.filter(raw => !isOrdinalOnlyName(raw) && !normalizeVehicleName(raw));
      trim.status=unknown.length || issues.includes("ordinal_stored_as_trim") ? "needs_review" :
        [source.trimKr,source.listTrimKr,car.trim].some(v => Boolean(v?.trim()) && isAbsentName(v)) ? "not_specified" : "missing";
    }
    // MINI source hierarchy puts the ordinal in gradeDetail and variant in Model.
    // Keep that explicit ordinal; do not derive a chassis code or a missing equipment tier.
    const miniOrdinal = brand === "MINI" ? trimInputs.map(sourceGenerationOrdinal).find(n=>n!==null) : undefined;
    if(miniOrdinal) {
      const n=Number(miniOrdinal);
      if(generation.ordinal!==null && generation.ordinal!==n)issues.push("mini_source_ordinal_conflict");
      else {generation.ordinal=n;if(!generation.chassisCodes.length)generation.label=`${n}-е поколение`;generation.basis="mini_explicit_source_ordinal";}
      const miniMatch=generation.fullName?.match(/^Cooper(?:\s+(SD|S|D))?(?:\s|$)/i);
      const variant=miniMatch ? miniMatch[1]?.toUpperCase() ?? "Cooper" : null;
      if(variant){modification.label=[variant,modification.label].filter(present).join(" · ");modification.status="resolved";modification.basis="mini_source_variant_and_grade";}
      if(trim.status==="needs_review" && trimInputs.every(isOrdinalOnlyName))trim.status="not_specified";
      const issueIndex=issues.indexOf("ordinal_stored_as_trim");if(issueIndex>=0)issues.splice(issueIndex,1);
      issues.push("mini_source_hierarchy_normalized");
    }
    // In these exact Encar branches gradeDetail is a generation ordinal, not an equipment tier.
    const ordinalBranches:Record<string,number> = ruleConfig.sourceOrdinalBranches;
    const sourceOrdinal = generation.nodeKeys.map(key=>ordinalBranches[key]).find(n=>n!==undefined);
    const ordinalInputs = trimInputs.filter(isOrdinalOnlyName);
    if(sourceOrdinal && trim.status==="needs_review" && ordinalInputs.length && trimInputs.every(isOrdinalOnlyName) &&
      ordinalInputs.every(raw=>sourceGenerationOrdinal(raw)===sourceOrdinal)) {
      generation.ordinal=sourceOrdinal;
      if(!generation.chassisCodes.length)generation.label=`${sourceOrdinal}-е поколение`;
      generation.basis="scoped_encar_grade_detail_ordinal";
      trim={...trim,label:null,status:"not_specified",basis:"source_level_is_generation_not_equipment"};
      const issueIndex=issues.indexOf("ordinal_stored_as_trim");if(issueIndex>=0)issues.splice(issueIndex,1);
      issues.push("source_generation_level_normalized");
      if(brand==="Lexus" && model==="RC" && generation.fullName==="RC F") {
        modification.label=["RC F",modification.label].filter(present).join(" · ");
        modification.status="resolved";modification.basis="explicit_source_model_variant_and_grade";
      }
    }
    if (trim.status === "conflict") issues.push("trim_taxonomy_conflict");
    if (trim.label && looksLikeModification(trim.label)) {issues.push("modification_stored_as_trim");trim={...trim,label:null,status:"needs_review"};}
    const versionParts = [modification.label,trim.label].filter(present);
    const versionLine = [...new Map(versionParts.map(v => [namingKey(v),v])).values()].join(" · ") || null;
    const namedModification = modification.label && /^(?:\d{3}[di]|\d{2}\s+(?:TDI|TFSI)|[EASC]\d{2,3}[di]?|[PQD]\d{3}|xDrive|sDrive|S|SD|D)\b/i.test(modification.label);
    const compactVersion = trim.label ? namedModification ? versionLine : trim.label : compactModificationName(modification.label);
    return { id:car.id,source:car.primary_source,sourceListingId:car.source_id,year:car.year,
      original:{ brand:car.brand,model:car.model,generation:car.generation,trim:car.trim,grade:car.grade,badge:car.badge,badgeDetail:car.badge_detail,stagingGeneration:car.staging_generation,stagingTrim:car.staging_trim },
      brand,model,title:[brand,model].filter(Boolean).join(" "),generation,modification,
      trim:{...trim,sourceValues:trimInputs},versionLine,compactVersion,issues };
  });
  return { rows:rowProposals,dictionaryNodes,repairs,duplicateNameGroups };
  };
}
export function resolveCatalogNaming(cars:Car[],nodes:Node[],aliases:GenerationAlias[]) {return createCatalogNamingResolver(nodes,aliases)(cars);}
