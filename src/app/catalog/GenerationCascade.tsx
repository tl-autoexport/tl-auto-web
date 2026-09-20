"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle, RotateCcw, X } from "lucide-react";

/**
 * Cascade filter: brand → model → generation.
 *
 * The counters come from /api/catalog/facets, which is built from the same
 * predicate as the listing, so the number on the button is the number of cars
 * the list will show. Every level is fetched with the selections made so far,
 * which is why an open level offers the alternatives of that level and not a
 * single narrowed option.
 *
 * The URL carries stable codes (`generation=dn8`), never Korean source strings.
 */
type FacetOption = { value: string; label: string; cars: number };
type FacetsResponse = { total: number; axes: Record<string, FacetOption[]> };
type Level = "brand" | "model" | "generation";

type Selection = { brand?: string; model?: string; generation?: string };

type Props = {
  /** The current feed query, without the leading question mark. */
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
  const [selection, setSelection] = useState<Selection>({
    brand: brand ?? undefined,
    model: model ?? undefined,
    generation: generation ?? undefined,
  });
  const [loaded, setLoaded] = useState<{ query: string; data: FacetsResponse } | null>(null);

  // The query for the current selection, with the cascade filters replaced.
  const query = useMemo(() => {
    const params = new URLSearchParams(currentQuery);
    for (const key of ["brand", "model", "generation", "page"]) params.delete(key);
    if (selection.brand) params.set("brand", selection.brand);
    if (selection.model) params.set("model", selection.model);
    if (selection.generation) params.set("generation", selection.generation);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [currentQuery, selection]);

  // Loading is derived from whether the fetched payload belongs to the current
  // query, so the effect never sets state synchronously.
  const loading = open && loaded?.query !== query;
  const data = loaded?.query === query ? loaded.data : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/catalog/facets${query}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json: FacetsResponse) => { if (!cancelled) setLoaded({ query, data: json }); })
      .catch(() => { if (!cancelled) setLoaded({ query, data: { total: 0, axes: {} } }); });
    return () => { cancelled = true; };
  }, [open, query]);

  const options: FacetOption[] = level === "brand"
    ? data?.axes.brand ?? []
    : level === "model"
      ? data?.axes.model ?? []
      : data?.axes.generation ?? [];

  const summary = [selection.brand, selection.model, selection.generation].filter(Boolean).join(" · ");

  function pick(option: FacetOption) {
    if (level === "brand") {
      setSelection({ brand: option.value });
      setLevel("model");
      return;
    }
    if (level === "model") {
      setSelection((current) => ({ brand: current.brand, model: option.value }));
      setLevel("generation");
      return;
    }
    setSelection((current) => ({ ...current, generation: option.value }));
  }

  function reset() {
    setSelection({});
    setLevel("brand");
  }

  function apply() {
    setOpen(false);
    router.replace(`/catalog${query}`, { scroll: false });
  }

  return (
    <div className="relative">
      <button
        className="inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-[#d7dee8] bg-white px-3 text-left text-sm font-medium text-[#273246] transition hover:border-[#a98239] md:w-auto"
        onClick={() => { setOpen((value) => !value); setLevel(selection.brand ? (selection.model ? "generation" : "model") : "brand"); }}
        type="button"
      >
        <span className="truncate">{summary || "Марка · Модель · Поколение"}</span>
        <span className="shrink-0 text-xs text-[#647084]">{totalCars}</span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-[#dce2eb] bg-white p-3 shadow-xl md:w-[420px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 text-sm">
              {(["brand", "model", "generation"] as Level[]).map((item, index) => {
                const value = selection[item];
                return (
                  <span className="inline-flex items-center gap-1" key={item}>
                    {index > 0 ? <ChevronRight className="text-[#a8b0bb]" size={14} /> : null}
                    <button
                      className={`rounded px-1.5 py-0.5 ${level === item ? "bg-[#101827] text-white" : value ? "text-[#273246] hover:bg-[#f2f5f9]" : "text-[#8a93a0]"}`}
                      onClick={() => setLevel(item)}
                      type="button"
                    >
                      {value ?? LEVEL_LABEL[item]}
                    </button>
                  </span>
                );
              })}
            </div>
            <button aria-label="Закрыть" className="rounded p-1 text-[#647084] hover:bg-[#f2f5f9]" onClick={() => setOpen(false)} type="button">
              <X size={18} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-[#eef1f6]">
            {loading ? (
              <p className="flex items-center gap-2 p-3 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={16} /> Загружаем варианты</p>
            ) : options.length ? (
              options.map((option) => {
                const selected = selection[level] === option.value;
                return (
                  <button
                    className={`flex w-full items-center justify-between gap-3 border-b border-[#f4f6fa] px-3 py-2 text-left text-sm last:border-b-0 ${selected ? "bg-[#f7f3ea]" : "hover:bg-[#f7f9fc]"}`}
                    key={`${level}-${option.value}`}
                    onClick={() => pick(option)}
                    type="button"
                  >
                    <span className="truncate text-[#273246]">{option.label}</span>
                    <span className="shrink-0 text-xs text-[#647084]">{option.cars}</span>
                  </button>
                );
              })
            ) : (
              <p className="p-3 text-sm text-[#647084]">
                {level === "generation" ? "Для этой модели подтверждённых поколений нет." : "Нет вариантов для текущего отбора."}
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button className="inline-flex items-center gap-1.5 px-2 py-1 text-sm font-semibold text-[#647084] hover:text-[#273246]" onClick={reset} type="button">
              <RotateCcw size={14} /> Сбросить
            </button>
            <button className="rounded-lg bg-[#101827] px-4 py-2 text-sm font-semibold text-white" onClick={apply} type="button">
              Показать {data?.total ?? totalCars} автомобилей
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
