import Link from "next/link";
import Form from "next/form";
import type { Metadata } from "next";
import {
  ArrowDownUp,
  ArrowRight,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  getCatalogCardPage,
  getCatalogCount,
  getCatalogFacetCars,
  getPassoStagingCars,
  getPassoStagingCount,
  type CatalogFilters,
  type StagingCatalogType,
} from "@/server/cars/repository";
import { translateDrive, translateFuel, translateTransmission } from "@/server/normalization/display";
import { bodyTypeFilterValue, driveTypeFilterValue, transmissionFilterValue } from "@/lib/catalog-filter-values";
import { LiveCatalogCount } from "./LiveCatalogCount";
import { getCbrCalcRates } from "@/server/calc/rates";
import { PassoCatalogCard } from "@/components/catalog/PassoCatalogCard";
import { normalizeCatalogBrand } from "@/lib/catalog-brand";
import { CatalogSearchBar } from "./CatalogSearchBar";
import { CatalogInfiniteGrid } from "./CatalogInfiniteGrid";
import { CatalogFilterDraft } from "./CatalogFilterDraft";
import { GenerationCascade } from "./GenerationCascade";
import { MobileCatalogExperience } from "./MobileCatalogExperience";
import { BrandLogo } from "@/components/catalog/BrandLogo";

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

  const filters: CatalogFilters = {
    brand: normalizeCatalogBrand(value("brand")) || undefined,
    generation: value("generation") || undefined,
    model: value("model") || undefined,
    search: value("search") || undefined,
    fuelType: value("fuel") || undefined,
    transmission: value("transmission") || undefined,
    minEngineCc: numberParam(value("engineMin")),
    maxEngineCc: numberParam(value("engineMax")),
    minYear: numberParam(value("yearMin")),
    maxYear: numberParam(value("yearMax")),
    registrationMonth: numberParam(value("month")),
    modification: value("modification") || undefined,
    trim: value("trim") || undefined,
    bodyType: value("body") || undefined,
    driveType: driveTypeFilterValue(value("drive")) || undefined,
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

  const [totalCars, optionCars, initialPage] = await Promise.all([
    getCatalogCount(filters),
    getCatalogFacetCars(),
    getCatalogCardPage(filters),
  ]);
  const shownCars = initialPage.cars;
  const brands = unique(optionCars.map((car) => car.brand));
  const modelsByBrand = optionCars.reduce<Record<string, string[]>>((groups, car) => {
    if (!car.brand || !car.model) return groups;
    groups[car.brand] = groups[car.brand] ?? [];
    if (!groups[car.brand].includes(car.model)) groups[car.brand].push(car.model);
    return groups;
  }, {});
  for (const models of Object.values(modelsByBrand)) models.sort();
  // Keep Hybrid selectable even if the current facet sample has no hybrid rows.
  const fuels = unique([...optionCars.map((car) => car.fuel_type), "hybrid"]);
  const transmissions = unique(optionCars.map((car) => transmissionFilterValue(car.transmission)));
  const driveTypes = unique(["FWD", "RWD", "2WD", "4WD", ...optionCars.map((car) => driveTypeFilterValue(car.drive_type))]);
  const trims = unique(optionCars.map((car) => car.trim));
  const bodies = unique(optionCars.map((car) => bodyTypeFilterValue(car.body_type)));
  const colors = unique(optionCars.map((car) => car.color));
  const popularBrands = brands.slice(0, 12);
  const searchableModels = Object.entries(modelsByBrand).flatMap(([brand, modelNames]) => modelNames.map((model) => ({ brand, model })));
  const brandCounts = optionCars.reduce<Record<string, number>>((counts, car) => {
    if (car.brand) counts[car.brand] = (counts[car.brand] ?? 0) + 1;
    return counts;
  }, {});
  const currentQuery = catalogQueryString(rawParams);
  const feedQuery = catalogFeedQueryString(rawParams);
  const filterFormProps = {
    brand: value("brand"),
    generation: value("generation"),
    model: value("model"),
    brands,
    modelsByBrand,
    fuels,
    transmissions,
    driveTypes,
    trims,
    bodies,
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

      <CatalogSearchBar brands={brands} initialValue={value("search")} models={searchableModels} />

      <section className="border-b border-[#dce2eb] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-5 md:py-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end md:gap-5">
            <div>
              <h1 className="mt-0 text-[25px] font-semibold leading-tight tracking-normal sm:text-4xl">Каталог автомобилей</h1>
              <p className="mt-1.5 max-w-2xl text-[12px] leading-4 text-[#647084] sm:mt-2 sm:text-sm sm:leading-6">Подбор по реальным данным источника с расчётом цены до Владивостока.</p>
              <p className="mt-2 text-sm font-semibold text-[#273246] md:hidden">{totalCars.toLocaleString("ru-RU")} автомобилей</p>
            </div>
            <div className="hidden items-center gap-2 self-start rounded-full bg-[#fbf7ed] px-3 py-2 text-xs text-[#7b5a22] md:inline-flex md:gap-3 md:rounded-none md:border-l-2 md:border-[#c7a55a] md:bg-transparent md:pl-4 md:text-sm"><CarFront size={18} className="text-[#c7a55a] md:size-5" /><span><strong className="mr-1 text-base text-[#101827] md:block md:text-xl">{totalCars}</strong><span className="text-[#647084]">автомобилей найдено</span></span></div>
          </div>

          {popularBrands.length ? (
            <div className="scrollbar-none mt-4 hidden items-center gap-5 overflow-x-auto md:flex md:flex-nowrap md:gap-6">
              {popularBrands.map((brand) => {
                const selected = filters.brand === brand;
                return (
                  <Link
                    aria-current={selected ? "page" : undefined}
                    className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-0 text-[15px] font-medium transition ${
                      selected
                        ? "border-[#a98239] text-[#15171b]"
                        : "border-transparent text-[#15171b] hover:border-[#d7c49c]"
                    }`}
                    href={selected
                      ? catalogFilterHref(rawParams, { brand: null, model: null, generation: null, modification:null,trim:null, page: null })
                    : catalogFilterHref(rawParams, { brand, model: null, generation: null, modification:null,trim:null, page: null })}
                    prefetch={false}
                    key={brand}
                  >
                    <BrandLogo brand={brand} size={26} />
                    {brand}
                    <span className="text-[#757b84]">{brandCounts[brand] ?? 0}</span>
                    {selected ? <span aria-hidden="true" className="text-[#a98239]">×</span> : null}
                  </Link>
                );
              })}
              <Link href="#filters" className="inline-flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent text-[15px] font-medium text-[#7b5a22] transition hover:border-[#d7c49c]">Все марки <ChevronRight size={18} /></Link>
            </div>
          ) : null}
        </div>
      </section>

      <section id="filters" className="hidden border-b border-[#dce2eb] bg-white md:block">
        <div className="mx-auto max-w-7xl px-3 pb-5 sm:px-5 md:pb-8">
          <div className="rounded-2xl border border-[#dce2eb] bg-[#f7f8fa] p-3 shadow-[0_12px_32px_rgba(16,24,39,0.05)] sm:p-4 md:p-5">
            <CatalogFilterDraft key={currentQuery} currentQuery={currentQuery}><div className="hidden md:block"><GenerationCascade brand={filters.brand} currentQuery={currentQuery} generation={filters.generation} model={filters.model} modification={filters.modification} trim={filters.trim} totalCars={totalCars} /></div>
            <div className="mt-4 hidden border-t border-[#dce2eb] pt-4 md:block">
              <CatalogFilterForm {...filterFormProps} />
            </div></CatalogFilterDraft>
          </div>
        </div>
      </section>

      <section id="catalog-results" className="mx-auto max-w-7xl scroll-mt-4 px-3 pb-12 pt-2 sm:px-5 md:pb-12 md:pt-7">
        <div className="sticky top-[68px] z-[60] -mx-3 bg-[#f5f6f8] shadow-[0_5px_14px_rgba(15,31,49,0.1)] sm:-mx-5 md:hidden">
          {popularBrands.length ? <div className="scrollbar-none flex gap-4 overflow-x-auto border-y border-[#dce2eb] bg-white px-3 py-2.5 sm:px-5">{popularBrands.map((brand) => {
            const selected = filters.brand === brand;
            return <Link aria-current={selected ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold ${selected ? "text-[#956f2c]" : "text-[#273246]"}`} href={selected ? catalogFilterHref(rawParams, { brand: null, model: null, generation: null, modification:null,trim:null, page: null }) : catalogFilterHref(rawParams, { brand, model: null, generation: null, modification:null,trim:null, page: null })} key={brand} prefetch={false}><BrandLogo brand={brand} size={20} />{brand}<span className="text-[#7a8798]">{brandCounts[brand] ?? 0}</span>{selected ? <span aria-hidden="true">×</span> : null}</Link>;
          })}</div> : null}
          <MobileCatalogExperience
            currentQuery={currentQuery}
            key={currentQuery}
            options={{ bodies, colors, fuels, transmissions, trims, brands, modelsByBrand }}
            sortOptions={Object.entries(sortLabels).map(([optionValue, label]) => ({ value: optionValue, label }))}
            totalCars={totalCars}
          />
        </div>
        <div className="mb-4 hidden justify-end md:flex">
          <CatalogSortMenu rawParams={rawParams} sort={sort} />
        </div>
        <div className="catalog-navigation-loading" role="status">Подбираем автомобили по выбранным фильтрам…</div>
        <div data-catalog-output>
        {shownCars.length ? <>
          <CatalogInfiniteGrid initialCars={shownCars} initialCursor={initialPage.nextCursor} key={feedQuery} query={feedQuery} />
        </> : <EmptyState />}
        </div>
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
    motorcycle: { title: "Мототехника из Кореи" },
    scooter: { title: "Скутеры из Кореи" },
    jetski: { title: "Гидроциклы из Кореи" },
  }[category];
  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <section className="border-b border-[#dce2eb] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5 md:py-10">
          <div className="mt-1.5 flex flex-col gap-4">
            <div><h1 className="text-[32px] font-semibold leading-tight sm:text-4xl">{labels.title}</h1></div>
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

type CatalogFilterFormProps = {
  brand: string;
  generation: string;
  model: string;
  fuels: string[];
  transmissions: string[];
  driveTypes: string[];
  trims: string[];
  bodies: string[];
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
  brand,
  clean,
  fuels,
  generation,
  mobile = false,
  model,
  passable,
  sort,
  totalCars,
  transmissions,
  driveTypes,
  bodies,
  colors,
  under160,
  value,
}: CatalogFilterFormProps) {
  const mainFields = (
    <>
      <RangeField label="Год выпуска" maxName="yearMax" maxValue={value("yearMax")} minName="yearMin" minValue={value("yearMin")} />
      <RangeField label="Цена до Владивостока, ₽" maxName="priceMax" maxValue={value("priceMax")} minName="priceMin" minValue={value("priceMin")} />
    </>
  );

  const additionalFields = (
    <>
      <RangeField label="Объём двигателя, см³" maxName="engineMax" maxValue={value("engineMax")} minName="engineMin" minValue={value("engineMin")} />
      <FilterInput inputMode="numeric" label="Пробег до, км" name="mileageMax" placeholder="Например, 80 000" value={value("mileageMax")} />
      <FilterInput inputMode="numeric" label="Пробег от, км" name="mileageMin" placeholder="Например, 10 000" value={value("mileageMin")} />
      <FilterInput inputMode="numeric" label="Мощность до, л.с." name="powerMax" placeholder="Например, 160" value={value("powerMax")} />

      <FilterSelect label="Кузов" name="body" options={bodies} placeholder="Любой" translate={translateBody} value={value("body")} />
      <FilterSelect label="Привод" name="drive" options={driveTypes} placeholder="Любой" translate={(item) => translateDrive(item) ?? item} value={value("drive")} />
      <FilterSelect label="Цвет кузова" name="color" options={colors} placeholder="Любой" value={value("color")} />
      <FilterSelect label="Месяц выпуска" name="month" options={Array.from({ length: 12 }, (_, index) => String(index + 1))} placeholder="Любой" translate={translateMonth} value={value("month")} />
      <RangeField label="Количество владельцев" maxName="ownersMax" maxValue={value("ownersMax")} minName="ownersMin" minValue={value("ownersMin")} />
      <RangeField label="Страховые выплаты, ₩" maxName="insuranceMax" maxValue={value("insuranceMax")} minName="insuranceMin" minValue={value("insuranceMin")} />
    </>
  );

  return (
    <Form action="/catalog" prefetch={false} className={mobile ? "min-h-full bg-[#f4f6f9] pb-24" : ""}>
      {mobile && brand ? <input name="brand" type="hidden" value={brand} /> : null}
      {mobile && model ? <input name="model" type="hidden" value={model} /> : null}
      {mobile && generation ? <input name="generation" type="hidden" value={generation} /> : null}
      {mobile && value("modification") ? <input name="modification" type="hidden" value={value("modification")} /> : null}
      {mobile && value("trim") ? <input name="trim" type="hidden" value={value("trim")} /> : null}
      <input name="sort" type="hidden" value={sort} />
      <div className={mobile ? "grid gap-4 p-4" : "grid gap-4"}>
        <div className={mobile ? "grid gap-4" : "grid gap-3 lg:grid-cols-[minmax(130px,1fr)_minmax(160px,1.15fr)_minmax(130px,0.9fr)_minmax(120px,0.9fr)_minmax(95px,0.7fr)_auto] lg:items-end"}>
          {mainFields}
          <FilterSelect label="Топливо" name="fuel" options={fuels} placeholder="Любое" translate={translateFuel} value={value("fuel")} />
          <FilterSelect label="КПП" name="transmission" options={transmissions} placeholder="Любая" translate={translateTransmission} value={value("transmission")} />
          <FilterSelect label="Привод" name="drive" options={driveTypes} placeholder="Любой" translate={(item) => translateDrive(item) ?? item} value={value("drive")} />
        </div>
        {mobile ? (
          <details className="group border-t border-[#dce2eb] pt-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#273246] [&::-webkit-details-marker]:hidden">
              Дополнительные параметры
              <ChevronDown className="transition group-open:rotate-180" size={18} />
            </summary>
            <div className="grid gap-4 pb-2 pt-3">{additionalFields}</div>
          </details>
        ) : (
          <details className="group rounded-xl border border-[#dce2eb] bg-white">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-[#273246] [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2"><SlidersHorizontal size={17} /> Дополнительные параметры</span>
              <ChevronDown className="transition group-open:rotate-180" size={18} />
            </summary>
            <div className="grid gap-4 border-t border-[#e8ecf2] p-4 sm:grid-cols-2 lg:grid-cols-4">{additionalFields}</div>
          </details>
        )}
        <div className={mobile ? "grid grid-cols-2 gap-2 border-t border-[#dce2eb] pt-4" : "flex flex-wrap items-center gap-2 border-t border-[#dce2eb] pt-4"}>
          <FilterCheck checked={under160} compact={!mobile} label="До 160 л.с." name="under160" value="1" />
          <FilterCheck checked={passable} compact={!mobile} label="Проходные 3–5 лет" name="passable" value="1" />
          <FilterCheck checked={clean} compact={!mobile} label="Без ДТП" name="clean" value="1" />
          <FilterCheck checked={value("noInsurance") === "1"} compact={!mobile} label="Без страховых выплат" name="noInsurance" value="1" />
        </div>
        {!mobile ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dce2eb] pt-4">
            <Link className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-[#647084] hover:text-[#273246]" href="/catalog"><RotateCcw size={16} /> Сбросить</Link>
            <LiveCatalogCount initialCount={totalCars} />
          </div>
        ) : null}
      </div>
      {mobile ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#dce2eb] bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(16,24,39,0.08)]">
          <LiveCatalogCount initialCount={totalCars} mobile />
        </div>
      ) : null}
    </Form>
  );
}

