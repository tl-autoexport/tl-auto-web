"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  ChevronDown,
  ListFilter,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useDestination } from "@/components/site/DestinationProvider";
import { DESTINATIONS, type CountryCode } from "@/lib/destinations";

type MenuName = "filters" | "country" | "transport" | "sort" | null;

const sortOptions = [
  { value: "fresh", label: "Сначала свежие" },
  { value: "price_asc", label: "Цена: ниже" },
  { value: "price_desc", label: "Цена: выше" },
  { value: "year_desc", label: "Год: новее" },
  { value: "mileage_asc", label: "Пробег: меньше" },
] as const;

export function CatalogQuickNav() {
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [search, setSearch] = useState("");
  const { country, city, setDestination } = useDestination();

  const toggleMenu = (menu: Exclude<MenuName, null>) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = search.trim();
    if (!value) {
      window.location.assign("/catalog");
      return;
    }
    const key = /^\d+$/.test(value) ? "number" : "model";
    window.location.assign(`/catalog?${key}=${encodeURIComponent(value)}`);
  };

  return (
    <nav
      aria-label="Быстрый подбор автомобиля"
      className="sticky top-[68px] z-40 isolate border-b border-[#dce2eb] bg-white/95 shadow-[0_5px_12px_rgba(15,31,49,0.06)] backdrop-blur sm:top-[74px] lg:top-[76px]"
    >
      <div className="mx-auto max-w-7xl px-4 py-2.5 sm:px-5">
        <div className="scrollbar-none flex items-center gap-2 overflow-x-auto">
          <form className="relative hidden shrink-0 md:block" onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#69768a]" size={16} />
            <input
              aria-label="Поиск по модели или номеру лота"
              className="h-10 w-[218px] rounded-full border border-[#d7dee8] bg-white py-2 pl-9 pr-3 text-sm text-[#101827] outline-none transition placeholder:text-[#7a8798] focus:border-[#956f2c] focus:ring-2 focus:ring-[#c7a55a]/20"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск"
              value={search}
            />
          </form>

          <QuickButton icon={Search} label="Поиск" mobileOnly onClick={() => toggleMenu("filters")} open={openMenu === "filters"} />
          <QuickButton icon={SlidersHorizontal} label="Параметры" onClick={() => toggleMenu("filters")} open={openMenu === "filters"} />
          <QuickButton label={city.label} onClick={() => toggleMenu("country")} open={openMenu === "country"} />
          <QuickButton label="Авто" onClick={() => toggleMenu("transport")} open={openMenu === "transport"} />
          <QuickButton icon={ListFilter} label="Сортировка" onClick={() => toggleMenu("sort")} open={openMenu === "sort"} />
        </div>

        {openMenu ? (
          <div className="relative">
            <div className="mt-2 rounded-2xl border border-[#dce2eb] bg-white p-4 shadow-[0_12px_30px_rgba(16,24,39,0.12)] sm:absolute sm:left-0 sm:top-0 sm:min-w-[360px]" role="dialog" aria-label="Настройки каталога">
              <button aria-label="Закрыть" className="absolute right-3 top-3 rounded-full p-1 text-[#647084] hover:bg-[#f0f3f7]" onClick={() => setOpenMenu(null)} type="button"><X size={17} /></button>
              {openMenu === "filters" ? <FilterPanel onSearch={submitSearch} search={search} setSearch={setSearch} /> : null}
              {openMenu === "country" ? <CountryPanel countryCode={country.countryCode} cityId={city.id} onSelect={setDestination} /> : null}
              {openMenu === "transport" ? <TransportPanel /> : null}
              {openMenu === "sort" ? <SortPanel /> : null}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function QuickButton({ icon: Icon, label, mobileOnly = false, onClick, open }: { icon?: typeof Search; label: string; mobileOnly?: boolean; onClick: () => void; open: boolean }) {
  return <button aria-expanded={open} className={`${mobileOnly ? "md:hidden" : ""} inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition ${open ? "bg-[#111827] text-white" : "text-[#263247] hover:bg-[#f0f3f7]"}`} onClick={onClick} type="button">{Icon ? <Icon size={16} /> : null}{label}{!mobileOnly ? <ChevronDown className={`transition ${open ? "rotate-180" : ""}`} size={15} /> : null}</button>;
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="pr-8 text-sm font-semibold text-[#101827]">{children}</h2>;
}

function FilterPanel({ onSearch, search, setSearch }: { onSearch: (event: FormEvent<HTMLFormElement>) => void; search: string; setSearch: (value: string) => void }) {
  return <div><PanelTitle>Поиск и параметры</PanelTitle><form className="mt-3" onSubmit={onSearch}><label className="sr-only" htmlFor="catalog-search">Марка, модель или номер лота</label><div className="flex gap-2"><input className="h-10 min-w-0 flex-1 rounded-md border border-[#d7dee8] px-3 text-sm outline-none focus:border-[#956f2c]" id="catalog-search" onChange={(event) => setSearch(event.target.value)} placeholder="Модель или номер лота" value={search} /><button className="rounded-md bg-[#111827] px-4 text-sm font-semibold text-white" type="submit">Найти</button></div></form><div className="mt-4 grid grid-cols-2 gap-2"><Link className="rounded-md border border-[#dce2eb] px-3 py-2.5 text-sm font-medium text-[#263247] hover:border-[#956f2c]" href="/catalog#filters">Марка и модель</Link><Link className="rounded-md border border-[#dce2eb] px-3 py-2.5 text-sm font-medium text-[#263247] hover:border-[#956f2c]" href="/catalog#filters">Год и цена</Link><Link className="rounded-md border border-[#dce2eb] px-3 py-2.5 text-sm font-medium text-[#263247] hover:border-[#956f2c]" href="/catalog#filters">Пробег и КПП</Link><Link className="rounded-md border border-[#dce2eb] px-3 py-2.5 text-sm font-medium text-[#263247] hover:border-[#956f2c]" href="/catalog#filters">Все параметры</Link></div></div>;
}

function CountryPanel({ countryCode, cityId, onSelect }: { countryCode: CountryCode; cityId: string; onSelect: (countryCode: CountryCode, cityId?: string) => void }) {
  const country = DESTINATIONS.find((item) => item.countryCode === countryCode) ?? DESTINATIONS[0];
  return <div><PanelTitle>Страна и город доставки</PanelTitle><p className="mt-2 text-sm leading-5 text-[#647084]">Выбор выполняется вручную, геолокация не используется.</p><div className="mt-3 grid gap-2">{DESTINATIONS.map((item) => <div key={item.countryCode}><button className={`w-full rounded-md px-3 py-2.5 text-left text-sm font-semibold ${item.countryCode === countryCode ? "bg-[#111827] text-white" : "border border-[#dce2eb] text-[#263247]"}`} onClick={() => onSelect(item.countryCode)} type="button">{item.countryLabel}</button>{item.countryCode === countryCode ? <div className="mt-1 grid grid-cols-2 gap-1 pl-2">{country.cities.map((itemCity) => <button className={`rounded-md px-2 py-2 text-left text-xs ${itemCity.id === cityId ? "bg-[#f5f0e4] font-semibold text-[#5c4317]" : "text-[#647084] hover:bg-[#f0f3f7]"}`} key={itemCity.id} onClick={() => onSelect(countryCode, itemCity.id)} type="button">{itemCity.label}</button>)}</div> : null}</div>)}</div></div>;
}

function TransportPanel() {
  return <div><PanelTitle>Тип транспорта</PanelTitle><div className="mt-3 grid gap-2"><Link className="rounded-md bg-[#111827] px-3 py-3 text-sm font-semibold text-white" href="/catalog">Автомобили</Link><Link className="rounded-md border border-[#dce2eb] px-3 py-3 text-sm font-semibold text-[#263247] hover:border-[#956f2c]" href="/catalog?category=motorcycle">Мототехника</Link><Link className="rounded-md border border-[#dce2eb] px-3 py-3 text-sm font-semibold text-[#263247] hover:border-[#956f2c]" href="/catalog?category=jetski">Гидроциклы</Link></div></div>;
}

function SortPanel() {
  return <div><PanelTitle>Сортировка</PanelTitle><div className="mt-3 grid gap-1">{sortOptions.map((option) => <Link className="rounded-md px-3 py-2.5 text-sm font-medium text-[#263247] transition hover:bg-[#f0f3f7]" href={`/catalog?sort=${option.value}`} key={option.value}>{option.label}</Link>)}</div></div>;
}
