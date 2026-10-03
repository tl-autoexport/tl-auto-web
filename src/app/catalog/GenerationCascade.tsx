"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LoaderCircle, RotateCcw, X } from "lucide-react";
import { IDENTITY_KEYS, useCatalogFilterDraft, type IdentitySelection } from "./CatalogFilterDraft";
import { translateBrand, translateModel } from "@/server/normalization/display";
import { BrandLogo } from "@/components/catalog/BrandLogo";

type FacetOption = { value: string; label: string; cars: number };
type FacetsResponse = { total: number; axes: Record<string, FacetOption[]> };
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
  const [resolvedCount, setResolvedCount] = useState<{query:string;count:number}|null>(null);
  const [loaded, setLoaded] = useState<{ query: string; data: FacetsResponse } | null>(null);
  const [loadedGenerations, setLoadedGenerations] = useState<{ query: string; data: FacetsResponse } | null>(null);

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

  const loading = loaded?.query !== query || resolvedCount?.query !== query;
  const data = loaded?.query === query ? loaded.data : null;
  const generationsLoading = open && loadedGenerations?.query !== generationsQuery;
  const generationsData = loadedGenerations?.query === generationsQuery ? loadedGenerations.data : null;
  const generationOptions = generationsData?.axes.generation ?? data?.axes.generation ?? [];

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/catalog/count${query}`,{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject(new Error("count"))).then((p:{count:number})=>{if(Number.isFinite(p.count))setResolvedCount({query,count:p.count});}).catch(()=>{});
    return ()=>controller.abort();
  },[query]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/catalog/facets${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((json: FacetsResponse) => setLoaded({ query, data: json }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) setLoaded({ query, data: { total: 0, axes: {} } });
      });
    return () => controller.abort();
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/catalog/facets${generationsQuery}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((json: FacetsResponse) => setLoadedGenerations({ query: generationsQuery, data: json }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) setLoadedGenerations({ query: generationsQuery, data: { total: 0, axes: {} } });
      });
    return () => controller.abort();
  }, [open, generationsQuery]);

  const options = level === "generation" ? generationOptions : data?.axes[level] ?? [];
  const generationLabel = generationOptions.find((item) => item.value === identity.generation)?.label ?? identity.generation?.toUpperCase();
  const summary = [identity.brand, identity.model, generationLabel].filter(Boolean).join(", ");
  const needsGeneration = Boolean(identity.brand && identity.model && !identity.generation);

  function show(nextLevel: Level) {
    if (nextLevel === "model" && !identity.brand) return;
    if (nextLevel === "generation" && !identity.model) return;
    if (nextLevel === "modification" && !identity.generation) return;
    if (nextLevel === "trim" && !identity.modification) return;
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
    if (index < IDENTITY_KEYS.length - 1) setLevel(IDENTITY_KEYS[index + 1]);
  }
  function reset() { change({}); setLevel("brand"); }

  function apply() {
    setOpen(false);
    if (onApply) onApply(); else router.replace(`/catalog${query}#catalog-results`, { scroll: false });
  }

  return (
    <div className="relative">
      <button className="flex min-h-14 w-full items-center justify-between rounded-xl border border-[#d7dee8] bg-white px-4 text-left md:hidden" onClick={() => show(identity.brand ? (identity.model ? "generation" : "model") : "brand")} type="button">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#956f2c]">Автомобиль</span>
          <span className="mt-0.5 block truncate text-[15px] font-semibold text-[#101827]">{summary || "Марка, модель, поколение"}</span>
        </span>
        <ChevronRight className="shrink-0 text-[#647084]" size={20} />
      </button>

      <div className="hidden grid-cols-3 gap-3 md:grid">
        {IDENTITY_KEYS.map((item) => {
          const index = IDENTITY_KEYS.indexOf(item);
          const disabled = index > 0 && !identity[IDENTITY_KEYS[index - 1]];
          const shownValue = item === "generation" ? generationLabel : item === "brand" ? translateBrand(identity.brand) : item === "model" ? translateModel(identity.brand, identity.model) : identity[item];
          return (
            <button className={`grid min-h-[68px] grid-cols-[1fr_auto] items-center rounded-xl border px-4 text-left transition ${level === item && open ? "border-[#a98239] bg-[#fffaf0] shadow-[0_0_0_2px_rgba(169,130,57,0.12)]" : shownValue ? "border-[#c7a55a] bg-white" : "border-[#d7dee8] bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-[#a98239]"}`} disabled={disabled} key={item} onClick={() => show(item)} type="button">
              <span className="min-w-0">
                <span className="block text-xs text-[#7a8798]">{LEVEL_LABEL[item]}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-[#273246]">{shownValue || `Все ${item === "brand" ? "марки" : item === "model" ? "модели" : item === "generation" ? "поколения" : item === "modification" ? "модификации" : "комплектации"}`}</span>
                {item === "model" && needsGeneration ? <span className="mt-0.5 block truncate text-xs text-[#7a8798]">Указать поколение</span> : null}
              </span>
              <ChevronDown className="ml-3 text-[#647084]" size={18} />
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="fixed inset-0 z-[120] flex items-end bg-[#101827]/35 backdrop-blur-[2px] md:absolute md:inset-auto md:left-0 md:right-0 md:top-full md:mt-2 md:block md:bg-transparent md:backdrop-blur-none">
          <div className="w-full rounded-t-3xl border border-[#dce2eb] bg-white p-4 shadow-2xl md:rounded-2xl md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#956f2c]">{LEVEL_LABEL[level]}</p>
                <p className="mt-1 text-sm text-[#647084]">Выберите значение — счётчик обновится автоматически</p>
              </div>
              <button aria-label="Закрыть" className="grid size-10 place-items-center rounded-full bg-[#f2f4f7] text-[#647084]" onClick={() => setOpen(false)} type="button"><X size={19} /></button>
            </div>

            <div className="mb-3 flex gap-1 overflow-x-auto text-sm">
              {IDENTITY_KEYS.map((item, index) => (
                <span className="inline-flex shrink-0 items-center gap-1" key={item}>
                  {index ? <ChevronRight className="text-[#b0b7c2]" size={14} /> : null}
                  <button className={level === item ? "font-semibold text-[#956f2c]" : "text-[#647084]"} onClick={() => show(item)} type="button">{item === "generation" ? generationLabel || LEVEL_LABEL[item] : item === "brand" ? translateBrand(identity.brand) || LEVEL_LABEL[item] : (item === "model" ? translateModel(identity.brand, identity.model) : identity[item]) || LEVEL_LABEL[item]}</button>
                </span>
              ))}
            </div>

            <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-[#e8ecf2] md:grid md:max-h-72 md:grid-cols-2 lg:grid-cols-3">
              {(level === "generation" ? generationsLoading : loading) ? (
                <p className="flex items-center gap-2 p-4 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={17} /> Загружаем варианты</p>
              ) : options.length ? options.map((option) => {
                const selected = identity[level] === option.value;
                const label = level === "brand" ? translateBrand(option.label) : level === "model" ? translateModel(identity.brand, option.label) : option.label;
                return <button className={`flex min-h-12 w-full items-center justify-between gap-3 border-b border-[#eef1f5] px-4 text-left text-sm transition md:border-r ${selected ? "bg-[#fbf7ed]" : "hover:bg-[#f7f9fc]"}`} key={`${level}-${option.value}`} onClick={() => pick(option)} type="button"><span className="flex min-w-0 items-center gap-2.5"><BrandLogo brand={option.value} size={28} /><span className="min-w-0 truncate font-medium text-[#273246]">{label || option.label}</span></span>{level === "model" ? <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded border text-xs ${selected ? "border-[#a98239] bg-[#a98239] text-white" : "border-[#b9c1cb] text-transparent"}`}>✓</span> : <span className="shrink-0 text-xs text-[#7a8798]">{option.cars}</span>}</button>;
              }) : <p className="p-4 text-sm text-[#647084]">{level === "generation" ? "Для этой модели нет данных о поколении. Можно показать объявления без этого выбора." : "Нет вариантов для текущего отбора."}</p>}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-[#647084]" onClick={reset} type="button"><RotateCcw size={15} /> Сбросить</button>
              <button className="ml-auto min-h-12 rounded-xl bg-[#101827] px-5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60 md:min-w-56" disabled={loading} onClick={apply} type="button">{loading ? "Пересчитываем…" : `Показать ${resolvedCount?.count ?? totalCars}`}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
