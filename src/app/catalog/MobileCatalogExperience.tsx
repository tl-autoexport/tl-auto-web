"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";

type Option = { value: string; label: string; cars: number };
type Facets = { total: number; axes: Record<string, Option[]> };
type SortOption = { value: string; label: string };
type FieldOptions = { fuels: string[]; transmissions: string[]; bodies: string[]; trims: string[]; colors: string[] };
type Screen = "home" | "brand" | "model" | "generation" | "parameters" | "year" | "price" | "sort";

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
  const [count, setCount] = useState(totalCars);
  const [loading, setLoading] = useState(false);
  const [find, setFind] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useMemo(() => draft.toString(), [draft]);
  const selected = (name: string) => draft.get(name) || "";
  const selectedSummary = [selected("brand"), selected("model"), generationLabel(selected("generation"), facets)].filter(Boolean).join(", ");
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
        if (facetResponse.ok) setFacets(await facetResponse.json());
        if (countResponse.ok) setCount((await countResponse.json()).count ?? 0);
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

  function apply() {
    const suffix = query ? `?${query}` : "";
    router.replace(`/catalog${suffix}#catalog-results`, { scroll: false });
    setScreen("home");
  }

  function reset() {
    setDraft(new URLSearchParams());
    setFacets(null);
    setCount(totalCars);
  }

  function choose(axis: "brand" | "model" | "generation", option: Option) {
    if (axis === "brand") { patch({ brand: option.value, model: null, generation: null }); setScreen("model"); }
    if (axis === "model") { patch({ model: option.value, generation: null }); setScreen("generation"); }
    if (axis === "generation") { patch({ generation: option.value }); setScreen("parameters"); }
  }

  function changeSort(value: string) { patch({ sort: value }); apply(); }
  const chips = [selected("brand"), selected("model"), generationLabel(selected("generation"), facets)].filter(Boolean);

  return <div className="md:hidden">
    <div className="grid gap-2">
      <button className="flex min-h-14 items-center justify-between rounded-xl border border-[#d7dee8] bg-white px-4 text-left" onClick={() => setScreen(selected("brand") ? selected("model") ? "generation" : "model" : "brand")} type="button">
        <span><span className="block text-[10px] font-semibold uppercase tracking-[.12em] text-[#956f2c]">Автомобиль</span><span className="mt-0.5 block text-[15px] font-semibold text-[#101827]">{selectedSummary || "Марка, модель, поколение"}</span></span><ChevronRight className="text-[#647084]" size={20} />
      </button>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[#d7dee8] bg-white">
        <button className="min-h-12 border-r border-[#e1e5eb] text-sm font-semibold" onClick={() => setScreen("year")} type="button">Год</button>
        <button className="min-h-12 border-r border-[#e1e5eb] text-sm font-semibold" onClick={() => setScreen("price")} type="button">Цена</button>
        <button className="flex min-h-12 items-center justify-center gap-1.5 text-sm font-semibold" onClick={() => setScreen("parameters")} type="button"><SlidersHorizontal size={16} />Параметры{activeParameters ? <span className="grid size-5 place-items-center rounded-full bg-[#c7a55a] text-[10px]">{activeParameters}</span> : null}</button>
      </div>
      <button className="flex min-h-10 items-center justify-between rounded-lg border border-[#d7dee8] bg-white px-3 text-xs font-semibold text-[#647084]" onClick={() => setScreen("sort")} type="button"><span>Сортировка</span><span className="text-[#273246]">{sortOptions.find((item) => item.value === selected("sort"))?.label ?? sortOptions[0]?.label}</span></button>
    </div>
    {chips.length ? <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">{chips.map((chip) => <span className="shrink-0 rounded-full bg-[#101827] px-2.5 py-1 text-[11px] font-semibold text-white" key={chip}>{chip}</span>)}</div> : null}

    {screen !== "home" ? <div aria-modal="true" className="fixed inset-0 z-[130] flex flex-col bg-[#f4f6f9] pt-[env(safe-area-inset-top)]" role="dialog">
      <header className="flex min-h-16 items-center border-b border-[#dce2eb] bg-white px-4">
        <button aria-label="Назад" className="grid size-11 place-items-center" onClick={() => setScreen(screen === "parameters" || screen === "year" || screen === "price" || screen === "sort" ? "home" : screen === "brand" ? "home" : screen === "model" ? "brand" : "model")} type="button"><ChevronLeft size={25} /></button>
        <h2 className="flex-1 text-center text-lg font-semibold">{titleFor(screen)}</h2>
        <button aria-label="Сбросить фильтры" className="min-w-11 px-1 text-xs font-semibold text-[#956f2c]" onClick={reset} type="button">Сбросить</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-28">
        {(["brand", "model", "generation"] as Screen[]).includes(screen) ? <Picker axis={screen as "brand" | "model" | "generation"} facets={facets} find={find} inputRef={inputRef} loading={loading} onChoose={choose} onFind={setFind} selected={selected(screen)} /> : null}
        {screen === "parameters" ? <Parameters generationLabel={generationLabel(selected("generation"), facets)} options={options} patch={patch} selected={selected} /> : null}
        {screen === "year" || screen === "price" ? <Range title={screen === "year" ? "Год выпуска" : "Цена до Владивостока, ₽"} minKey={screen === "year" ? "yearMin" : "priceMin"} maxKey={screen === "year" ? "yearMax" : "priceMax"} patch={patch} selected={selected} /> : null}
        {screen === "sort" ? <div className="overflow-hidden rounded-2xl bg-white">{sortOptions.map((option) => <button className={`flex min-h-14 w-full items-center justify-between border-b border-[#edf0f4] px-4 text-left text-sm ${selected("sort") === option.value ? "font-semibold text-[#956f2c]" : "text-[#273246]"}`} key={option.value} onClick={() => changeSort(option.value)} type="button">{option.label}<span>{selected("sort") === option.value ? "✓" : ""}</span></button>)}</div> : null}
      </div>
      {screen !== "sort" ? <div className="border-t border-[#dce2eb] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button className="min-h-14 w-full rounded-2xl bg-[#101827] px-4 text-base font-semibold text-white disabled:opacity-60" disabled={loading} onClick={apply} type="button">Показать {count} {pluralCars(count)}</button></div> : null}
    </div> : null}
  </div>;
}

function Picker({ axis, facets, find, inputRef, loading, onChoose, onFind, selected }: { axis: "brand" | "model" | "generation"; facets: Facets | null; find: string; inputRef: React.RefObject<HTMLInputElement | null>; loading: boolean; onChoose: (axis: "brand" | "model" | "generation", item: Option) => void; onFind: (text: string) => void; selected: string }) {
  const items = (facets?.axes[axis] ?? []).filter((item) => item.label.toLowerCase().includes(find.toLowerCase()));
  return <><label className="relative mb-4 block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a8798]" size={20} /><input className="h-13 w-full rounded-xl bg-white pl-11 pr-4 text-base outline-none ring-1 ring-[#e0e5ec] focus:ring-[#a98239]" onChange={(event) => onFind(event.target.value)} placeholder={`Поиск: ${titleFor(axis).toLowerCase()}`} ref={inputRef} value={find} /></label><div className="overflow-hidden rounded-2xl bg-white">{loading && !facets ? <p className="p-5 text-sm text-[#647084]">Загружаем варианты…</p> : items.length ? items.map((item) => <button className={`flex min-h-14 w-full items-center gap-3 border-b border-[#edf0f4] px-4 text-left ${selected === item.value ? "bg-[#fbf7ed]" : ""}`} key={item.value} onClick={() => { onFind(""); onChoose(axis, item); }} type="button"><span className="min-w-0 flex-1 truncate text-[15px] font-medium">{item.label}</span><span className="text-xs text-[#7a8798]">{item.cars}</span>{selected === item.value ? <span className="text-[#956f2c]">✓</span> : <ChevronRight className="text-[#a4adba]" size={18} />}</button>) : <p className="p-5 text-sm text-[#647084]">Нет вариантов для текущего отбора.</p>}</div></>;
}

function Parameters({ generationLabel, options, patch, selected }: { generationLabel: string; options: FieldOptions; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string }) {
  return <div className="grid gap-4"><section className="rounded-2xl bg-white p-4"><p className="text-sm font-semibold text-[#956f2c]">Автомобиль</p><p className="mt-2 text-base font-semibold">{[selected("brand"), selected("model"), generationLabel].filter(Boolean).join(" · ") || "Не выбран"}</p></section><section className="rounded-2xl bg-white p-4"><h3 className="text-lg font-semibold">Основные параметры</h3><div className="mt-4 grid gap-4"><Select label="Топливо" name="fuel" values={options.fuels} patch={patch} selected={selected} /><Select label="Трансмиссия" name="transmission" values={options.transmissions} patch={patch} selected={selected} /><Select label="Кузов" name="body" values={options.bodies} patch={patch} selected={selected} /><Range title="Пробег, км" minKey="mileageMin" maxKey="mileageMax" patch={patch} selected={selected} /><Range title="Объём двигателя, см³" minKey="engineMin" maxKey="engineMax" patch={patch} selected={selected} /><Range title="Мощность, л.с." minKey="powerMax" maxKey="powerMax" patch={patch} selected={selected} single /></div></section><section className="rounded-2xl bg-white p-4"><h3 className="text-lg font-semibold">Дополнительно</h3><div className="mt-3 grid gap-2">{[["under160", "Автомобили до 160 л.с."], ["passable", "Проходные автомобили"], ["clean", "Без ДТП"], ["noInsurance", "Без страховых выплат"]].map(([key, label]) => <label className="flex min-h-11 items-center gap-3 text-sm" key={key}><input checked={selected(key) === "1"} className="size-5 accent-[#a98239]" onChange={(event) => patch({ [key]: event.target.checked ? "1" : null })} type="checkbox" />{label}</label>)}</div></section></div>;
}

function Select({ label, name, values, patch, selected }: { label: string; name: string; values: string[]; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string }) { return <label className="grid gap-1.5 text-sm text-[#647084]">{label}<select className="h-12 rounded-xl border border-[#d7dee8] bg-white px-3 text-[15px] text-[#273246]" onChange={(event) => patch({ [name]: event.target.value || null })} value={selected(name)}><option value="">Любой</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>; }
function Range({ title, minKey, maxKey, patch, selected, single = false }: { title: string; minKey: string; maxKey: string; patch: (values: Record<string, string | null>) => void; selected: (name: string) => string; single?: boolean }) { return <fieldset><legend className="mb-1.5 text-sm text-[#647084]">{title}</legend><div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[#d7dee8] bg-white"><input className="min-w-0 border-r border-[#d7dee8] px-3 py-3 text-[15px] outline-none" inputMode="numeric" onChange={(event) => patch({ [minKey]: event.target.value || null })} placeholder={single ? "До" : "От"} value={selected(minKey)} />{single ? <div className="flex items-center px-3 text-sm text-[#7a8798]">л.с.</div> : <input className="min-w-0 px-3 py-3 text-[15px] outline-none" inputMode="numeric" onChange={(event) => patch({ [maxKey]: event.target.value || null })} placeholder="До" value={selected(maxKey)} />}</div></fieldset>; }
function cleanParams(query: string) { const params = new URLSearchParams(query); ["page", "cursor", "limit"].forEach((key) => params.delete(key)); return params; }
function generationLabel(code: string, facets: Facets | null) { return facets?.axes.generation?.find((item) => item.value === code)?.label || (code ? code.toUpperCase() : ""); }
function titleFor(screen: Screen | "brand" | "model" | "generation") { return ({ brand: "Марка", model: "Модель", generation: "Поколение", parameters: "Параметры", year: "Год выпуска", price: "Цена", sort: "Сортировка", home: "Фильтры" } as const)[screen]; }
function pluralCars(count: number) { const tail = count % 100; if (tail > 10 && tail < 15) return "автомобилей"; return count % 10 === 1 ? "автомобиль" : count % 10 >= 2 && count % 10 <= 4 ? "автомобиля" : "автомобилей"; }
