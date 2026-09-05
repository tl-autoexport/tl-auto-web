"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ListFilter,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useDestination } from "@/components/site/DestinationProvider";
import { VISIBLE_DESTINATIONS, type CountryCode } from "@/lib/destinations";

type PanelName = "parameters" | "brandModel" | "region" | "transport" | "sort" | null;
const sortOptions = [
  { value: "fresh", label: "Сначала свежие объявления" },
  { value: "price_asc", label: "Цена: ниже" },
  { value: "price_desc", label: "Цена: выше" },
  { value: "year_desc", label: "Год: новее" },
  { value: "mileage_asc", label: "Пробег: меньше" },
] as const;

const popularBrands = ["Kia", "Hyundai", "Genesis", "BMW", "Mercedes-Benz", "Toyota", "Audi"];
const countries = VISIBLE_DESTINATIONS;

type ParameterState = {
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMax: string;
  powerMax: string;
  body: string;
  fuel: string;
  transmission: string;
};

const emptyParameters: ParameterState = {
  priceMin: "",
  priceMax: "",
  yearMin: "",
  yearMax: "",
  mileageMax: "",
  powerMax: "",
  body: "",
  fuel: "",
  transmission: "",
};

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function CatalogQuickNav({ brands = [], models = [] }: { brands?: string[]; models?: Array<{ brand: string; model: string }> }) {
  const [panel, setPanel] = useState<PanelName>(null);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [parameters, setParameters] = useState<ParameterState>(emptyParameters);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const { country, city, setDestination } = useDestination();
  const suggestions = useMemo(() => {
    const query = normalizeSearch(search);
    if (query.length < 2) return [];
    return [...brands.map((brand) => ({ label: brand, query: brand })), ...models.map(({ brand, model }) => ({ label: `${brand} ${model}`, query: `${brand} ${model}` }))]
      .filter((item, index, items) => items.findIndex((candidate) => normalizeSearch(candidate.label) === normalizeSearch(item.label)) === index)
      .filter((item) => normalizeSearch(item.label).includes(query)).slice(0, 8);
  }, [brands, models, search]);

  const parameterQuery = useMemo(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (value.trim()) query.set(key, value.trim());
    }
    return query;
  }, [parameters]);

  useEffect(() => {
    if (panel !== "parameters") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCountLoading(true);
      try {
        const response = await fetch(`/api/catalog/count?${parameterQuery.toString()}`, { signal: controller.signal });
        if (response.ok) {
          const payload = await response.json() as { count?: number };
          setResultCount(typeof payload.count === "number" ? payload.count : null);
        }
      } catch {
        if (!controller.signal.aborted) setResultCount(null);
      } finally {
        if (!controller.signal.aborted) setCountLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [panel, parameterQuery]);

  useEffect(() => {
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  const submitSearch = (event: FormEvent<HTMLFormElement>, nextSearch = search) => {
    event.preventDefault();
    const value = nextSearch.trim();
    const key = /^\d+$/.test(value) ? "number" : "search";
    window.location.assign(value ? `/catalog?${key}=${encodeURIComponent(value)}` : "/catalog");
  };

  const submitBrandModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (brand.trim()) query.set("brand", brand.trim());
    if (model.trim()) query.set("model", model.trim());
    window.location.assign(`/catalog${query.toString() ? `?${query.toString()}` : ""}`);
  };

  const submitParameters = () => {
    window.location.assign(`/catalog${parameterQuery.toString() ? `?${parameterQuery.toString()}` : ""}`);
  };

  const resetParameters = () => {
    setParameters(emptyParameters);
    setResultCount(null);
  };

  const selectDestination = (countryCode: CountryCode, cityId?: string) => {
    setDestination(countryCode, cityId);
    if (cityId) setPanel(null);
  };

  return (
    <>
    <nav aria-label="Быстрый подбор автомобиля" className="sticky top-[68px] z-40 isolate border-b border-[#dce2eb] bg-white/95 shadow-[0_5px_12px_rgba(15,31,49,0.06)] backdrop-blur sm:top-[74px] lg:top-[76px]">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
          <form className="relative w-full md:w-[260px] md:shrink-0" onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#69768a]" size={17} />
            <input aria-label="Поиск по модели или номеру лота" className="h-11 w-full rounded-2xl border border-[#d7dee8] bg-white py-2 pl-10 pr-4 text-base text-[#101827] outline-none transition placeholder:text-[#7a8798] focus:border-[#956f2c] focus:ring-2 focus:ring-[#c7a55a]/20 md:h-10 md:rounded-full md:text-sm" enterKeyHint="search" inputMode="search" onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по марке или модели" value={search} />
            {suggestions.length ? <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[#dce2eb] bg-white shadow-[0_12px_30px_rgba(16,24,39,0.14)]">{suggestions.map((item) => <button className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[#f7f8fa]" key={item.query} onClick={() => { setSearch(item.query); window.location.assign(`/catalog?search=${encodeURIComponent(item.query)}`); }} type="button">{item.label}</button>)}</div> : null}
          </form>
          <div className="scrollbar-none flex w-full min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none]">
            <QuickButton icon={SlidersHorizontal} label="Параметры" mobileLabel="Параметры" onClick={() => setPanel(panel === "parameters" ? null : "parameters")} open={panel === "parameters"} />
            <QuickButton label="Марка и модель" mobileLabel="Марка, модель" onClick={() => setPanel(panel === "brandModel" ? null : "brandModel")} open={panel === "brandModel"} />
            <QuickButton label={city.label} onClick={() => setPanel(panel === "region" ? null : "region")} open={panel === "region"} />
            <QuickButton label="Авто" onClick={() => setPanel(panel === "transport" ? null : "transport")} open={panel === "transport"} />
            <QuickButton icon={ListFilter} label="Сортировка" mobileLabel="Сортировка" onClick={() => setPanel(panel === "sort" ? null : "sort")} open={panel === "sort"} />
          </div>
        </div>
      </div>

    </nav>

      {panel ? (
        <div className="fixed inset-0 z-[70] bg-[#101827]/25 p-0 sm:flex sm:items-start sm:justify-center sm:p-4 sm:pt-[132px]">
          <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_18px_45px_rgba(16,24,39,0.18)] sm:h-auto sm:max-h-[calc(100vh-148px)] sm:w-[min(560px,calc(100vw-32px))] sm:rounded-3xl sm:border sm:border-[#dce2eb]">
            <PanelHeader panel={panel} onClose={() => setPanel(null)} onReset={panel === "parameters" ? resetParameters : undefined} />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-5">
              {panel === "parameters" ? <ParametersPanel parameters={parameters} setParameters={setParameters} count={resultCount} loading={countLoading} /> : null}
              {panel === "brandModel" ? <BrandModelPanel brand={brand} model={model} setBrand={setBrand} setModel={setModel} onSubmit={submitBrandModel} /> : null}
              {panel === "region" ? <RegionPanel countryCode={country.countryCode} cityId={city.id} onSelect={selectDestination} /> : null}
              {panel === "transport" ? <TransportPanel /> : null}
              {panel === "sort" ? <SortPanel /> : null}
            </div>
            {panel === "parameters" ? <button className="m-4 mt-0 h-12 shrink-0 rounded-xl bg-[#111827] px-4 text-sm font-semibold text-white transition hover:bg-[#263247] disabled:opacity-60" disabled={countLoading} onClick={submitParameters} type="button">{countLoading ? "Считаем предложения…" : `Показать ${resultCount ?? "все"} объявлений`}</button> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function QuickButton({ icon: Icon, label, mobileLabel, onClick, open }: { icon?: typeof Search; label: string; mobileLabel?: string; onClick: () => void; open: boolean }) {
  return <button aria-expanded={open} className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition ${open ? "bg-[#111827] text-white" : "text-[#263247] hover:bg-[#f0f3f7]"}`} onClick={onClick} type="button">{Icon ? <Icon size={16} /> : null}<span className={mobileLabel ? "hidden sm:inline" : undefined}>{label}</span>{mobileLabel ? <span className="sm:hidden">{mobileLabel}</span> : null}<ChevronDown className={`transition ${open ? "rotate-180" : ""}`} size={15} /></button>;
}

function PanelHeader({ panel, onClose, onReset }: { panel: Exclude<PanelName, null>; onClose: () => void; onReset?: () => void }) {
  const titles = { parameters: "Параметры", brandModel: "Марка и модель", region: "Регион доставки", transport: "Тип транспорта", sort: "Сортировка" };
  return <div className="flex shrink-0 items-center justify-between border-b border-[#e5e9ef] px-4 py-3 sm:px-5"><button aria-label="Закрыть" className="rounded-full p-1 text-[#263247] hover:bg-[#f0f3f7]" onClick={onClose} type="button"><X size={20} /></button><h2 className="text-base font-semibold text-[#101827]">{titles[panel]}</h2>{onReset ? <button className="inline-flex items-center gap-1 text-sm font-medium text-[#68758a] hover:text-[#111827]" onClick={onReset} type="button"><RotateCcw size={15} /> Сбросить</button> : <span className="w-6" />}</div>;
}

function ParametersPanel({ parameters, setParameters, count, loading }: { parameters: ParameterState; setParameters: (value: ParameterState) => void; count: number | null; loading: boolean }) {
  const update = (key: keyof ParameterState, value: string) => setParameters({ ...parameters, [key]: value });
  return <div className="space-y-5"><div className="grid grid-cols-2 gap-3"><RangeInput label="Цена, ₽" min={parameters.priceMin} max={parameters.priceMax} onMin={(value) => update("priceMin", value)} onMax={(value) => update("priceMax", value)} /><RangeInput label="Год выпуска" min={parameters.yearMin} max={parameters.yearMax} onMin={(value) => update("yearMin", value)} onMax={(value) => update("yearMax", value)} /></div><Field label="Пробег до, км" value={parameters.mileageMax} onChange={(value) => update("mileageMax", value)} placeholder="Например, 80 000" /><Field label="Мощность до, л.с." value={parameters.powerMax} onChange={(value) => update("powerMax", value)} placeholder="Например, 160" /><div className="grid gap-3 sm:grid-cols-3"><SelectField label="Кузов" value={parameters.body} onChange={(value) => update("body", value)} options={[["", "Любой"], ["Седан", "Седан"], ["Хэтчбек", "Хэтчбек"], ["Кроссовер", "Кроссовер"], ["Универсал", "Универсал"], ["Минивэн", "Минивэн"]]} /><SelectField label="Топливо" value={parameters.fuel} onChange={(value) => update("fuel", value)} options={[["", "Любое"], ["gasoline", "Бензин"], ["diesel", "Дизель"], ["electric", "Электро"]]} /><SelectField label="КПП" value={parameters.transmission} onChange={(value) => update("transmission", value)} options={[["", "Любая"], ["automatic", "Автомат"], ["manual", "Механика"], ["cvt", "Вариатор"], ["dct", "Робот"]]} /></div><p className="text-xs text-[#68758a]">{loading ? "Обновляем количество предложений…" : count === null ? "Заполните параметры, чтобы увидеть количество предложений." : `${count.toLocaleString("ru-RU")} предложений`}</p></div>;
}

function BrandModelPanel({ brand, model, setBrand, setModel, onSubmit }: { brand: string; model: string; setBrand: (value: string) => void; setModel: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="space-y-4" onSubmit={onSubmit}><Field label="Марка" value={brand} onChange={setBrand} placeholder="Например, Kia" /><div className="flex flex-wrap gap-2">{popularBrands.map((item) => <button className={`rounded-full border px-3 py-2 text-sm ${brand === item ? "border-[#111827] bg-[#111827] text-white" : "border-[#dce2eb] text-[#263247]"}`} key={item} onClick={() => setBrand(item)} type="button">{item}</button>)}</div><Field label="Модель" value={model} onChange={setModel} placeholder="Например, K7" /><button className="h-11 w-full rounded-xl bg-[#111827] text-sm font-semibold text-white" type="submit">Показать объявления</button></form>;
}

function RegionPanel({ countryCode, cityId, onSelect }: { countryCode: CountryCode; cityId: string; onSelect: (countryCode: CountryCode, cityId?: string) => void }) {
  const activeCountry = countries.find((item) => item.countryCode === countryCode) ?? countries[0];
  return <div className="space-y-3"><p className="text-sm text-[#68758a]">Страна и город выбираются вручную. Геолокация не используется.</p>{countries.map((item) => <div key={item.countryCode}><button className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm font-semibold ${item.countryCode === countryCode ? "border-[#111827] bg-[#111827] text-white" : "border-[#dce2eb] text-[#263247]"}`} onClick={() => onSelect(item.countryCode)} type="button">{item.countryLabel}<ChevronRight size={17} /></button>{item.countryCode === activeCountry.countryCode ? <div className="mt-1 grid grid-cols-2 gap-1 pl-2">{activeCountry.cities.map((itemCity) => <button className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${itemCity.id === cityId ? "bg-[#f5f0e4] font-semibold text-[#5c4317]" : "text-[#68758a] hover:bg-[#f0f3f7]"}`} key={itemCity.id} onClick={() => onSelect(countryCode, itemCity.id)} type="button">{itemCity.label}{itemCity.id === cityId ? <Check size={15} /> : null}</button>)}</div> : null}</div>)}</div>;
}

function TransportPanel() {
  return <div className="grid gap-2"><Link className="rounded-xl bg-[#111827] px-4 py-3 text-sm font-semibold text-white" href="/catalog">Автомобили</Link><Link className="rounded-xl border border-[#dce2eb] px-4 py-3 text-sm font-semibold text-[#263247]" href="/catalog?category=motorcycle">Мототехника</Link><Link className="rounded-xl border border-[#dce2eb] px-4 py-3 text-sm font-semibold text-[#263247]" href="/catalog?category=jetski">Гидроциклы</Link></div>;
}

function SortPanel() {
  return <div className="grid gap-1">{sortOptions.map((option) => <Link className="rounded-xl px-3 py-3 text-sm font-medium text-[#263247] hover:bg-[#f0f3f7]" href={`/catalog?sort=${option.value}`} key={option.value}>{option.label}</Link>)}</div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><input className="h-11 w-full rounded-xl border border-[#d7dee8] px-3 text-sm text-[#101827] outline-none focus:border-[#956f2c] focus:ring-2 focus:ring-[#c7a55a]/20" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} /></label>;
}

function RangeInput({ label, min, max, onMin, onMax }: { label: string; min: string; max: string; onMin: (value: string) => void; onMax: (value: string) => void }) {
  return <div><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[#d7dee8]"><input className="h-11 min-w-0 border-r border-[#d7dee8] px-3 text-sm outline-none" onChange={(event) => onMin(event.target.value)} placeholder="От" value={min} /><input className="h-11 min-w-0 px-3 text-sm outline-none" onChange={(event) => onMax(event.target.value)} placeholder="До" value={max} /></div></div>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><select className="h-11 w-full rounded-xl border border-[#d7dee8] bg-white px-3 text-sm text-[#101827] outline-none focus:border-[#956f2c]" onChange={(event) => onChange(event.target.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
