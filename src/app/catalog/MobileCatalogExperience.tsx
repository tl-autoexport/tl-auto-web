"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RotateCcw, Search, SlidersHorizontal } from "lucide-react";

type Option = { value: string; label: string; cars: number };
type Facets = { total: number; axes: Record<string, Option[]> };
type SortOption = { value: string; label: string };
type FieldOptions = { fuels: string[]; transmissions: string[]; bodies: string[]; trims: string[]; colors: string[] };
type Screen = "home" | "brand" | "model" | "generation" | "parameters" | "year" | "price" | "sort";
type RangePickerState = { title: string; minKey: string; maxKey: string; single?: boolean };

const PARAM_KEYS = ["fuel", "transmission", "body", "trim", "color", "yearMin", "yearMax", "priceMin", "priceMax", "mileageMax", "engineMin", "engineMax", "powerMax", "under160", "passable", "clean", "noInsurance"];

export function MobileCatalogExperience({ currentQuery, options, sortOptions, totalCars }: {
  currentQuery: string;
  options: FieldOptions;
  sortOptions: SortOption[];
  totalCars: number;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("home");
  const [draft, setDraft] = useState(() => cleanParams(currentQuery));
  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetsQuery, setFacetsQuery] = useState("");
  const [count, setCount] = useState(totalCars);
  const [countQuery, setCountQuery] = useState(() => cleanParams(currentQuery).toString());
  const [loading, setLoading] = useState(false);
  const [find, setFind] = useState("");
  const [rangePicker, setRangePicker] = useState<RangePickerState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useMemo(() => draft.toString(), [draft]);
  const currentFacets = facetsQuery === query ? facets : null;
  const hasCurrentCount = countQuery === query;
  const selected = (name: string) => draft.get(name) || "";
  const activeParameters = PARAM_KEYS.filter((key) => draft.has(key)).length;

  useEffect(() => {
    if (screen === "home") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const suffix = query ? `?${query}` : "";
        const [facetResponse, countResponse] = await Promise.all([
          fetch(`/api/catalog/facets${suffix}`, { signal: controller.signal }),
          fetch(`/api/catalog/count${suffix}`, { signal: controller.signal }),
        ]);
        if (facetResponse.ok) {
          setFacets(await facetResponse.json());
          setFacetsQuery(query);
        }
        if (countResponse.ok) {
          setCount((await countResponse.json()).count ?? 0);
          setCountQuery(query);
        }
      } catch {
        // A cancelled request is expected while the customer changes a filter.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, screen]);

  useEffect(() => {
    if (["brand", "model", "generation"].includes(screen)) {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [screen]);

  function patch(values: Record<string, string | null>) {
    setDraft((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("page");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value); else next.delete(key);
      }
      return next;
    });
  }

  function apply(nextDraft = draft) {
    const nextQuery = nextDraft.toString();
    const suffix = nextQuery ? `?${nextQuery}` : "";
    router.replace(`/catalog${suffix}#catalog-results`, { scroll: false });
    setScreen("home");
  }

  function reset() {
    const retainedBrand = selected("brand");
    setDraft((previous) => {
      const next = new URLSearchParams(previous);
      if (screen === "brand") ["brand", "model", "generation"].forEach((key) => next.delete(key));
      if (screen === "model") ["model", "generation"].forEach((key) => next.delete(key));
      if (screen === "generation") next.delete("generation");
      if (screen === "parameters") ["brand", "model", "generation", ...PARAM_KEYS].forEach((key) => next.delete(key));
      if (["year", "price"].includes(screen)) PARAM_KEYS.forEach((key) => next.delete(key));
      if (screen === "sort") next.delete("sort");
      return next;
    });
    setFacets(null);
    setFacetsQuery("");
    setCount(screen === "model" && retainedBrand ? currentFacets?.axes.brand?.find((item) => item.value === retainedBrand)?.cars ?? totalCars : totalCars);
    setCountQuery("");
  }

  function resetAll() {
    setDraft(new URLSearchParams());
    setFacets(null);
    setFacetsQuery("");
    setCount(totalCars);
    setCountQuery("");
    router.replace("/catalog#catalog-results", { scroll: false });
  }

  function choose(axis: "brand" | "model" | "generation", option: Option) {
    if (axis === "brand") { patch({ brand: option.value, model: null, generation: null }); setScreen("model"); }
    if (axis === "model") { patch({ model: selected("model") === option.value ? null : option.value, generation: null }); }
    if (axis === "generation") { patch({ generation: selected("generation") === option.value ? null : option.value }); }
  }

  function changeSort(value: string) {
    const next = new URLSearchParams(draft);
    next.delete("page");
    next.set("sort", value);
    setDraft(next);
    apply(next);
  }
  const chips = [selected("brand"), selected("model"), generationLabel(selected("generation"), currentFacets)].filter(Boolean);
  const hasAppliedFilters = chips.length > 0 || activeParameters > 0;

  return <div className="md:hidden">
    <div className="bg-[#f5f6f8] px-3 py-2 sm:px-5">
      <div className="grid grid-cols-2 gap-2">
        <button className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#d7dee8] bg-white px-3 text-sm font-semibold" onClick={() => setScreen("parameters")} type="button"><SlidersHorizontal size={16} />Фильтры{activeParameters ? <span className="grid size-5 place-items-center rounded-full bg-[#c7a55a] text-[10px]">{activeParameters}</span> : null}</button>
        <button className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#d7dee8] bg-white px-3 text-sm font-semibold" onClick={() => setScreen("sort")} type="button">Сортировка<ChevronRight size={16} className="text-[#7a8798]" /></button>
      </div>
      {hasAppliedFilters ? <div className="scrollbar-none mt-2 flex items-center gap-1.5 overflow-x-auto">{chips.map((chip) => <span className="shrink-0 rounded-full bg-[#101827] px-2.5 py-1 text-[11px] font-semibold text-white" key={chip}>{chip}</span>)}<button className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#657287]" onClick={resetAll} type="button"><RotateCcw size={14} />Сбросить всё</button></div> : null}
    </div>

    {screen !== "home" ? <div aria-modal="true" className="fixed inset-x-0 top-0 z-[130] flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#f4f6f9] pt-[env(safe-area-inset-top)]" role="dialog">
      <header className="grid min-h-16 grid-cols-[44px_minmax(0,1fr)_76px] items-center border-b border-[#dce2eb] bg-white px-4">
        <button aria-label="Назад" className="grid size-11 place-items-center" onClick={() => setScreen(screen === "parameters" || screen === "year" || screen === "price" || screen === "sort" ? "home" : screen === "brand" ? "home" : screen === "model" ? "brand" : "model")} type="button"><ChevronLeft size={25} /></button>
        <h2 className="truncate text-center text-lg font-semibold">{titleFor(screen)}</h2>
        <button aria-label="Сбросить фильтры" className="px-1 text-right text-xs font-semibold text-[#956f2c]" onClick={reset} type="button">Сбросить</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-28">
        {(["brand", "model", "generation"] as Screen[]).includes(screen) ? <Picker axis={screen as "brand" | "model" | "generation"} facets={currentFacets} find={find} inputRef={inputRef} loading={loading} onChoose={choose} onFind={setFind} selectedValue={selected(screen)} /> : null}
        {screen === "parameters" ? <Parameters generationLabel={generationLabel(selected("generation"), currentFacets)} onOpenRange={setRangePicker} onSelectLevel={setScreen} options={options} patch={patch} selected={selected} /> : null}
        {screen === "year" || screen === "price" ? <Range title={screen === "year" ? "Год выпуска" : "Цена до Владивостока, ₽"} minKey={screen === "year" ? "yearMin" : "priceMin"} maxKey={screen === "year" ? "yearMax" : "priceMax"} onOpen={setRangePicker} selected={selected} /> : null}
        {screen === "sort" ? <div className="overflow-hidden rounded-2xl bg-white">{sortOptions.map((option) => <button className={`flex min-h-14 w-full items-center justify-between border-b border-[#edf0f4] px-4 text-left text-sm ${selected("sort") === option.value ? "font-semibold text-[#956f2c]" : "text-[#273246]"}`} key={option.value} onClick={() => changeSort(option.value)} type="button">{option.label}<span>{selected("sort") === option.value ? "✓" : ""}</span></button>)}</div> : null}
      </div>
      {screen !== "sort" ? <div className="shrink-0 border-t border-[#dce2eb] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button className="min-h-14 w-full rounded-2xl bg-[#101827] px-4 text-base font-semibold text-white disabled:opacity-60" disabled={loading || !hasCurrentCount} onClick={() => apply()} type="button">{loading || !hasCurrentCount ? "Пересчитываем…" : `Показать ${count} ${pluralCars(count)}`}</button></div> : null}
    </div> : null}
    {rangePicker ? <RangePicker onClose={() => setRangePicker(null)} patch={patch} selected={selected} state={rangePicker} /> : null}
  </div>;
}

function Picker({ axis, facets, find, inputRef, loading, onChoose, onFind, selectedValue }: { axis: "brand" | "model" | "generation"; facets: Facets | null; find: string; inputRef: React.RefObject<HTMLInputElement | null>; loading: boolean; onChoose: (axis: "brand" | "model" | "generation", item: Option) => void; onFind: (text: string) => void; selectedValue: string }) {
  const items = (facets?.axes[axis] ?? []).filter((item) => item.label.toLowerCase().includes(find.toLowerCase()));
  return <><label className="relative mb-4 block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a8798]" size={20} /><input className="h-13 w-full rounded-xl bg-white pl-11 pr-4 text-base outline-none ring-1 ring-[#e0e5ec] focus:ring-[#a98239]" onChange={(event) => onFind(event.target.value)} placeholder={`Поиск: ${titleFor(axis).toLowerCase()}`} ref={inputRef} value={find} /></label><div className="overflow-hidden rounded-2xl bg-white">{loading && !facets ? <p className="p-5 text-sm text-[#647084]">Загружаем варианты…</p> : items.length ? items.map((item) => { const isSelected = selectedValue === item.value; return <button className={`flex min-h-14 w-full items-center gap-3 border-b border-[#edf0f4] px-4 text-left ${isSelected ? "bg-[#fbf7ed]" : ""}`} key={item.value} onClick={() => { onFind(""); onChoose(axis, item); }} type="button"><span className="min-w-0 flex-1 truncate text-[15px] font-medium">{item.label}</span><span className="text-xs text-[#7a8798]">{item.cars}</span>{axis === "brand" ? <ChevronRight aria-hidden="true" className="text-[#a4adba]" size={18} /> : <span aria-hidden="true" className={`grid size-6 place-items-center rounded-md border ${isSelected ? "border-[#a98239] bg-[#a98239] text-white" : "border-[#b9c1cb] text-transparent"}`}>✓</span>}</button>; }) : <p className="p-5 text-sm text-[#647084]">Нет вариантов для текущего отбора.</p>}</div></>;
}

function Parameters({ generationLabel, onOpenRange, onSelectLevel, options, patch, selected }: { generationLabel: string; onOpenRange: (state: RangePickerState) => void; onSelectLevel: (screen: Screen) => void; options: FieldOptions; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string }) {
  const row = (label: string, value: string, screen: Screen) => <button className="flex min-h-16 w-full items-center justify-between border-b border-[#edf0f4] text-left" onClick={() => onSelectLevel(screen)} type="button"><span><span className="block text-sm text-[#7a8798]">{label}</span><span className="mt-1 block text-[15px] font-medium text-[#273246]">{value || `Выбрать ${label.toLowerCase()}`}</span></span><ChevronRight className="text-[#a4adba]" size={19} /></button>;
  return <div className="grid gap-4"><section className="rounded-2xl bg-white p-4"><h3 className="text-lg font-semibold">Марка и модель</h3>{row("Марка", selected("brand"), "brand")}{row("Модель", selected("model"), "model")}{row("Поколение", generationLabel, "generation")}</section><section className="rounded-2xl bg-white p-4"><h3 className="text-lg font-semibold">Основные параметры</h3><div className="mt-4 grid gap-4"><Select label="Топливо" name="fuel" values={options.fuels} patch={patch} selected={selected} /><Select label="Трансмиссия" name="transmission" values={options.transmissions} patch={patch} selected={selected} /><Select label="Кузов" name="body" values={options.bodies} patch={patch} selected={selected} /><Range title="Пробег, км" minKey="mileageMin" maxKey="mileageMax" onOpen={onOpenRange} selected={selected} /><Range title="Объём двигателя, см³" minKey="engineMin" maxKey="engineMax" onOpen={onOpenRange} selected={selected} /><Range title="Мощность, л.с." minKey="powerMax" maxKey="powerMax" onOpen={onOpenRange} selected={selected} single /></div></section><section className="rounded-2xl bg-white p-4"><h3 className="text-lg font-semibold">Дополнительно</h3><div className="mt-3 grid gap-2">{[["under160", "Автомобили до 160 л.с."], ["passable", "Проходные автомобили"], ["clean", "Без ДТП"], ["noInsurance", "Без страховых выплат"]].map(([key, label]) => <label className="flex min-h-11 items-center gap-3 text-sm" key={key}><input checked={selected(key) === "1"} className="size-5 accent-[#a98239]" onChange={(event) => patch({ [key]: event.target.checked ? "1" : null })} type="checkbox" />{label}</label>)}</div></section></div>;
}

function Select({ label, name, values, patch, selected }: { label: string; name: string; values: string[]; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string }) { return <label className="grid gap-1.5 text-sm text-[#647084]">{label}<select className="h-12 rounded-xl border border-[#d7dee8] bg-white px-3 text-[15px] text-[#273246]" onChange={(event) => patch({ [name]: event.target.value || null })} value={selected(name)}><option value="">Любой</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>; }
function Range({ title, minKey, maxKey, onOpen, selected, single = false }: { title: string; minKey: string; maxKey: string; onOpen: (state: RangePickerState) => void; selected: (name: string) => string; single?: boolean }) {
  const displayValue = (value: string, fallback: string) => value ? formatRangeValue(value, minKey) : fallback;
  return <fieldset><legend className="mb-1.5 text-sm text-[#647084]">{title}</legend><button aria-label={`Выбрать: ${title}`} className="grid w-full grid-cols-2 overflow-hidden rounded-xl border border-[#d7dee8] bg-white text-left" onClick={() => onOpen({ title, minKey, maxKey, single })} type="button"><span className="min-w-0 border-r border-[#d7dee8] px-3 py-3 text-[15px] text-[#273246]">{displayValue(selected(minKey), single ? "До" : "От")}</span><span className="min-w-0 px-3 py-3 text-[15px] text-[#273246]">{single ? "л.с." : displayValue(selected(maxKey), "До")}</span></button></fieldset>;
}

function RangePicker({ onClose, patch, selected, state }: { onClose: () => void; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string; state: RangePickerState }) {
  const values = rangeValues(state.minKey);
  const minValue = selected(state.minKey);
  const maxValue = selected(state.maxKey);
  const selectValue = (key: string, value: string) => {
    if (key === state.minKey && !state.single && maxValue && Number(value) > Number(maxValue)) return;
    if (key === state.maxKey && minValue && Number(value) < Number(minValue)) return;
    patch({ [key]: value || null });
  };
  const column = (key: string, heading: string, value: string) => <div className="min-w-0"><p className="mb-2 text-sm text-[#7a8798]">{heading}</p><div className="h-56 snap-y overflow-y-auto rounded-2xl bg-[#f2f4f7] p-1">{["", ...values].map((option) => <button className={`block min-h-11 w-full snap-center rounded-xl px-3 text-left text-[15px] ${value === option ? "bg-white font-semibold text-[#101827] shadow-sm" : "text-[#647084]"}`} key={option || "empty"} onClick={() => selectValue(key, option)} type="button">{option ? formatRangeValue(option, state.minKey) : "Не выбрано"}</button>)}</div></div>;
  return <div aria-modal="true" className="fixed inset-0 z-[150] flex items-end bg-[#101827]/45" onClick={onClose} role="dialog"><section className="w-full rounded-t-[28px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}><div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d5dae2]" /><header className="mb-5 flex items-center justify-between gap-3"><h3 className="text-xl font-semibold">{state.title}</h3><button className="text-sm font-semibold text-[#956f2c]" onClick={() => patch({ [state.minKey]: null, [state.maxKey]: null })} type="button">Сбросить</button><button aria-label="Закрыть" className="grid size-9 place-items-center text-3xl font-light leading-none" onClick={onClose} type="button">×</button></header><div className={state.single ? "grid" : "grid grid-cols-2 gap-3"}>{state.single ? column(state.minKey, "До", minValue) : <>{column(state.minKey, "От", minValue)}{column(state.maxKey, "До", maxValue)}</>}</div><button className="mt-5 min-h-14 w-full rounded-2xl bg-[#101827] px-4 text-base font-semibold text-white" onClick={onClose} type="button">Готово</button></section></div>;
}

function rangeValues(key: string) {
  if (key === "yearMin") return Array.from({ length: 37 }, (_, index) => String(new Date().getFullYear() - index));
  if (key === "priceMin") return Array.from({ length: 80 }, (_, index) => String((index + 1) * 250_000));
  if (key === "mileageMin") return Array.from({ length: 31 }, (_, index) => String(index * 10_000));
  if (key === "engineMin") return Array.from({ length: 66 }, (_, index) => String(500 + index * 100));
  if (key === "powerMax") return Array.from({ length: 39 }, (_, index) => String(50 + index * 25));
  return [];
}

function formatRangeValue(value: string, key: string) {
  const number = Number(value);
  if (key === "priceMin") return `${new Intl.NumberFormat("ru-RU").format(number)} ₽`;
  if (key === "mileageMin") return `${new Intl.NumberFormat("ru-RU").format(number)} км`;
  if (key === "engineMin") return `${new Intl.NumberFormat("ru-RU").format(number)} см³`;
  if (key === "powerMax") return `${number} л.с.`;
  return value;
}
function cleanParams(query: string) { const params = new URLSearchParams(query); ["page", "cursor", "limit"].forEach((key) => params.delete(key)); return params; }
function generationLabel(code: string, facets: Facets | null) { return facets?.axes.generation?.find((item) => item.value === code)?.label || (code ? code.toUpperCase() : ""); }
function titleFor(screen: Screen | "brand" | "model" | "generation") { return ({ brand: "Марка", model: "Модель", generation: "Поколение", parameters: "Параметры", year: "Год выпуска", price: "Цена", sort: "Сортировка", home: "Фильтры" } as const)[screen]; }
function pluralCars(count: number) { const tail = count % 100; if (tail > 10 && tail < 15) return "автомобилей"; return count % 10 === 1 ? "автомобиль" : count % 10 >= 2 && count % 10 <= 4 ? "автомобиля" : "автомобилей"; }
