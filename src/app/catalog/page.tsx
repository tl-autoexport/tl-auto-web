import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  getCatalogCars,
  getCatalogCount,
  getCatalogFacetCars,
  getPassoStagingCars,
  getPassoStagingCount,
  type CatalogCar,
  type CatalogFilters,
  type StagingCatalogType,
} from "@/server/cars/repository";
import { translateFuel, translateTransmission } from "@/server/normalization/display";
import { SiteHeader } from "@/components/site/SiteHeader";
import { MobileCatalogFilters } from "./MobileCatalogFilters";
import { BrandModelFields } from "@/components/catalog/BrandModelFields";
import { LiveCatalogCount } from "./LiveCatalogCount";
import { PrototypeVehicleCard } from "@/components/home/PrototypeVehicleCard";
import { getCbrCalcRates } from "@/server/calc/rates";
import { PassoCatalogCard } from "@/components/catalog/PassoCatalogCard";
import { sourceDisplayName } from "@/lib/source-url";

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
  const category = value("category") as "car" | StagingCatalogType;
  if (category === "motorcycle" || category === "scooter" || category === "jetski") {
    return <StagingCatalogPage category={category} page={positiveInteger(value("page")) ?? 1} />;
  }
  const under160 = value("under160") === "1" || shelf === "under-160";
  const passable = value("passable") === "1" || shelf === "passable";
  const sortValue = value("sort");
  const sort = isSort(sortValue) ? sortValue : "fresh";
  const requestedPage = positiveInteger(value("page")) ?? 1;

  const filters: CatalogFilters = {
    brand: value("brand") || undefined,
    model: value("model") || undefined,
    search: value("search") || undefined,
    fuelType: value("fuel") || undefined,
    transmission: value("transmission") || undefined,
    minEngineCc: numberParam(value("engineMin")),
    maxEngineCc: numberParam(value("engineMax")),
    minYear: numberParam(value("yearMin")),
    maxYear: numberParam(value("yearMax")),
    registrationMonth: numberParam(value("month")),
    trim: value("trim") || undefined,
    bodyType: value("body") || undefined,
    driveType: value("drive") || undefined,
    color: value("color") || undefined,
    minOwners: numberParam(value("ownersMin")),
    maxOwners: numberParam(value("ownersMax")),
    minMileageKm: numberParam(value("mileageMin")),
    maxMileageKm: numberParam(value("mileageMax")),
    minPriceRub: numberParam(value("priceMin")),
    maxPriceRub: numberParam(value("priceMax")),
    maxPowerHp: under160 ? 160 : numberParam(value("powerMax")),
    noAccidents: value("clean") === "1",
    noInsurance: value("noInsurance") === "1",
    minInsurancePayoutKrw: numberParam(value("insuranceMin")),
    maxInsurancePayoutKrw: numberParam(value("insuranceMax")),
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
  const modelsByBrand = optionCars.reduce<Record<string, string[]>>((groups, car) => {
    if (!car.brand || !car.model) return groups;
    groups[car.brand] = groups[car.brand] ?? [];
    if (!groups[car.brand].includes(car.model)) groups[car.brand].push(car.model);
    return groups;
  }, {});
  for (const models of Object.values(modelsByBrand)) models.sort();
  const fuels = unique(optionCars.map((car) => car.fuel_type));
  const transmissions = unique(optionCars.map((car) => transmissionFilterValue(car.transmission)));
  const trims = unique(optionCars.map((car) => car.trim));
  const bodies = unique(optionCars.map((car) => car.body_type).map((body) => body ? translateBody(body) : null));
  const drives = unique(optionCars.map((car) => car.drive_type));
  const colors = unique(optionCars.map((car) => car.color));
  const popularBrands = brands.slice(0, 12);
  const brandCounts = optionCars.reduce<Record<string, number>>((counts, car) => {
    if (car.brand) counts[car.brand] = (counts[car.brand] ?? 0) + 1;
    return counts;
  }, {});
  const activeCount = catalogActiveFilterCount(rawParams);
  const currentQuery = catalogQueryString(rawParams);
  const activeChips = buildActiveFilterChips(rawParams);
  const filterFormProps = {
    brands,
    modelsByBrand,
    fuels,
    transmissions,
    trims,
    bodies,
    drives,
    colors,
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

      <CatalogCategoryTabs active="car" />

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
            <div className="scrollbar-none mt-6 flex items-center gap-5 overflow-x-auto sm:mt-8 sm:flex-wrap sm:gap-x-7 sm:gap-y-3">
              {popularBrands.map((brand) => {
                const selected = filters.brand === brand;
                return (
                  <Link
                    aria-current={selected ? "page" : undefined}
                    className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-0 text-[15px] font-medium transition sm:h-12 sm:gap-2.5 sm:text-lg ${
                      selected
                        ? "border-[#a98239] text-[#15171b]"
                        : "border-transparent text-[#15171b] hover:border-[#d7c49c]"
                    }`}
                    href={selected
                      ? catalogFilterHref(rawParams, { brand: null, model: null, page: null })
                      : catalogFilterHref(rawParams, { brand, model: null, page: null })}
                    key={brand}
                  >
                    {brand}
                    <span className="text-[#757b84]">{brandCounts[brand] ?? 0}</span>
                    {selected ? <span aria-hidden="true" className="text-[#a98239]">×</span> : null}
                  </Link>
                );
              })}
              <Link href="#filters" className="inline-flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent text-[15px] font-medium text-[#7b5a22] transition hover:border-[#d7c49c] sm:h-12 sm:text-lg">Все марки <ChevronRight size={18} /></Link>
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shownCars.map((car) => <CatalogResultCard key={car.id} car={car} />)}</div>
          {totalPages > 1 ? <Pagination currentPage={currentPage} rawParams={rawParams} totalPages={totalPages} /> : null}
        </> : <EmptyState />}
      </section>
    </main>
  );
}

async function StagingCatalogPage({ category, page }: { category: StagingCatalogType; page: number }) {
  const pageSize = 24;
  const [totalCars, shownCars] = await Promise.all([
    getPassoStagingCount(category),
    getPassoStagingCars(category, { limit: pageSize, offset: (page - 1) * pageSize }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCars / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rateSnapshot = await getCbrCalcRates().catch((error: unknown) => {
    console.error("Unable to load powersports calculation rates", error);
    return null;
  });
  const calculationRates = rateSnapshot?.rates ?? null;
  const labels = {
    motorcycle: { eyebrow: "Passo Bike", title: "Мототехника из Кореи", description: "Свежие объявления мотоциклов и скутеров с характеристиками и фотографиями из Passo." },
    scooter: { eyebrow: "Passo Bike", title: "Скутеры из Кореи", description: "Свежие объявления скутеров с характеристиками и фотографиями из Passo." },
    jetski: { eyebrow: "Passo Boat", title: "Гидроциклы из Кореи", description: "Только гидроциклы из раздела Passo. Лодки и яхты исключены." },
  }[category];
  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <SiteHeader />
      <CatalogCategoryTabs active={category} />
      <section className="border-b border-[#dce2eb] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5 md:py-10">
          <p className="text-xs font-semibold text-[#956f2c] sm:text-sm">{labels.eyebrow}</p>
          <div className="mt-1.5 flex flex-col gap-4">
            <div><h1 className="text-[32px] font-semibold leading-tight sm:text-4xl">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#647084]">{labels.description}</p></div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-3 py-8 sm:px-5">
        <div className="mb-5 flex items-center justify-between border-b border-[#dce2eb] pb-4 text-sm text-[#647084]">
          <span>Показано {shownCars.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, totalCars)} из ${totalCars}` : "0 объявлений"}</span>
          <span>Сначала свежие объявления</span>
        </div>
        {shownCars.length ? <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shownCars.map((car) => <PassoCatalogCard key={car.id} car={car} calculationRates={calculationRates} />)}
          </div>
          {totalPages > 1 ? <Pagination currentPage={currentPage} rawParams={{ category }} totalPages={totalPages} /> : null}
        </> : <EmptyState />}
      </section>
    </main>
  );
}

function CatalogCategoryTabs({ active }: { active: "car" | StagingCatalogType }) {
  const tabs = [{ key: "car", label: "Автомобили", href: "/catalog" }, { key: "motorcycle", label: "Мототехника", href: "/catalog?category=motorcycle" }, { key: "jetski", label: "Гидроциклы", href: "/catalog?category=jetski" }] as const;
  return <nav aria-label="Категории техники" className="border-b border-[#dce2eb] bg-white"><div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-5">{tabs.map((tab) => <Link key={tab.key} href={tab.href} className={`relative whitespace-nowrap px-4 py-4 text-sm font-semibold transition ${active === tab.key ? "text-[#956f2c]" : "text-[#647084] hover:text-[#956f2c]"}`}>{tab.label}{active === tab.key ? <span className="absolute inset-x-4 bottom-0 h-0.5 bg-[#956f2c]" /> : null}</Link>)}</div></nav>;
}

type CatalogFilterFormProps = {
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  fuels: string[];
  transmissions: string[];
  trims: string[];
  bodies: string[];
  drives: string[];
  colors: string[];
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
  modelsByBrand,
  passable,
  sort,
  totalCars,
  transmissions,
  trims,
  bodies,
  drives,
  colors,
  under160,
  value,
}: CatalogFilterFormProps) {
  const mainFields = (
    <>
      <BrandModelFields
        brands={brands}
        initialBrand={value("brand")}
        initialModel={value("model")}
        modelsByBrand={modelsByBrand}
      />
      <RangeField label="Год выпуска" maxName="yearMax" maxValue={value("yearMax")} minName="yearMin" minValue={value("yearMin")} />
      <RangeField label="Цена до Владивостока, ₽" maxName="priceMax" maxValue={value("priceMax")} minName="priceMin" minValue={value("priceMin")} />
    </>
  );

  const additionalFields = (
    <>
      <FilterSelect label="Топливо" name="fuel" options={fuels} placeholder="Любое" translate={translateFuel} value={value("fuel")} />
      <FilterSelect label="КПП" name="transmission" options={transmissions} placeholder="Любая" translate={translateTransmission} value={value("transmission")} />
      <RangeField label="Объём двигателя, см³" maxName="engineMax" maxValue={value("engineMax")} minName="engineMin" minValue={value("engineMin")} />
      <FilterInput inputMode="numeric" label="Пробег до, км" name="mileageMax" placeholder="Например, 80 000" value={value("mileageMax")} />
      <FilterInput inputMode="numeric" label="Пробег от, км" name="mileageMin" placeholder="Например, 10 000" value={value("mileageMin")} />
      <FilterInput inputMode="numeric" label="Мощность до, л.с." name="powerMax" placeholder="Например, 160" value={value("powerMax")} />
      <FilterSelect label="Комплектация" name="trim" options={trims} placeholder="Любая" value={value("trim")} />
      <FilterSelect label="Кузов" name="body" options={bodies} placeholder="Любой" translate={translateBody} value={value("body")} />
      <FilterSelect label="Привод" name="drive" options={drives} placeholder="Любой" translate={translateDrive} value={value("drive")} />
      <FilterSelect label="Цвет кузова" name="color" options={colors} placeholder="Любой" value={value("color")} />
      <FilterSelect label="Месяц выпуска" name="month" options={Array.from({ length: 12 }, (_, index) => String(index + 1))} placeholder="Любой" translate={translateMonth} value={value("month")} />
      <RangeField label="Количество владельцев" maxName="ownersMax" maxValue={value("ownersMax")} minName="ownersMin" minValue={value("ownersMin")} />
      <RangeField label="Страховые выплаты, ₩" maxName="insuranceMax" maxValue={value("insuranceMax")} minName="insuranceMin" minValue={value("insuranceMin")} />
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
          <FilterCheck checked={clean} label="Без ДТП" name="clean" value="1" />
          <FilterCheck checked={value("noInsurance") === "1"} label="Без страховых выплат" name="noInsurance" value="1" />
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
            <LiveCatalogCount initialCount={totalCars} />
          </div>
        ) : null}
      </div>
      {mobile ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#dce2eb] bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(16,24,39,0.08)]">
          <LiveCatalogCount initialCount={totalCars} mobile />
        </div>
      ) : null}
    </form>
  );
}

