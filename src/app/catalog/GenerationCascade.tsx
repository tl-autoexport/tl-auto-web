"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LoaderCircle, RotateCcw, X } from "lucide-react";

type FacetOption = { value: string; label: string; cars: number };
type FacetsResponse = { total: number; axes: Record<string, FacetOption[]> };
type Level = "brand" | "model" | "generation";
type Selection = { brand?: string; model?: string; generation?: string };

type Props = {
  currentQuery: string;
  totalCars: number;
  brand?: string | null;
  model?: string | null;
  generation?: string | null;
};

const LEVEL_LABEL: Record<Level, string> = { brand: "Марка", model: "Модель", generation: "Поколение" };

export function GenerationCascade({ currentQuery, totalCars, brand, model, generation }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>("brand");
  const [selection, setSelection] = useState<Selection>({ brand: brand ?? undefined, model: model ?? undefined, generation: generation ?? undefined });
  const [loaded, setLoaded] = useState<{ query: string; data: FacetsResponse } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams(currentQuery);
    for (const key of ["brand", "model", "generation", "page"]) params.delete(key);
    if (selection.brand) params.set("brand", selection.brand);
    if (selection.model) params.set("model", selection.model);
    if (selection.generation) params.set("generation", selection.generation);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [currentQuery, selection]);

  const loading = open && loaded?.query !== query;
  const data = loaded?.query === query ? loaded.data : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/catalog/facets${query}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((json: FacetsResponse) => { if (!cancelled) setLoaded({ query, data: json }); })
      .catch(() => { if (!cancelled) setLoaded({ query, data: { total: 0, axes: {} } }); });
    return () => { cancelled = true; };
  }, [open, query]);

  const options = level === "brand" ? data?.axes.brand ?? [] : level === "model" ? data?.axes.model ?? [] : data?.axes.generation ?? [];
  const generationLabel = data?.axes.generation?.find((item) => item.value === selection.generation)?.label ?? selection.generation?.toUpperCase();
  const summary = [selection.brand, selection.model, generationLabel].filter(Boolean).join(", ");

  function show(nextLevel: Level) {
    if (nextLevel === "model" && !selection.brand) return;
    if (nextLevel === "generation" && !selection.model) return;
    setLevel(nextLevel);
    setOpen(true);
  }

  function pick(option: FacetOption) {
    if (level === "brand") {
      setSelection({ brand: option.value });
      setLevel("model");
    } else if (level === "model") {
      setSelection({ brand: selection.brand, model: option.value });
      setLevel("generation");
    } else {
      setSelection((current) => ({ ...current, generation: option.value }));
    }
  }

  function reset() {
    setSelection({});
    setLevel("brand");
  }

  function apply() {
    setOpen(false);
    router.replace(`/catalog${query}#catalog-results`, { scroll: false });
  }

  return (
    <div className="relative">
      <button className="flex min-h-14 w-full items-center justify-between rounded-xl border border-[#d7dee8] bg-white px-4 text-left md:hidden" onClick={() => show(selection.brand ? (selection.model ? "generation" : "model") : "brand")} type="button">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#956f2c]">Автомобиль</span>
          <span className="mt-0.5 block truncate text-[15px] font-semibold text-[#101827]">{summary || "Марка, модель, поколение"}</span>
        </span>
        <ChevronRight className="shrink-0 text-[#647084]" size={20} />
      </button>

      <div className="hidden grid-cols-3 gap-3 md:grid">
        {(["brand", "model", "generation"] as Level[]).map((item) => {
          const disabled = (item === "model" && !selection.brand) || (item === "generation" && !selection.model);
          const shownValue = item === "generation" ? generationLabel : selection[item];
          return (
            <button className={`grid min-h-[68px] grid-cols-[1fr_auto] items-center rounded-xl border px-4 text-left transition ${level === item && open ? "border-[#a98239] bg-[#fffaf0] shadow-[0_0_0_2px_rgba(169,130,57,0.12)]" : shownValue ? "border-[#c7a55a] bg-white" : "border-[#d7dee8] bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-[#a98239]"}`} disabled={disabled} key={item} onClick={() => show(item)} type="button">
              <span className="min-w-0">
                <span className="block text-xs text-[#7a8798]">{LEVEL_LABEL[item]}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-[#273246]">{shownValue || `Все ${item === "brand" ? "марки" : item === "model" ? "модели" : "поколения"}`}</span>
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
              {(["brand", "model", "generation"] as Level[]).map((item, index) => (
                <span className="inline-flex shrink-0 items-center gap-1" key={item}>
                  {index ? <ChevronRight className="text-[#b0b7c2]" size={14} /> : null}
                  <button className={level === item ? "font-semibold text-[#956f2c]" : "text-[#647084]"} onClick={() => show(item)} type="button">{item === "generation" ? generationLabel || LEVEL_LABEL[item] : selection[item] || LEVEL_LABEL[item]}</button>
                </span>
              ))}
            </div>

            <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-[#e8ecf2] md:grid md:max-h-72 md:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                <p className="flex items-center gap-2 p-4 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={17} /> Загружаем варианты</p>
              ) : options.length ? options.map((option) => {
                const selected = selection[level] === option.value;
                return <button className={`flex min-h-12 w-full items-center justify-between gap-3 border-b border-[#eef1f5] px-4 text-left text-sm transition md:border-r ${selected ? "bg-[#fbf7ed]" : "hover:bg-[#f7f9fc]"}`} key={`${level}-${option.value}`} onClick={() => pick(option)} type="button"><span className="truncate font-medium text-[#273246]">{option.label}</span><span className="shrink-0 text-xs text-[#7a8798]">{option.cars}</span></button>;
              }) : <p className="p-4 text-sm text-[#647084]">{level === "generation" ? "Для этой модели подтверждённых поколений нет." : "Нет вариантов для текущего отбора."}</p>}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-[#647084]" onClick={reset} type="button"><RotateCcw size={15} /> Сбросить</button>
              <button className="ml-auto min-h-12 rounded-xl bg-[#101827] px-5 text-sm font-semibold text-white md:min-w-56" onClick={apply} type="button">Показать {data?.total ?? totalCars}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
