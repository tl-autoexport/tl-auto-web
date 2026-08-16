import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Camera,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Gauge,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  getCatalogCars,
  getCatalogCount,
  getCatalogFacetCars,
  getPrimaryPhoto,
  type CatalogCar,
  type CatalogFilters,
} from "@/server/cars/repository";
import { carDisplayTitle, translateFuel, translateTransmission } from "@/server/normalization/display";
import { SiteHeader } from "@/components/site/SiteHeader";
import { RemoteImage } from "@/components/site/RemoteImage";
import { officialSourceUrl, sourceDisplayName } from "@/lib/source-url";
import { MobileCatalogFilters } from "./MobileCatalogFilters";

const rub = new Intl.NumberFormat("ru-RU");
const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const pageSize = 24;

export const metadata: Metadata = {
  title: "Каталог автомобилей из Кореи",
  description:
    "Актуальные автомобили Encar с фотографиями, характеристиками, историей и расчётом стоимости до Владивостока.",
  alternates: {
    canonical: "/catalog",
  },
  openGraph: {
    title: "Каталог автомобилей из Кореи",
    description:
      "Подберите автомобиль по реальным данным Encar и посмотрите расчёт стоимости для России.",
    url: "/catalog",
    images: [
      {
        url: "/opengraph-image",
        alt: "TL Auto — каталог автомобилей из Кореи",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Каталог автомобилей из Кореи",
    description:
      "Реальные объявления Encar с расчётом стоимости до Владивостока.",
    images: ["/opengraph-image"],
  },
};

type CatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const sortLabels = {
  fresh: "Сначала свежие объявления",
  price_asc: "Цена: ниже",
  price_desc: "Цена: выше",
  mileage_asc: "Пробег: меньше",
  year_desc: "Год: новее",
} as const;

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const rawParams = await searchParams;
  const value = (name: string) => typeof rawParams[name] === "string" ? rawParams[name] : "";
  const shelf = value("shelf");
  const under160 = value("under160") === "1" || shelf === "under-160";
  const passable = value("passable") === "1" || shelf === "passable";
  const sortValue = value("sort");
  const sort = isSort(sortValue) ? sortValue : "fresh";
  const requestedPage = positiveInteger(value("page")) ?? 1;

  const filters: CatalogFilters = {
    brand: value("brand") || undefined,
    model: value("model") || undefined,
    fuelType: value("fuel") || undefined,
    transmission: value("transmission") || undefined,
    minEngineCc: numberParam(value("engineMin")),
    maxEngineCc: numberParam(value("engineMax")),
    minYear: numberParam(value("yearMin")),
    maxYear: numberParam(value("yearMax")),
    maxMileageKm: numberParam(value("mileageMax")),
    minPriceRub: numberParam(value("priceMin")),
    maxPriceRub: numberParam(value("priceMax")),
    maxPowerHp: under160 ? 160 : numberParam(value("powerMax")),
    noAccidents: value("clean") === "1",
    passable,
    sourceId: value("number") || undefined,
    sort,
  };

  const [totalCars, optionCars] = await Promise.all([
    getCatalogCount(filters),
    getCatalogFacetCars(),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCars / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const shownCars = await getCatalogCars({
    ...filters,
    limit: pageSize,
    offset: (currentPage - 1) * pageSize,
  });
  const brands = unique(optionCars.map((car) => car.brand));
  const models = unique(optionCars.filter((car) => !filters.brand || car.brand === filters.brand).map((car) => car.model));
  const fuels = unique(optionCars.map((car) => car.fuel_type));
  const transmissions = unique(optionCars.map((car) => transmissionFilterValue(car.transmission)));
  const popularBrands = brands.slice(0, 7);
  const activeCount = catalogActiveFilterCount(rawParams);
  const currentQuery = catalogQueryString(rawParams);
  const activeChips = buildActiveFilterChips(rawParams);
  const filterFormProps = {
    brands,
    models,
    fuels,
    transmissions,
    under160,
    passable,
    clean: value("clean") === "1",
    sort,
    totalCars,
    value,
  };

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <SiteHeader />

      <section className="border-b border-[#dce2eb] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-5 md:py-10">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end md:gap-5">
            <div>
              <p className="text-xs font-semibold text-[#956f2c] sm:text-sm">Корея</p>
              <h1 className="mt-1.5 text-[32px] font-semibold leading-tight tracking-normal sm:mt-2 sm:text-4xl">Каталог автомобилей</h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#647084] sm:mt-3 sm:text-sm sm:leading-6">Подбор по реальным данным источника с расчётом цены до Владивостока.</p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-[#fbf7ed] px-3 py-2 text-xs text-[#7b5a22] md:gap-3 md:rounded-none md:border-l-2 md:border-[#c7a55a] md:bg-transparent md:pl-4 md:text-sm"><CarFront size={18} className="text-[#c7a55a] md:size-5" /><span><strong className="mr-1 text-base text-[#101827] md:block md:text-xl">{totalCars}</strong><span className="text-[#647084]">автомобилей найдено</span></span></div>
          </div>

          {popularBrands.length ? (
            <div className="scrollbar-none mt-5 flex items-center gap-2 overflow-x-auto border-t border-[#edf0f4] pt-4 sm:mt-8 sm:flex-wrap sm:gap-x-3 sm:gap-y-3 sm:pt-5">
              <span className="shrink-0 text-xs text-[#7a8798] sm:text-sm">Марки</span>
              {popularBrands.map((brand) => {
                const selected = filters.brand === brand;
                return (
                  <Link
                    aria-current={selected ? "page" : undefined}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition sm:text-sm ${
                      selected
                        ? "border-[#c7a55a] bg-[#c7a55a] text-[#15130f]"
                        : "border-[#dce2eb] bg-white text-[#273246] hover:border-[#956f2c] hover:text-[#956f2c]"
                    }`}
                    href={selected
                      ? catalogFilterHref(rawParams, { brand: null, model: null, page: null })
                      : catalogFilterHref(rawParams, { brand, model: null, page: null })}
                    key={brand}
                  >
                    {selected ? <Check size={14} strokeWidth={3} /> : null}
                    {brand}
                    {selected ? <span aria-hidden="true">×</span> : null}
                  </Link>
                );
              })}
              <Link href="#filters" className="inline-flex min-h-9 shrink-0 items-center gap-1 px-2 text-xs font-semibold text-[#956f2c] sm:text-sm">Все фильтры <ChevronRight size={15} /></Link>
            </div>
          ) : null}
        </div>
      </section>

      <section id="filters" className="mx-auto max-w-7xl px-3 py-4 sm:px-5 md:py-7">
        <div className="md:hidden">
          <MobileCatalogFilters
            activeCount={activeCount}
            currentQuery={currentQuery}
            sort={sort}
            sortOptions={Object.entries(sortLabels).map(([optionValue, label]) => ({ value: optionValue, label }))}
            totalCars={totalCars}
          >
            <CatalogFilterForm {...filterFormProps} mobile />
          </MobileCatalogFilters>
        </div>
        <div className="hidden md:block">
          <CatalogFilterForm {...filterFormProps} />
        </div>
      </section>

      <section id="catalog-results" className="mx-auto max-w-7xl scroll-mt-4 px-3 pb-12 sm:px-5">
        {activeChips.length ? (
          <div className="scrollbar-none mb-4 flex gap-2 overflow-x-auto">
            {activeChips.map((chip) => (
              <Link className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#101827] px-3 text-xs font-semibold text-white" href={chip.href} key={`${chip.key}-${chip.label}`}>
                {chip.label}
                <span aria-hidden="true" className="text-white/60">×</span>
              </Link>
            ))}
            <Link className="inline-flex min-h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold text-[#647084]" href="/catalog"><RotateCcw size={14} /> Сбросить все</Link>
          </div>
        ) : null}
        <div className="mb-5 flex flex-col gap-3 border-b border-[#dce2eb] pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm text-[#647084]"><SlidersHorizontal size={17} /><span>{shownCars.length ? `Показано ${((currentPage - 1) * pageSize) + 1}–${Math.min(currentPage * pageSize, totalCars)} из ${totalCars}` : "Ничего не найдено"}</span></div>
          <p className="inline-flex items-center gap-2 text-sm font-medium text-[#3f4b5e]"><ChevronDown size={16} /> {sortLabels[sort]}</p>
        </div>

        {shownCars.length ? <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shownCars.map((car, index) => <CatalogCard key={car.id} car={car} highPriority={index === 0} />)}</div>
          {totalPages > 1 ? <Pagination currentPage={currentPage} rawParams={rawParams} totalPages={totalPages} /> : null}
        </> : <EmptyState />}
      </section>
    </main>
  );
}

type CatalogFilterFormProps = {
  brands: string[];
  models: string[];
  fuels: string[];
  transmissions: string[];
  under160: boolean;
  passable: boolean;
  clean: boolean;
  sort: keyof typeof sortLabels;
  totalCars: number;
  value: (name: string) => string;
  mobile?: boolean;
};

function CatalogFilterForm({
  brands,
  clean,
  fuels,
  mobile = false,
  models,
  passable,
  sort,
  totalCars,
  transmissions,
  under160,
  value,
}: CatalogFilterFormProps) {
  const mainFields = (
    <>
      <FilterSelect label="Марка" name="brand" options={brands} placeholder="Все марки" value={value("brand")} />
      <FilterSelect label="Модель" name="model" options={models} placeholder="Все модели" value={value("model")} />
      <RangeField label="Год выпуска" maxName="yearMax" maxValue={value("yearMax")} minName="yearMin" minValue={value("yearMin")} />
      <RangeField label="Цена до Владивостока, ₽" maxName="priceMax" maxValue={value("priceMax")} minName="priceMin" minValue={value("priceMin")} />
      <FilterInput label="Номер лота" name="number" placeholder="42308829 или JlVOBVyE" value={value("number")} />
    </>
  );

  const additionalFields = (
    <>
      <FilterSelect label="Топливо" name="fuel" options={fuels} placeholder="Любое" translate={translateFuel} value={value("fuel")} />
      <FilterSelect label="КПП" name="transmission" options={transmissions} placeholder="Любая" translate={translateTransmission} value={value("transmission")} />
      <RangeField label="Объём двигателя, см3" maxName="engineMax" maxValue={value("engineMax")} minName="engineMin" minValue={value("engineMin")} />
      <FilterInput inputMode="numeric" label="Пробег до, км" name="mileageMax" placeholder="Например, 80 000" value={value("mileageMax")} />
      <FilterInput inputMode="numeric" label="Мощность до, л.с." name="powerMax" placeholder="Например, 160" value={value("powerMax")} />
    </>
  );

  return (
    <form action="/catalog" className={mobile ? "min-h-full bg-[#f4f6f9] pb-24" : "rounded-md border border-[#dce2eb] bg-white p-5 shadow-sm"}>
      {mobile ? <input name="sort" type="hidden" value={sort} /> : null}
      <div className={mobile ? "grid gap-4 p-4" : "grid gap-4 md:grid-cols-2 xl:grid-cols-4"}>
        {!mobile ? (
          <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
            <Filter className="text-[#956f2c]" size={20} />
            <div>
              <h2 className="font-semibold">Подбор автомобиля</h2>
              <p className="text-xs text-[#7a8798]">Параметры сохраняются в ссылке</p>
            </div>
            <Link className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[#647084]" href="/catalog"><RotateCcw size={16} /> Сбросить</Link>
          </div>
        ) : null}
        {mainFields}
        {mobile ? (
          <details className="group border-t border-[#dce2eb] pt-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#273246] [&::-webkit-details-marker]:hidden">
              Дополнительные параметры
              <ChevronDown className="transition group-open:rotate-180" size={18} />
            </summary>
            <div className="grid gap-4 pb-2 pt-3">{additionalFields}</div>
          </details>
        ) : additionalFields}
        <div className={mobile ? "grid grid-cols-2 gap-2 border-t border-[#dce2eb] pt-4" : "flex flex-wrap gap-x-5 gap-y-3 md:col-span-2 xl:col-span-4"}>
          <FilterCheck checked={under160} label="До 160 л.с." name="under160" value="1" />
          <FilterCheck checked={passable} label="Проходные 3–5 лет" name="passable" value="1" />
          <FilterCheck checked={clean} label="Без страховых случаев" name="clean" value="1" />
        </div>
        {!mobile ? (
          <div className="flex items-end gap-3 md:col-span-2 xl:col-span-4">
            <label className="grid min-w-64 gap-1.5 text-sm text-[#647084]">
              <span>Сортировка</span>
              <span className="relative">
                <select className="h-11 w-full appearance-none rounded-md border border-[#d7dee8] bg-white px-3 pr-9 text-sm font-medium text-[#273246]" defaultValue={sort} name="sort">
                  {Object.entries(sortLabels).map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3 text-[#647084]" size={17} />
              </span>
            </label>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#c7a55a] px-6 text-sm font-semibold text-[#15130f]" type="submit"><Search size={17} /> Показать {totalCars}</button>
          </div>
        ) : null}
      </div>
      {mobile ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#dce2eb] bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(16,24,39,0.08)]">
          <button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7a55a] text-sm font-semibold text-[#15130f]" type="submit"><Search size={17} /> Показать {totalCars} автомобилей</button>
        </div>
      ) : null}
    </form>
  );
}

function CatalogCard({ car, highPriority }: { car: CatalogCar; highPriority: boolean }) {
  const photo = getPrimaryPhoto(car);
  const detailsHref = `/cars/${car.primary_source}/${car.source_id}`;
  const officialUrl = officialSourceUrl(car.source_url, car.primary_source);
  const sourceName = sourceDisplayName(car.primary_source);

  return (
    <article className="group overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-[#d8dde6] transition hover:-translate-y-0.5 hover:shadow-md">
      <Link className="block" href={detailsHref}>
        <div className="relative aspect-[4/3] bg-[#dfe4ec]">
          {photo ? <RemoteImage alt={carDisplayTitle(car)} className="object-cover" fetchPriority={highPriority ? "high" : undefined} fill loading={highPriority ? "eager" : undefined} sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" src={photo} fallback={<Camera size={32} />} /> : <div className="flex h-full items-center justify-center text-[#647084]"><Camera size={32} /></div>}
          <div className="absolute left-3 top-3 flex gap-2"><span className="rounded-sm bg-white px-2 py-1 text-xs font-semibold">Корея</span><span className="rounded-sm bg-[#177d69] px-2 py-1 text-xs font-semibold text-white">{sourceName}</span></div>
        </div>
      </Link>
      <div className="p-4">
        <Link href={detailsHref}><h2 className="line-clamp-2 text-lg font-semibold transition group-hover:text-[#956f2c]">{carDisplayTitle(car)}</h2></Link>
        <p className="mt-2 text-sm text-[#647084]">{car.year ?? "-"} год · {rub.format(car.mileage_km ?? 0)} км · {translateFuel(car.fuel_type)}</p>
        <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-xs text-[#647084]">до Владивостока</p><p className="whitespace-nowrap text-xl font-semibold">{rub.format(car.price_rub ?? 0)} ₽</p></div><div className="flex items-center gap-1 text-sm text-[#647084]"><Gauge size={16} />{car.power_hp ?? "-"} л.с.</div></div>
        <div className="mt-4 flex items-center justify-between border-t border-[#edf0f4] pt-3 text-xs font-medium text-[#647084]"><span className="inline-flex items-center gap-1"><ShieldCheck size={14} className="text-[#a98239]" /> Расчёт РФ</span><span>{formatUpdate(car.source_updated_at)}</span></div>
        <div className="mt-2 flex min-h-8 items-center justify-between gap-3 border-t border-[#edf0f4] pt-2 text-xs">
          <span className="truncate text-[#7a8798]">Лот {car.source_id}</span>
          {officialUrl ? <a className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#956f2c] hover:underline" href={officialUrl} rel="noopener noreferrer" target="_blank">На {sourceName}<ExternalLink size={13} /></a> : null}
        </div>
      </div>
    </article>
  );
}

function FilterSelect({ label, name, options, placeholder, translate, value }: { label: string; name: string; options: string[]; placeholder: string; translate?: (item: string) => string; value: string }) {
  const active = Boolean(value);
  return <label className="grid gap-1.5 text-sm text-[#647084]"><span>{label}</span><span className="relative"><select className={`h-11 w-full appearance-none rounded-md border px-3 pr-9 text-sm font-medium outline-none transition ${active ? "border-[#c7a55a] bg-[#fbf7ed] text-[#7b5a22]" : "border-[#d7dee8] bg-white text-[#273246]"} focus:border-[#101827]`} defaultValue={value} name={name}><option value="">{placeholder}</option>{options.map((item) => <option key={item} value={item}>{translate ? translate(item) : item}</option>)}</select>{active ? <Check className="pointer-events-none absolute right-8 top-3 text-[#c7a55a]" size={17} /> : null}<ChevronDown className="pointer-events-none absolute right-3 top-3 text-[#647084]" size={17} /></span></label>;
}

function FilterInput({ inputMode = "text", label, name, placeholder, value }: { inputMode?: "numeric" | "text"; label: string; name: string; placeholder: string; value: string }) {
  return <label className="grid gap-1.5 text-sm text-[#647084]"><span>{label}</span><input className={`h-11 w-full rounded-md border px-3 text-sm font-medium text-[#273246] outline-none placeholder:text-[#a7b0bd] ${value ? "border-[#c7a55a] bg-[#fbf7ed]" : "border-[#d7dee8] bg-white"} focus:border-[#101827]`} defaultValue={value} inputMode={inputMode} name={name} placeholder={placeholder} /></label>;
}

function RangeField({ label, maxName, maxValue, minName, minValue }: { label: string; maxName: string; maxValue: string; minName: string; minValue: string }) {
  const active = Boolean(minValue || maxValue);
  return <fieldset className="grid gap-1.5"><legend className="text-sm text-[#647084]">{label}</legend><div className={`grid grid-cols-2 overflow-hidden rounded-md border ${active ? "border-[#c7a55a] bg-[#fbf7ed]" : "border-[#d7dee8] bg-white"}`}><input aria-label={`${label}: от`} className="h-11 min-w-0 border-r border-[#d7dee8] bg-transparent px-3 text-sm font-medium outline-none placeholder:text-[#a7b0bd]" defaultValue={minValue} inputMode="numeric" name={minName} placeholder="от" /><input aria-label={`${label}: до`} className="h-11 min-w-0 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-[#a7b0bd]" defaultValue={maxValue} inputMode="numeric" name={maxName} placeholder="до" /></div></fieldset>;
}

function FilterCheck({ checked, label, name, value }: { checked: boolean; label: string; name: string; value: string }) {
  return <label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 text-center text-xs font-semibold transition md:min-h-0 md:justify-start md:border-0 md:px-0 md:text-sm ${checked ? "border-[#c7a55a] bg-[#fbf7ed] text-[#7b5a22]" : "border-[#d7dee8] bg-white text-[#3f4b5e]"}`}><input className="size-4 shrink-0 accent-[#c7a55a]" defaultChecked={checked} name={name} type="checkbox" value={value} />{label}</label>;
}

function EmptyState() {
  return <div className="border border-dashed border-[#c7d0dc] bg-white p-8 text-center"><Search className="mx-auto text-[#956f2c]" size={28} /><h2 className="mt-4 text-xl font-semibold">Нет подходящих автомобилей</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#647084]">Снимите часть ограничений или сбросьте фильтры, чтобы увидеть доступные предложения.</p><Link href="/catalog" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#956f2c]">Сбросить фильтры <ArrowRight size={16} /></Link></div>;
}

function Pagination({ currentPage, rawParams, totalPages }: { currentPage: number; rawParams: Record<string, string | string[] | undefined>; totalPages: number }) {
  const pages = paginationPages(currentPage, totalPages);
  return <nav aria-label="Страницы каталога" className="mt-8 flex flex-wrap items-center justify-center gap-2">
    <PaginationLink disabled={currentPage === 1} href={catalogPageHref(rawParams, currentPage - 1)} label="Назад"><ChevronLeft size={17} /></PaginationLink>
    {pages.map((page, index) => page === null
      ? <span key={`ellipsis-${index}`} className="px-2 text-[#7a8798]">…</span>
      : <Link key={page} aria-current={page === currentPage ? "page" : undefined} className={`inline-flex size-10 items-center justify-center rounded-md border text-sm font-semibold transition ${page === currentPage ? "border-[#c7a55a] bg-[#c7a55a] text-[#15130f]" : "border-[#d7dee8] bg-white text-[#273246] hover:border-[#c7a55a] hover:text-[#956f2c]"}`} href={catalogPageHref(rawParams, page)} scroll>{page}</Link>)}
    <PaginationLink disabled={currentPage === totalPages} href={catalogPageHref(rawParams, currentPage + 1)} label="Вперёд"><ChevronRight size={17} /></PaginationLink>
  </nav>;
}

function PaginationLink({ children, disabled, href, label }: { children: React.ReactNode; disabled: boolean; href: string; label: string }) {
  if (disabled) return <span aria-disabled="true" className="inline-flex h-10 items-center gap-1 rounded-md border border-[#e3e7ed] bg-[#f0f2f5] px-3 text-sm font-semibold text-[#a0a9b6]">{children}<span className="hidden sm:inline">{label}</span></span>;
  return <Link aria-label={label} className="inline-flex h-10 items-center gap-1 rounded-md border border-[#d7dee8] bg-white px-3 text-sm font-semibold text-[#273246] transition hover:border-[#c7a55a] hover:text-[#c7a55a]" href={href} scroll>{children}<span className="hidden sm:inline">{label}</span></Link>;
}

function catalogQueryString(rawParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(rawParams)) {
    if (typeof rawValue === "string" && rawValue) params.set(key, rawValue);
    if (Array.isArray(rawValue)) rawValue.filter(Boolean).forEach((item) => params.append(key, item));
  }
  return params.toString();
}

function catalogFilterHref(
  rawParams: Record<string, string | string[] | undefined>,
  updates: Record<string, string | null>,
) {
  const params = new URLSearchParams(catalogQueryString(rawParams));
  for (const [key, nextValue] of Object.entries(updates)) {
    if (nextValue) params.set(key, nextValue);
    else params.delete(key);
  }
  const query = params.toString();
  return `/catalog${query ? `?${query}` : ""}#catalog-results`;
}

function catalogActiveFilterCount(rawParams: Record<string, string | string[] | undefined>) {
  const filterKeys = [
    "brand",
    "model",
    "fuel",
    "transmission",
    "engineMin",
    "engineMax",
    "yearMin",
    "yearMax",
    "priceMin",
    "priceMax",
    "mileageMax",
    "powerMax",
    "source",
    "number",
    "under160",
    "passable",
    "eye",
    "clean",
    "shelf",
  ];
  return filterKeys.reduce((count, key) => {
    const rawValue = rawParams[key];
    return count + (typeof rawValue === "string" && rawValue ? 1 : 0);
  }, 0);
}

function buildActiveFilterChips(rawParams: Record<string, string | string[] | undefined>) {
  const value = (name: string) => typeof rawParams[name] === "string" ? rawParams[name] : "";
  const chips: Array<{ key: string; label: string; href: string }> = [];
  const add = (key: string, label: string, remove: Record<string, string | null> = { [key]: null, page: null }) => {
    chips.push({ key, label, href: catalogFilterHref(rawParams, remove) });
  };

  if (value("brand")) add("brand", value("brand"), { brand: null, model: null, page: null });
  if (value("model")) add("model", value("model"));
  if (value("fuel")) add("fuel", translateFuel(value("fuel")));
  if (value("transmission")) add("transmission", translateTransmission(value("transmission")));
  if (value("source")) add("source", sourceDisplayName(value("source")));
  if (value("number")) add("number", `Лот ${value("number")}`);
  if (value("yearMin") || value("yearMax")) add("year", `Год ${value("yearMin") || "от"}–${value("yearMax") || "до"}`, { yearMin: null, yearMax: null, page: null });
  if (value("priceMin") || value("priceMax")) add("price", "Цена задана", { priceMin: null, priceMax: null, page: null });
  if (value("engineMin") || value("engineMax")) add("engine", "Объём задан", { engineMin: null, engineMax: null, page: null });
  if (value("mileageMax")) add("mileageMax", `До ${value("mileageMax")} км`);
  if (value("powerMax")) add("powerMax", `До ${value("powerMax")} л.с.`);
  if (value("under160")) add("under160", "До 160 л.с.");
  if (value("passable")) add("passable", "Проходные 3–5 лет");
  if (value("clean")) add("clean", "Без страховых случаев");
  if (value("shelf")) add("shelf", shelfLabel(value("shelf")));

  return chips;
}

function shelfLabel(value: string) {
  if (value === "under-160") return "До 160 л.с.";
  if (value === "passable") return "Проходные 3–5 лет";
  return "Подборка";
}

function catalogPageHref(rawParams: Record<string, string | string[] | undefined>, page: number) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(rawParams)) {
    if (key === "page") continue;
    if (typeof rawValue === "string" && rawValue) params.set(key, rawValue);
    if (Array.isArray(rawValue)) rawValue.filter(Boolean).forEach((item) => params.append(key, item));
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/catalog${query ? `?${query}` : ""}#catalog-results`;
}

function paginationPages(currentPage: number, totalPages: number): Array<number | null> {
  const visible = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const sorted = [...visible].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result: Array<number | null> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push(null);
    result.push(page);
  });
  return result;
}

function isSort(value: string): value is keyof typeof sortLabels { return value in sortLabels; }
function numberParam(value: string) { const number = Number(value.replace(/\s/g, "")); return Number.isFinite(number) && number > 0 ? number : undefined; }
function positiveInteger(value: string) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : undefined; }
function unique(values: Array<string | null>) { return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ru")); }
function transmissionFilterValue(value: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("오토") || raw.includes("auto") || raw.includes("a/t") || raw.includes("автомат")) return "automatic";
  if (raw.includes("수동") || raw.includes("manual") || raw.includes("m/t") || raw.includes("механ")) return "manual";
  if (raw.includes("cvt")) return "cvt";
  if (raw.includes("dct")) return "dct";
  return value;
}
function formatUpdate(value: string | null) { if (!value) return "Дата не указана"; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? "Дата не указана" : `Обновлено ${date.format(parsed)}`; }