function CatalogResultCard({ car }: { car: CatalogCar }) {
  return <PrototypeVehicleCard car={car} />;
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
    "search",
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
    "mileageMin",
    "powerMax",
    "trim",
    "body",
    "drive",
    "color",
    "month",
    "ownersMin",
    "ownersMax",
    "insuranceMin",
    "insuranceMax",
    "noInsurance",
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
  if (value("search")) add("search", value("search"));
  if (value("fuel")) add("fuel", translateFuel(value("fuel")));
  if (value("transmission")) add("transmission", translateTransmission(value("transmission")));
  if (value("source")) add("source", sourceDisplayName(value("source")));
  if (value("number")) add("number", `Лот ${value("number")}`);
  if (value("yearMin") || value("yearMax")) add("year", `Год ${value("yearMin") || "от"}–${value("yearMax") || "до"}`, { yearMin: null, yearMax: null, page: null });
  if (value("priceMin") || value("priceMax")) add("price", "Цена задана", { priceMin: null, priceMax: null, page: null });
  if (value("engineMin") || value("engineMax")) add("engine", "Объём задан", { engineMin: null, engineMax: null, page: null });
  if (value("mileageMax")) add("mileageMax", `До ${value("mileageMax")} км`);
  if (value("mileageMin")) add("mileageMin", `От ${value("mileageMin")} км`);
  if (value("powerMax")) add("powerMax", `До ${value("powerMax")} л.с.`);
  if (value("trim")) add("trim", `Комплектация: ${value("trim")}`);
  if (value("body")) add("body", `Кузов: ${translateBody(value("body"))}`);
  if (value("drive")) add("drive", `Привод: ${translateDrive(value("drive"))}`);
  if (value("color")) add("color", `Цвет: ${value("color")}`);
  if (value("month")) add("month", translateMonth(value("month")));
  if (value("ownersMin") || value("ownersMax")) add("owners", `Владельцы ${value("ownersMin") || "от"}–${value("ownersMax") || "до"}`, { ownersMin: null, ownersMax: null, page: null });
  if (value("insuranceMin") || value("insuranceMax")) add("insurance", "Сумма страховых задана", { insuranceMin: null, insuranceMax: null, page: null });
  if (value("noInsurance")) add("noInsurance", "Без страховых выплат");
  if (value("under160")) add("under160", "До 160 л.с.");
  if (value("passable")) add("passable", "Проходные 3–5 лет");
  if (value("clean")) add("clean", "Без ДТП");
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

function translateBody(value: string) {
  const labels: Record<string, string> = {
    SUV: "Кроссовер",
    sedan: "Седан",
    Sedan: "Седан",
    hatchback: "Хэтчбек",
    wagon: "Универсал",
    minivan: "Минивэн",
    Спорткар: "Спорткар",
    "Большой автомобиль": "Седан",
    "Среднеразмерный автомобиль": "Седан",
    "Компактный автомобиль": "Хэтчбек",
    Микроавтомобиль: "Хэтчбек",
  };
  return labels[value] ?? value;
}

function translateDrive(value: string) {
  const labels: Record<string, string> = { "2WD": "Передний или задний", "4WD": "Полный", AWD: "Полный", FWD: "Передний", RWD: "Задний" };
  return labels[value] ?? value;
}

function translateMonth(value: string) {
  const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  return months[Number(value) - 1] ?? value;
}

function transmissionFilterValue(value: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("오토") || raw.includes("auto") || raw.includes("a/t") || raw.includes("автомат")) return "automatic";
  if (raw.includes("수동") || raw.includes("manual") || raw.includes("m/t") || raw.includes("механ")) return "manual";
  if (raw.includes("cvt")) return "cvt";
  if (raw.includes("dct")) return "dct";
  return value;
}
