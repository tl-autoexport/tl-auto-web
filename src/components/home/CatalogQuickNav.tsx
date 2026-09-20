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

export function CatalogQuickNav({ brands = [], models = [] }: { brands?: string[]; models?: Array<{ brand: string; model: string }> }) {
  const [panel, setPanel] = useState<PanelName>(null);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [parameters, setParameters] = useState<ParameterState>(emptyParameters);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const { country, city, setDestination } = useDestination();
  const parameterQuery = useMemo(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (value.trim()) query.set(key, value.trim());
    }
    return query;
  }, [parameters]);

  const activeQuery = useMemo(() => {
    const query = new URLSearchParams(parameterQuery);
    if (brand.trim()) query.set("brand", brand.trim());
    if (model.trim()) query.set("model", model.trim());
    return query;
  }, [brand, model, parameterQuery]);

  useEffect(() => {
    if (panel !== "parameters" && panel !== "brandModel") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCountLoading(true);
      try {
        const response = await fetch(`/api/catalog/count?${activeQuery.toString()}`, { signal: controller.signal });
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
  }, [activeQuery, panel]);

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

  const submitBrandModel = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const query = new URLSearchParams();
    if (brand.trim()) query.set("brand", brand.trim());
    if (model.trim()) query.set("model", model.trim());
    window.location.assign(`/catalog${query.toString() ? `?${query.toString()}` : ""}`);
  };

  const submitParameters = () => {
    window.location.assign(`/catalog${parameterQuery.toString() ? `?${parameterQuery.toString()}` : ""}`);
  };

  const resetParameters = () => {
    setBrand("");
    setModel("");
    setParameters(emptyParameters);
    setResultCount(null);
  };

  const resetBrandModel = () => {
    setBrand("");
    setModel("");
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
            <PanelHeader panel={panel} onClose={() => setPanel(null)} onReset={panel === "parameters" ? resetParameters : panel === "brandModel" ? resetBrandModel : undefined} />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-5">
              {panel === "parameters" ? <ParametersPanel brand={brand} model={model} onOpenBrandModel={() => setPanel("brandModel")} parameters={parameters} setParameters={setParameters} count={resultCount} loading={countLoading} /> : null}
              {panel === "brandModel" ? <BrandModelPanel brand={brand} brands={brands} model={model} models={models} setBrand={setBrand} setModel={setModel} /> : null}
              {panel === "region" ? <RegionPanel countryCode={country.countryCode} cityId={city.id} onSelect={selectDestination} /> : null}
              {panel === "transport" ? <TransportPanel /> : null}
              {panel === "sort" ? <SortPanel /> : null}
            </div>
            {panel === "parameters" || panel === "brandModel" ? <button className="m-4 mt-0 h-12 shrink-0 rounded-xl bg-[#111827] px-4 text-sm font-semibold text-white transition hover:bg-[#263247] disabled:opacity-60" disabled={countLoading || (panel === "brandModel" && !brand)} onClick={panel === "parameters" ? submitParameters : () => submitBrandModel()} type="button">{countLoading ? "Считаем предложения…" : `Показать ${resultCount ?? "все"} объявлений`}</button> : null}
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

function ParametersPanel({ brand, model, onOpenBrandModel, parameters, setParameters, count, loading }: { brand: string; model: string; onOpenBrandModel: () => void; parameters: ParameterState; setParameters: (value: ParameterState) => void; count: number | null; loading: boolean }) {
  const update = (key: keyof ParameterState, value: string) => setParameters({ ...parameters, [key]: value });
  return <div className="space-y-5"><section className="rounded-2xl border border-[#edf0f4] bg-white p-4"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Марка и модель</h3><button className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#956f2c]" onClick={onOpenBrandModel} type="button"><span className="grid size-5 place-items-center rounded-full border border-current text-base leading-none">+</span>{brand ? "Изменить" : "Добавить"}</button></div>{brand ? <div className="mt-3 grid gap-1 text-sm"><div className="flex items-center justify-between border-t border-[#edf0f4] pt-3"><span className="text-[#68758a]">Марка</span><span className="font-semibold text-[#101827]">{brand}</span></div>{model ? <div className="flex items-center justify-between border-t border-[#edf0f4] pt-3"><span className="text-[#68758a]">Модель</span><span className="font-semibold text-[#101827]">{model}</span></div> : null}</div> : <p className="mt-2 text-sm text-[#68758a]">Можно ограничить подбор конкретной маркой и моделью.</p>}</section><WheelRangeInput label="Цена, ₽" min={parameters.priceMin} max={parameters.priceMax} options={numberOptions("price")} onMin={(value) => update("priceMin", value)} onMax={(value) => update("priceMax", value)} /><WheelRangeInput label="Год выпуска" min={parameters.yearMin} max={parameters.yearMax} options={numberOptions("year")} onMin={(value) => update("yearMin", value)} onMax={(value) => update("yearMax", value)} /><WheelField label="Пробег до, км" value={parameters.mileageMax} options={numberOptions("mileage")} onChange={(value) => update("mileageMax", value)} /><WheelField label="Мощность до, л.с." value={parameters.powerMax} options={numberOptions("power")} onChange={(value) => update("powerMax", value)} /><div className="grid gap-3"><SelectField label="Кузов" value={parameters.body} onChange={(value) => update("body", value)} options={[["", "Любой"], ["Седан", "Седан"], ["Хэтчбек", "Хэтчбек"], ["Кроссовер", "Кроссовер"], ["Универсал", "Универсал"], ["Минивэн", "Минивэн"]]} /><SelectField label="Топливо" value={parameters.fuel} onChange={(value) => update("fuel", value)} options={[["", "Любое"], ["gasoline", "Бензин"], ["diesel", "Дизель"], ["electric", "Электро"]]} /><SelectField label="КПП" value={parameters.transmission} onChange={(value) => update("transmission", value)} options={[["", "Любая"], ["automatic", "Автомат"], ["manual", "Механика"], ["cvt", "Вариатор"], ["dct", "Робот"]]} /></div><p className="text-xs text-[#68758a]">{loading ? "Обновляем количество предложений…" : count === null ? "Заполните параметры, чтобы увидеть количество предложений." : `${count.toLocaleString("ru-RU")} предложений`}</p></div>;
}

function BrandModelPanel({ brand, brands, model, models, setBrand, setModel }: { brand: string; brands: string[]; model: string; models: Array<{ brand: string; model: string }>; setBrand: (value: string) => void; setModel: (value: string) => void }) {
  const availableBrands = [...new Set([...popularBrands, ...brands])];
  const availableModels = models.filter((item) => !brand || item.brand === brand).map((item) => item.model).filter((item, index, values) => values.indexOf(item) === index);
  const [step, setStep] = useState<"brand" | "model">(brand ? "model" : "brand");
  useEffect(() => {
    const onPopState = () => setStep("brand");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  if (step === "brand") return <div className="space-y-3"><h3 className="text-sm font-semibold text-[#101827]">Марка</h3><div className="grid max-h-[calc(100vh-210px)] gap-1 overflow-y-auto rounded-xl border border-[#dce2eb] bg-white">{availableBrands.map((item) => <button className={`flex min-h-12 items-center justify-between border-b border-[#edf0f4] px-4 text-left text-base last:border-b-0 ${brand === item ? "bg-[#f5f0e4] font-semibold text-[#5c4317]" : "text-[#263247]"}`} key={item} onClick={() => { setBrand(item); setModel(""); window.history.pushState({ filterStep: "model" }, ""); setStep("model"); }} type="button"><span className="min-w-0 flex-1">{item}</span><ChevronRight aria-hidden="true" className="text-[#a4adba]" size={19} /></button>)}</div></div>;
  return <div className="space-y-3"><h3 className="text-sm font-semibold text-[#101827]">Модель · {brand}</h3><div className="grid max-h-[calc(100vh-210px)] gap-1 overflow-y-auto rounded-xl border border-[#dce2eb] bg-white">{availableModels.length ? availableModels.map((item) => <button className={`flex min-h-12 items-center gap-3 border-b border-[#edf0f4] px-4 text-left text-base last:border-b-0 ${model === item ? "bg-[#f5f0e4] font-semibold text-[#5c4317]" : "text-[#263247]"}`} key={item} onClick={() => setModel(model === item ? "" : item)} type="button"><span className="min-w-0 flex-1">{item}</span><span aria-hidden="true" className={`grid size-6 place-items-center rounded-md border ${model === item ? "border-[#a98239] bg-[#a98239] text-white" : "border-[#b9c1cb] text-transparent"}`}><Check size={16} /></span></button>) : <p className="p-4 text-sm text-[#68758a]">Для этой марки нет доступных моделей.</p>}</div></div>;
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

function WheelRangeInput({ label, min, max, options, onMin, onMax }: { label: string; min: string; max: string; options: string[]; onMin: (value: string) => void; onMax: (value: string) => void }) {
  return <div><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><div className="grid grid-cols-2 gap-2"><WheelSelect value={min} options={options} placeholder="От" onChange={onMin} /><WheelSelect value={max} options={options} placeholder="До" onChange={onMax} /></div></div>;
}

function WheelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><WheelSelect value={value} options={options} placeholder="Не выбрано" onChange={onChange} /></div>;
}

function WheelSelect({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  return <select className="h-12 w-full appearance-none rounded-xl border border-[#d7dee8] bg-white px-3 text-[15px] text-[#273246]" onChange={(event) => onChange(event.target.value)} value={value}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option === "160" ? "160 л.с. — рекомендуем" : option}</option>)}</select>;
}

function numberOptions(kind: "price" | "year" | "mileage" | "power") {
  if (kind === "price") return Array.from({ length: 80 }, (_, index) => String((index + 1) * 250_000));
  if (kind === "year") return Array.from({ length: 37 }, (_, index) => String(new Date().getFullYear() - index));
  if (kind === "mileage") return Array.from({ length: 31 }, (_, index) => String(index * 10_000));
  return [...new Set(["160", ...Array.from({ length: 19 }, (_, index) => String(50 + index * 25))])].sort((a, b) => Number(a) - Number(b));
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#68758a]">{label}</span><select className="h-11 w-full rounded-xl border border-[#d7dee8] bg-white px-3 text-sm text-[#101827] outline-none focus:border-[#956f2c]" onChange={(event) => onChange(event.target.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