function CatalogSortMenu({ rawParams, sort }: { rawParams: Record<string, string | string[] | undefined>; sort: keyof typeof sortLabels }) {
  return (
    <details className="group relative z-20">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-[#d7dee8] bg-white px-3.5 text-sm font-medium text-[#273246] shadow-sm transition hover:border-[#c7a55a] [&::-webkit-details-marker]:hidden">
        <ArrowDownUp size={16} className="text-[#647084]" />
        <span>{sortLabels[sort]}</span>
        <ChevronDown className="text-[#647084] transition group-open:rotate-180" size={16} />
      </summary>
      <div className="absolute right-0 top-full z-[100] mt-2 max-h-80 min-w-64 overflow-y-auto rounded-xl border border-[#e1e6ed] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,39,0.16)]">
        {Object.entries(sortLabels).map(([option, label]) => {
          const selected = option === sort;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition ${selected ? "bg-[#fbf7ed] font-semibold text-[#7b5a22]" : "text-[#3f4b5e] hover:bg-[#f4f6f9]"}`}
              href={catalogFilterHref(rawParams, { sort: option, page: null })}
              key={option}
            >
              <Check aria-hidden="true" className={selected ? "text-[#a98239]" : "invisible"} size={16} />
              {label}
            </Link>
          );
        })}
      </div>
    </details>
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

function FilterCheck({ checked, compact = false, label, name, value }: { checked: boolean; compact?: boolean; label: string; name: string; value: string }) {
  const appearance = checked ? "border-[#c7a55a] bg-[#fbf7ed] text-[#7b5a22]" : "border-[#d7dee8] bg-white text-[#3f4b5e]";
  const layout = compact
    ? "inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition hover:border-[#c7a55a]"
    : "flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 text-center text-xs font-semibold transition";
  return <label className={`${layout} ${appearance}`}><input className="size-4 shrink-0 accent-[#c7a55a]" defaultChecked={checked} name={name} type="checkbox" value={value} />{label}</label>;
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

function catalogFeedQueryString(rawParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams(catalogQueryString(rawParams));
  params.delete("page");
  params.delete("cursor");
  params.delete("limit");
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
  return bodyTypeFilterValue(value) ?? value;
}

function translateMonth(value: string) {
  const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  return months[Number(value) - 1] ?? value;
}
