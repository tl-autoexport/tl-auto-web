"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LoaderCircle, RotateCcw, X } from "lucide-react";
import { IDENTITY_KEYS, useCatalogFilterDraft, type IdentitySelection } from "./CatalogFilterDraft";
import { translateBrand, translateModel } from "@/server/normalization/display";
import { BrandLogo } from "@/components/catalog/BrandLogo";
import { catalogRead, catalogFacetUrl } from "@/lib/catalog-client-read";

type FacetOption = { value: string; label: string; cars: number };
type FacetsResponse = { total?: number; axes: Record<string, FacetOption[]> };
type Level = typeof IDENTITY_KEYS[number];
type Selection = IdentitySelection;

type Props = {
  currentQuery: string;
  totalCars: number;
  brand?: string | null;
  model?: string | null;
  generation?: string | null;
  modification?: string | null;
  trim?: string | null;
  onSelection?: (value: Selection) => void;
  onApply?: () => void;
};

const LEVEL_LABEL: Record<Level, string> = { brand: "Марка", model: "Модель", generation: "Поколение", modification: "Модификация", trim: "Комплектация" };

export function GenerationCascade({ currentQuery, totalCars, brand, model, generation, modification, trim, onSelection, onApply }: Props) {
  const router = useRouter();
  const draft = useCatalogFilterDraft();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>("brand");
  const [selection, setSelection] = useState<Selection>({ brand: brand ?? undefined, model: model ?? undefined, generation: generation ?? undefined, modification: modification ?? undefined, trim: trim ?? undefined });
  const identity = draft?.identity ?? selection;
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; data: FacetsResponse } | null>(null);
  const [loadedGenerations, setLoadedGenerations] = useState<{ query: string; data: FacetsResponse } | null>(null);
  const [resolvedCount, setResolvedCount] = useState<{ query: string; count: number } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams(draft?.parameters ?? currentQuery);
    for (const key of [...IDENTITY_KEYS, "page"]) params.delete(key);
    for (const key of IDENTITY_KEYS) if (identity[key]) params.set(key, identity[key]!);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [currentQuery, identity, draft?.parameters]);

  const generationsQuery = useMemo(() => {
    const params = new URLSearchParams();
    const current = new URLSearchParams(currentQuery);
    const source = current.get("source");
    if (source) params.set("source", source);
    if (identity.brand) params.set("brand", identity.brand);
    if (identity.model) params.set("model", identity.model);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [currentQuery, identity.brand, identity.model]);

  const optionsQuery = catalogFacetUrl(query, level);
  const loading = loaded?.query !== optionsQuery && failedQuery !== optionsQuery;
  const data = loaded?.query === optionsQuery ? loaded.data : null;
  const generationsLoading = open && loadedGenerations?.query !== generationsQuery;
  const generationsData = loadedGenerations?.query === generationsQuery ? loadedGenerations.data : null;
  const generationOptions = generationsData?.axes.generation ?? data?.axes.generation ?? [];

  useEffect(() => {
    if (!open || level === "generation") return;
    let active = true;
    catalogRead<FacetsResponse>(optionsQuery)
      .then((json) => { if (active) { setLoaded({ query: optionsQuery, data: json }); setFailedQuery((previous) => previous === optionsQuery ? null : previous); } })
      .catch(() => { if (active) setFailedQuery(optionsQuery); })
    return () => { active = false; };
  }, [open, level, optionsQuery, retry]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      catalogRead<{ count: number }>(`/api/catalog/count${query}`)
        .then(result => { if (active) setResolvedCount({ query, count: result.count }); })
        .catch(() => { /* The apply action remains usable if an optional count fails. */ });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query]);

  useEffect(() => {
    if (!open || level !== "generation") return;
    let active = true;
    catalogRead<FacetsResponse>(catalogFacetUrl(generationsQuery, "generation"))
      .then((json: FacetsResponse) => { if (active) { setLoadedGenerations({ query: generationsQuery, data: json }); setFailedQuery((previous) => previous === generationsQuery ? null : previous); } })
      .catch(() => { if (active) setFailedQuery(generationsQuery); })
    return () => { active = false; };
  }, [open, level, generationsQuery, retry]);

  const options = (level === "generation" ? generationOptions : data?.axes[level] ?? []).filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const generationLabel = generationOptions.find((item) => item.value === identity.generation)?.label ?? (identity.generation?.startsWith("ordinal:") ? identity.generation.split(":").slice(3).join(":") : identity.generation?.toUpperCase());

  function show(nextLevel: Level) {
    if (nextLevel === "model" && !identity.brand) return;
    if (nextLevel === "generation" && !identity.model) return;
    if (nextLevel === "modification" && !identity.generation) return;
    if (nextLevel === "trim" && !identity.generation) return;
    setSearch("");
    setLevel(nextLevel);
    setOpen(true);
  }

  function change(next: Selection) {
    if (draft) draft.setIdentity(next); else setSelection(next);
    onSelection?.(next);
  }
  function pick(option: FacetOption) {
    const index = IDENTITY_KEYS.indexOf(level);
    const next = { ...identity };
    for (const key of IDENTITY_KEYS.slice(index)) delete next[key];
    next[level] = option.value;
    change(next);
    const nextLevel = IDENTITY_KEYS[index + 1];
    if (nextLevel) {
      const params = new URLSearchParams(nextLevel === "generation" ? generationsQuery : query);
      for (const key of IDENTITY_KEYS) { params.delete(key); if (next[key]) params.set(key, next[key]!); }
      // Start the next step while the user moves to its control.
      void catalogRead(catalogFacetUrl(params.toString(), nextLevel)).catch(() => undefined);
    }
    setOpen(false);
    setSearch("");
  }
  function clearLevel() {
    const next = { ...identity };
    for (const key of IDENTITY_KEYS.slice(IDENTITY_KEYS.indexOf(level))) delete next[key];
    change(next);
    setOpen(false);
  }
  function reset() { change({}); setLevel("brand"); setSearch(""); }

  function apply() {
    setOpen(false);
    if (onApply) onApply(); else router.replace(`/catalog${query}#catalog-results`, { scroll: false });
  }

  return (
    <div className="relative">
      <div className="mb-5 grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
        {IDENTITY_KEYS.map((item) => {
          const index = IDENTITY_KEYS.indexOf(item);
          const parent = item === "trim" ? "generation" : IDENTITY_KEYS[index - 1];
          const disabled = index > 0 && !identity[parent];
          const shownValue = item === "generation" ? generationLabel : item === "brand" ? translateBrand(identity.brand) : item === "model" ? translateModel(identity.brand, identity.model) : identity[item];
          return (
            <button className={`grid min-h-[68px] grid-cols-[1fr_auto] items-center rounded-xl border px-4 text-left transition ${level === item && open ? "border-[#a98239] bg-[#fffaf0] shadow-[0_0_0_2px_rgba(169,130,57,0.12)]" : shownValue ? "border-[#c7a55a] bg-white" : "border-[#d7dee8] bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-[#a98239]"}`} disabled={disabled} key={item} onClick={() => show(item)} type="button">
              <span className="min-w-0">
                <span className="block text-xs text-[#7a8798]">{LEVEL_LABEL[item]}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-[#273246]">{shownValue || `Все ${item === "brand" ? "марки" : item === "model" ? "модели" : item === "generation" ? "поколения" : item === "modification" ? "модификации" : "комплектации"}`}</span>
              </span>
              <ChevronDown className="ml-3 text-[#647084]" size={18} />
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="fixed inset-0 z-[120] flex items-end bg-[#101827]/35 backdrop-blur-[2px] md:absolute md:inset-auto md:left-0 md:right-0 md:top-full md:mt-2 md:block md:bg-transparent md:backdrop-blur-none">
          <div role="dialog" aria-label={LEVEL_LABEL[level]} className="w-full rounded-t-3xl border border-[#dce2eb] bg-white p-4 shadow-2xl md:rounded-2xl md:p-5">
            <div className="mb-3 flex items-center gap-3">
              <input aria-label={`Поиск: ${LEVEL_LABEL[level]}`} className="h-11 min-w-0 flex-1 rounded-xl border border-[#d7dee8] px-3 text-base" placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button aria-label="Закрыть выбор" className="grid size-10 place-items-center rounded-full bg-[#f2f4f7] text-[#647084]" onClick={() => setOpen(false)} type="button"><X size={19} /></button>
            </div>

            <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-[#e8ecf2] md:grid md:max-h-72 md:grid-cols-2 lg:grid-cols-3">
              {failedQuery === (level === "generation" ? generationsQuery : optionsQuery) ? (
                <div className="p-4 text-sm text-[#647084]">Не удалось загрузить варианты.<button className="ml-2 font-semibold text-[#956f2c]" type="button" onClick={() => { setFailedQuery(null); setRetry((value) => value + 1); }}>Повторить</button></div>
              ) : (level === "generation" ? generationsLoading : loading) ? (
                <p className="flex items-center gap-2 p-4 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={17} /> Загружаем варианты</p>
              ) : options.length ? options.map((option) => {
                const selected = identity[level] === option.value;
                const label = level === "brand" ? translateBrand(option.label) : level === "model" ? translateModel(identity.brand, option.label) : option.label;
                return <button className={`flex min-h-12 w-full items-center justify-between gap-3 border-b border-[#eef1f5] px-4 text-left text-sm transition md:border-r ${selected ? "bg-[#fbf7ed]" : "hover:bg-[#f7f9fc]"}`} key={`${level}-${option.value}`} onClick={() => pick(option)} type="button"><span className="flex min-w-0 items-center gap-2.5">{level === "brand" ? <BrandLogo brand={option.value} size={28} /> : null}<span className="min-w-0 truncate font-medium text-[#273246]">{label || option.label}</span></span>{level === "model" ? <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded border text-xs ${selected ? "border-[#a98239] bg-[#a98239] text-white" : "border-[#b9c1cb] text-transparent"}`}>✓</span> : <span className="shrink-0 text-xs text-[#7a8798]">{option.cars}</span>}</button>;
              }) : <p className="p-4 text-sm text-[#647084]">Нет вариантов</p>}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="min-h-11 px-2 text-sm font-semibold text-[#647084]" onClick={clearLevel} type="button">{level === "brand" ? "Все марки" : level === "model" ? "Все модели" : level === "generation" ? "Все поколения" : level === "modification" ? "Все модификации" : "Все комплектации"}</button>
              <button className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-[#647084]" onClick={reset} type="button"><RotateCcw size={15} /> Сбросить</button>
              <button className="ml-auto min-h-12 rounded-xl bg-[#101827] px-5 text-sm font-semibold text-white md:min-w-56" onClick={apply} type="button">{resolvedCount?.query === query ? `Показать ${resolvedCount.count}` : query === currentQuery ? `Показать ${totalCars}` : "Показать автомобили"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
