"use client";

import Link from "next/link";
import { CatalogParameterFields } from "@/components/catalog/CatalogParameterFields";
import { GenerationCascade } from "@/app/catalog/GenerationCascade";
import type { IdentitySelection } from "@/app/catalog/CatalogFilterDraft";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";
import { createPortal } from "react-dom";
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

const countries = VISIBLE_DESTINATIONS;

type ParameterState = {
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMax: string;
  mileageMin: string;
  engineMin: string;
  engineMax: string;
  powerMin: string;
  powerMax: string;
  body: string;
  fuel: string;
  transmission: string;
  drive: string;
};

const emptyParameters: ParameterState = {
  priceMin: "",
  priceMax: "",
  yearMin: "",
  yearMax: "",
  mileageMax: "",
  mileageMin: "",
  engineMin: "",
  engineMax: "",
  powerMin: "",
  powerMax: "",
  body: "",
  fuel: "",
  transmission: "",
  drive: "",
};

export function CatalogQuickNav({ bodies = [], transmissions = [] }: { brands?: string[]; models?: Array<{ brand: string; model: string }>; bodies?: string[]; transmissions?: string[] }) {
  const [panel, setPanel] = useState<PanelName>(null);
  const [cascadePicking, setCascadePicking] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ dialogRef, open: Boolean(panel), onClose: () => setPanel(null) });
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [resetIdentity, setResetIdentity] = useState(0);
  const [extraIdentity, setExtraIdentity] = useState<IdentitySelection>({});
  const [parameters, setParameters] = useState<ParameterState>(emptyParameters);
  const [countQuery, setCountQuery] = useState<string|null>(null);
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
    for (const key of ["generation", "modification", "trim"] as const) if (extraIdentity[key]) query.set(key,extraIdentity[key]!);
    return query;
  }, [brand, model, extraIdentity, parameterQuery]);

  useEffect(() => {
    if (panel !== "parameters" && panel !== "brandModel") return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const timer = window.setTimeout(async () => {
      setCountLoading(true);
      try {
        const response = await fetch(`/api/catalog/count?${activeQuery.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Count returned ${response.status}`);
        if (active) {
          const payload = await response.json() as { count?: number };
          setResultCount(typeof payload.count === "number" ? payload.count : null);
          setCountQuery(activeQuery.toString());
        }
      } catch {
        if (active) { setResultCount(null); setCountQuery(activeQuery.toString()); }
      } finally {
        window.clearTimeout(timeout);
        if (active) setCountLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeQuery, panel]);

  const submitSearch = (event: FormEvent<HTMLFormElement>, nextSearch = search) => {
    event.preventDefault();
    const value = nextSearch.trim();
    const key = /^\d+$/.test(value) ? "number" : "search";
    window.location.assign(value ? `/catalog?${key}=${encodeURIComponent(value)}` : "/catalog");
  };

  const submitBrandModel = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    window.location.assign(`/catalog${activeQuery.toString() ? `?${activeQuery.toString()}` : ""}`);
  };

  const submitParameters = () => submitBrandModel();

  const resetParameters = () => {
    setResetIdentity(value => value + 1);
    setBrand("");
    setModel("");
    setExtraIdentity({});
    setParameters(emptyParameters);
    setResultCount(null);
  };

  const resetBrandModel = () => {
    setResetIdentity(value => value + 1);
    setBrand("");
    setModel("");
    setExtraIdentity({});
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

      {panel && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[130] bg-[#101827]/25 p-0 sm:flex sm:items-start sm:justify-center sm:p-4 sm:pt-[132px]">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={panel === "brandModel" ? "Марка и модель" : "Параметры"} className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#f4f6f9] pt-[env(safe-area-inset-top)] shadow-[0_18px_45px_rgba(16,24,39,0.18)] sm:h-auto sm:max-h-[calc(100dvh-148px)] sm:w-[min(560px,calc(100vw-32px))] sm:rounded-3xl sm:border sm:border-[#dce2eb]">
            <PanelHeader panel={panel} onClose={() => setPanel(null)} onReset={panel === "parameters" ? resetParameters : panel === "brandModel" ? resetBrandModel : undefined} />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-5">
              {panel === "parameters" || panel === "brandModel" ? <GenerationCascade onPickerOpenChange={setCascadePicking} key={resetIdentity} currentQuery={activeQuery.toString()} totalCars={resultCount??0} brand={brand} model={model} generation={extraIdentity.generation} modification={extraIdentity.modification} trim={extraIdentity.trim} onSelection={(next)=>{setBrand(next.brand??"");setModel(next.model??"");setExtraIdentity(next);}} /> : null}
              {panel === "parameters" && !cascadePicking ? <CatalogParameterFields values={parameters} bodies={bodies} transmissions={transmissions} onChange={(name, value) => setParameters(previous => ({ ...previous, [name]: value }))} /> : null}
              {panel === "region" ? <RegionPanel countryCode={country.countryCode} cityId={city.id} onSelect={selectDestination} /> : null}
              {panel === "transport" ? <TransportPanel /> : null}
              {panel === "sort" ? <SortPanel /> : null}
            </div>
            {panel === "parameters" || panel === "brandModel" ? <button className="m-4 mt-0 mb-[max(1rem,env(safe-area-inset-bottom))] min-h-14 shrink-0 rounded-2xl bg-[#111827] px-4 text-sm font-semibold text-white transition hover:bg-[#263247] disabled:opacity-60" disabled={countLoading || countQuery!==activeQuery.toString()} onClick={panel === "parameters" ? submitParameters : () => submitBrandModel()} type="button">{countLoading || countQuery!==activeQuery.toString() ? "Считаем предложения…" : resultCount === null ? "Показать автомобили" : `Показать ${resultCount} объявлений`}</button> : null}
          </div>
        </div>, document.body
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

