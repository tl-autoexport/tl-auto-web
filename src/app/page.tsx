import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ChevronRight,
  MessageSquareQuote,
  Images,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import {
  getCatalogCars,
  getCatalogFacetCars,
  getHomeCatalogData,
  type CatalogCar,
} from "@/server/cars/repository";
import { SiteHeader } from "@/components/site/SiteHeader";
import { CatalogQuickNav } from "@/components/home/CatalogQuickNav";
import { PrototypeVehicleCard } from "@/components/home/PrototypeVehicleCard";
import { StoryCarousel } from "@/components/home/StoryCarousel";
import { ContactLocations } from "@/components/home/ContactLocations";

export const revalidate = 60;

const prototypeSourceId = "42554713";

export default async function Home() {
  const [homeDataResult, prototypeResult, facetResult] = await Promise.allSettled([
    getHomeCatalogData(),
    getCatalogCars({ sourceId: prototypeSourceId, limit: 1 }),
    getCatalogFacetCars(),
  ]);
  const { cars, under160Cars, electricCars } =
    homeDataResult.status === "fulfilled"
      ? homeDataResult.value
      : { cars: [], under160Cars: [], electricCars: [] };
  const usedCarIds = new Set<string>();
  const under160 = selectShelfCars(under160Cars, usedCarIds);
  const electric = selectShelfCars(electricCars, usedCarIds);
  const newArrivals = selectShelfCars(cars, usedCarIds);
  const prototypeCar = prototypeResult.status === "fulfilled" ? prototypeResult.value[0] : undefined;
  const facetCars = facetResult.status === "fulfilled" ? facetResult.value : [];
  const newArrivalCards = prototypeCar
    ? [prototypeCar, ...newArrivals.filter((car) => car.id !== prototypeCar.id).slice(0, 3)]
    : newArrivals;

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <SiteHeader />

      <section className="border-b border-[#e2e6ed] bg-white" aria-label="Актуальные предложения">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 sm:py-6">
          <StoryCarousel>
            <DodoStoryCard
              title="Новая Avanta до 160 л.с."
              href="/catalog?search=Avante&powerMax=160&yearMin=2025&sort=fresh"
              image="/assets/stories/avante.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Новая линейка гидроциклов Sea-Doo"
              image="/assets/stories/sea-doo.png"
              position="object-center"
              status="Скоро"
            />
            <DodoStoryCard
              title="Как заказать"
              href="/#delivery"
              image="/assets/stories/inspection-v2.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Мы в соцсетях"
              href="/#contacts"
              image="/assets/stories/social-v2.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Стань партнёром"
              href="/#contacts"
              image="/assets/stories/partner.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Кредитование"
              image="/assets/stories/financing.png"
              position="object-center"
              status="Скоро"
            />
          </StoryCarousel>
        </div>
      </section>

      <CatalogQuickNav
        brands={[...new Set(facetCars.map((car) => car.brand).filter(Boolean))] as string[]}
        models={[...new Map(facetCars.filter((car) => car.brand && car.model).map((car) => [`${car.brand}:${car.model}`, { brand: car.brand!, model: car.model! }])).values()]}
      />

      <div className="bg-[#f5f6f8]">
      <VehicleShelf
        id="under-160"
        eyebrow="Подборка"
        title="Автомобили до 160 л.с."
        description="Автомобили с доступной мощностью и рассчитанной стоимостью до Владивостока."
        href="/catalog?shelf=under-160"
        cars={under160}
        empty="В текущей витрине ещё нет подходящих автомобилей."
      />

      <VehicleShelf
        id="electric"
        eyebrow="Электромобили"
        title="Электромобили из Кореи"
        description="Свежие объявления из Кореи. Итоговую стоимость рассчитываем индивидуально после подтверждения тарифа ввоза."
        href="/catalog?fuel=electric"
        cars={electric}
        empty="Свежие электромобили появятся после ближайшего обновления каталога."
      />

      <VehicleShelf
        id="new-arrivals"
        eyebrow="Свежие поступления"
        title="Новые автомобили"
        description="Недавно добавленные объявления, которые можно изучить и сразу рассчитать."
        href="/catalog?sort=fresh"
        cars={newArrivalCards}
        empty="Свежие поступления появятся в этой витрине после обновления каталога."
      />

      <ContactLocations />

      <section
        id="reviews"
        className="scroll-mt-28 border-b border-[#dce2eb] bg-white"
      >
        <div className="mx-auto max-w-7xl px-5 py-14 md:py-18">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-[#956f2c]">
              Отзывы и истории
            </p>
            <Link href="#reviews" className="hidden shrink-0 items-center gap-2 text-sm font-semibold text-[#101827] sm:inline-flex">
              Смотреть все <ArrowRight size={16} />
            </Link>
          </div>

          <div className="scrollbar-none -mr-5 mt-9 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 pr-5 sm:mr-0 sm:pr-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
            <ReviewPlaceholder
              icon={PlayCircle}
              index="01"
              title="Видео после получения автомобиля"
              tone="navy"
              featured
            />
            <ReviewPlaceholder
              icon={MessageSquareQuote}
              index="02"
              title="История подбора"
              tone="red"
            />
            <ReviewPlaceholder
              icon={Images}
              index="03"
              title="Фото выдачи"
              tone="light"
            />
            <ReviewPlaceholder
              icon={MessageSquareQuote}
              index="04"
              title="Отзыв о сопровождении"
              tone="navy"
            />
          </div>

        </div>
      </section>


      <section className="mx-auto max-w-7xl px-5 pb-12 pt-2">
        <div className="grid gap-4 rounded-md bg-[#101827] p-6 text-white md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#7ce1c4]">
              <Sparkles size={16} /> Подбор без регистрации
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Не нашли подходящий вариант?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Откройте каталог, сохраните ссылку на интересующий автомобиль и
              передайте её менеджеру вместе с параметрами поиска.
            </p>
          </div>
          <Link
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#c7a55a] px-5 py-3 text-sm font-semibold text-[#15130f]"
            href="/catalog"
          >
            Найти автомобиль <ChevronRight size={17} />
          </Link>
        </div>
      </section>
      </div>
    </main>
  );
}

function DodoStoryCard({
  image,
  position,
  title,
  href,
  status,
}: {
  image: string;
  position: string;
  title: string;
  href?: string;
  status?: string;
}) {
  const content = (
    <>
      <Image src={image} alt="" fill sizes="(min-width: 1024px) 230px, (min-width: 640px) 200px, 166px" className={`object-cover transition duration-500 group-hover:scale-105 ${position}`} />
      <span className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <span className="absolute inset-x-3 bottom-3 max-w-[calc(100%-24px)] break-words text-[13px] font-bold leading-tight text-white drop-shadow-sm sm:inset-x-4 sm:bottom-4 sm:max-w-none sm:text-lg">{title}</span>
      {status ? <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{status}</span> : null}
    </>
  );
  const className = "group relative aspect-[0.78] w-[166px] shrink-0 snap-start overflow-hidden rounded-[24px] bg-[#edf0f4] shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg sm:w-[200px] sm:rounded-[30px] lg:w-[230px]";
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className} aria-disabled="true">{content}</div>;
}

function VehicleShelf({
  cars,
  description,
  empty,
  eyebrow,
  href,
  id,
  title,
}: {
  cars: CatalogCar[];
  description: string;
  empty: string;
  eyebrow: string;
  href: string;
  id: string;
  title: string;
}) {
  return (
    <section id={id} className="mx-auto max-w-7xl px-4 py-4 sm:px-5 sm:py-10">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end md:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#956f2c]">{eyebrow}</p>
          <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-[#647084] sm:mt-2 sm:leading-6">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#111827] transition hover:text-[#4b5563]"
        >
          Смотреть все <ArrowRight size={16} />
        </Link>
      </div>
      {cars.length ? (
        <div className="scrollbar-none -mr-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pr-4 sm:mr-0 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:p-0 xl:grid-cols-4">
          {cars.map((car) => (
            <div className="w-[calc(100%-44px)] shrink-0 snap-start sm:w-auto sm:shrink" key={car.id}>
              <PrototypeVehicleCard car={car} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-md border border-dashed border-[#c7d0dc] bg-white p-5 text-sm text-[#647084]">
          {empty}
        </div>
      )}
    </section>
  );
}

function selectShelfCars(
  candidates: CatalogCar[],
  usedCarIds: Set<string>,
  limit = 4,
) {
  const selected: CatalogCar[] = [];
  const usedModels = new Set<string>();

  for (const car of candidates) {
    if (usedCarIds.has(car.id)) continue;
    const modelKey = `${car.brand ?? ""}:${car.model ?? ""}`.toLowerCase();
    if (usedModels.has(modelKey)) continue;
    selected.push(car);
    usedCarIds.add(car.id);
    usedModels.add(modelKey);
    if (selected.length === limit) break;
  }

  // A narrow shelf (for example, cars under 160 hp) can contain only a few
  // distinct models in the latest import. Fill the remaining places with
  // other real listings instead of rendering an incomplete 3-card row.
  if (selected.length < limit) {
    for (const car of candidates) {
      if (usedCarIds.has(car.id)) continue;
      selected.push(car);
      usedCarIds.add(car.id);
      if (selected.length === limit) break;
    }
  }

  return selected;
}

function ReviewPlaceholder({
  featured = false,
  icon: Icon,
  index,
  title,
  tone,
}: {
  featured?: boolean;
  icon: typeof PlayCircle;
  index: string;
  title: string;
  tone: "navy" | "red" | "light";
}) {
  const tones = {
    navy: "bg-[#11151d] text-white",
    red: "bg-[#c7a55a] text-[#15130f]",
    light: "bg-[#eef1f5] text-[#101827]",
  };
  const muted = tone === "light" ? "text-[#647084]" : "text-white/70";

  return (
    <article
      className="w-[calc(100%-44px)] shrink-0 snap-start overflow-hidden rounded-[24px] border border-[#dce2eb] bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg sm:w-[360px] lg:w-auto lg:shrink"
    >
      <div
        className={`relative flex aspect-[1.55] items-center justify-between overflow-hidden p-5 md:p-6 ${tones[tone]}`}
      >
        <span className={`absolute left-5 top-5 text-xs font-bold ${muted}`}>{index}</span>
        <Icon className="absolute right-5 top-5" size={featured ? 30 : 24} strokeWidth={1.7} aria-hidden="true" />
        <div className="mx-auto flex size-20 items-center justify-center rounded-full border border-white/20 bg-black/10">
          <Icon size={34} strokeWidth={1.5} aria-hidden="true" />
        </div>
      </div>
      <div className="p-5 md:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#956f2c]">
          История клиента
        </p>
        <h3
          className="mt-3 text-xl font-semibold leading-tight text-[#101827]"
        >
          {title}
        </h3>
        <div className="mt-5 flex items-center justify-between border-t border-[#e5e9ef] pt-4 text-xs font-semibold text-[#98a3b2]">
          <span>Материал готовится</span>
          <span className="rounded-full bg-[#f0f2f5] px-2.5 py-1">Скоро</span>
        </div>
      </div>
    </article>
  );
}
