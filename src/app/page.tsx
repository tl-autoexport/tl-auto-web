import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Calculator,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  MapPin,
  MessageSquareQuote,
  Images,
  PlayCircle,
  Search,
  Ship,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getCatalogCars,
  getHomeCatalogData,
  type CatalogCar,
} from "@/server/cars/repository";
import { SiteHeader } from "@/components/site/SiteHeader";
import { CatalogQuickNav } from "@/components/home/CatalogQuickNav";
import { PrototypeVehicleCard } from "@/components/home/PrototypeVehicleCard";

export const revalidate = 60;

const prototypeSourceId = "42554713";

export default async function Home() {
  const [homeDataResult, prototypeResult] = await Promise.allSettled([
    getHomeCatalogData(),
    getCatalogCars({ sourceId: prototypeSourceId, limit: 1 }),
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
  const newArrivalCards = prototypeCar
    ? [prototypeCar, ...newArrivals.filter((car) => car.id !== prototypeCar.id).slice(0, 3)]
    : newArrivals;

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <SiteHeader />

      <section className="border-b border-[#e2e6ed] bg-white" aria-label="Актуальные предложения">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 sm:py-6">
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <DodoStoryCard
              title="Спецпредложения"
              href="/catalog"
              image="/assets/stories/special-offers-v2.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Новое поступление"
              href="/catalog"
              image="/assets/stories/new-arrivals.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Проверка до покупки"
              href="/catalog"
              image="/assets/stories/inspection-v2.png"
              position="object-center"
            />
            <DodoStoryCard
              title="Доставка из Кореи"
              href="/#delivery"
              image="/assets/stories/delivery.png"
              position="object-center"
            />
          </div>
        </div>
      </section>

      <CatalogQuickNav />

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
        description="Реальные объявления с доступными данными и ценой до Владивостока."
        href="/catalog?fuel=electric"
        cars={electric}
        empty="Сейчас в витрине нет электромобилей с полным расчётом стоимости."
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

      <section id="how-it-works" className="border-y border-[#dce2eb] bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-5 sm:py-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-semibold text-[#956f2c]">
              Точный расчёт для РФ
            </p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">
              Цена не прячется за формой заявки
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#647084]">
              В карточке автомобиля видны итог до Владивостока, основные части
              расчёта и подробная расшифровка по кнопке.
            </p>
            <Link
              href="/catalog"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#956f2c]"
            >
              Посмотреть расчёты в каталоге <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <ValueCard
              icon={CircleDollarSign}
              title="Стоимость авто"
              text="Цена автомобиля в Корее, переведённая по расчётному курсу."
            />
            <ValueCard
              icon={Calculator}
              title="Расходы по пути"
              text="Фрахт, брокер и услуги во Владивостоке."
            />
            <ValueCard
              icon={ShieldCheck}
              title="Таможенные платежи"
              text="Пошлина, сборы и утилизационный сбор для РФ."
            />
          </div>
        </div>
      </section>

      <section
        id="delivery"
        className="scroll-mt-28 border-b border-[#dce2eb] bg-[#eef1f5]"
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-5 md:py-16">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[#956f2c]">
                Путь автомобиля
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight">
                От выбора до Владивостока
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-[#647084] lg:justify-self-end">
              Конкретные сроки, договор, способ оплаты и условия доставки
              менеджер подтверждает до оформления заявки.
            </p>
          </div>

          <ol className="mt-6 grid grid-cols-2 border-y border-[#cfd6e0] sm:mt-9 md:grid-cols-2 xl:grid-cols-4">
            <DeliveryStep
              number="01"
              icon={Search}
              title="Выбор"
              text="Фильтры, рекомендации и подробная карточка помогают найти подходящий автомобиль."
            />
            <DeliveryStep
              number="02"
              icon={FileCheck2}
              title="Проверка"
              text="Сверяем доступные данные, историю и материалы осмотра из источника."
            />
            <DeliveryStep
              number="03"
              icon={Ship}
              title="Расчёт"
              text="Показываем цену до Владивостока и расшифровываем основные статьи расходов."
            />
            <DeliveryStep
              number="04"
              icon={MapPin}
              title="Заявка"
              text="Менеджер получает выбранный автомобиль и уточняет дальнейшие условия оформления."
            />
          </ol>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-[#647084]">
              Регистрация для просмотра каталога и отправки заявки не требуется.
            </p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 rounded-md bg-[#11151d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1b3555]"
            >
              Начать подбор <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section
        id="reviews"
        className="scroll-mt-28 border-b border-[#dce2eb] bg-white"
      >
        <div className="mx-auto max-w-7xl px-5 py-14 md:py-18">
          <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[#956f2c]">
                Отзывы и истории
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">
                Место для реального опыта клиентов
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-[#647084] lg:justify-self-end">
              Раздел подготовлен для презентации. Имена, цитаты, фотографии и
              видео появятся только после получения подтверждённых материалов и
              согласия на публикацию.
            </p>
          </div>

          <div className="mt-9 grid gap-4 lg:grid-cols-[1.25fr_0.875fr_0.875fr]">
            <ReviewPlaceholder
              icon={PlayCircle}
              index="01"
              title="Видео после получения автомобиля"
              text="Здесь будет личный рассказ клиента о выборе, расчёте и результате доставки."
              tone="navy"
              featured
            />
            <ReviewPlaceholder
              icon={MessageSquareQuote}
              index="02"
              title="История подбора"
              text="Критерии поиска, выбранный автомобиль и подтверждённый отзыв без рекламного пересказа."
              tone="red"
            />
            <ReviewPlaceholder
              icon={Images}
              index="03"
              title="Фото выдачи"
              text="Фотографии автомобиля и короткий комментарий владельца после получения."
              tone="light"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#dce2eb] pt-6">
            <p className="inline-flex items-center gap-2 text-sm text-[#647084]">
              <ShieldCheck size={17} className="text-[#a98239]" />{" "}
              Неподтверждённые отзывы публиковаться не будут
            </p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#956f2c]"
            >
              Выбрать автомобиль <ArrowRight size={16} />
            </Link>
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
}: {
  image: string;
  position: string;
  title: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative aspect-[0.78] w-[132px] shrink-0 overflow-hidden rounded-[24px] bg-[#edf0f4] shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg sm:w-[200px] sm:rounded-[30px] lg:w-[230px]"
    >
      <Image src={image} alt="" fill sizes="(min-width: 1024px) 230px, (min-width: 640px) 200px, 132px" className={`object-cover transition duration-500 group-hover:scale-105 ${position}`} />
      <span className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <span className="absolute inset-x-3 bottom-3 text-sm font-bold leading-tight text-white drop-shadow-sm sm:inset-x-4 sm:bottom-4 sm:text-lg">{title}</span>
    </Link>
  );
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
    <section id={id} className="mx-auto max-w-7xl px-4 py-7 sm:px-5 sm:py-10">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#956f2c]">{eyebrow}</p>
          <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[#647084]">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#956f2c]"
        >
          Смотреть все <ArrowRight size={16} />
        </Link>
      </div>
      {cars.length ? (
        <div className="mt-5 grid items-stretch gap-3 pb-1 sm:mt-6 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {cars.map((car) => <PrototypeVehicleCard key={car.id} car={car} />)}
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

function ValueCard({
  icon: Icon,
  text,
  title,
}: {
  icon: typeof Calculator;
  text: string;
  title: string;
}) {
  return (
    <div className="rounded-md border border-[#dce2eb] p-3 sm:p-5">
      <Icon size={22} className="text-[#956f2c]" />
      <h3 className="mt-3 text-sm font-semibold sm:mt-5 sm:text-base">{title}</h3>
      <p className="mt-2 hidden text-sm leading-6 text-[#647084] sm:block">{text}</p>
    </div>
  );
}

function DeliveryStep({
  icon: Icon,
  number,
  text,
  title,
}: {
  icon: typeof Ship;
  number: string;
  text: string;
  title: string;
}) {
  return (
    <li className="relative border-b border-r border-[#cfd6e0] py-4 even:border-r-0 last:border-b-0 md:py-7 md:odd:border-r md:[&:nth-child(3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0 xl:[&:nth-child(2)]:border-b-0">
      <div className="px-3 sm:px-5 sm:first:pl-0 xl:first:pl-0">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-bold text-[#98a3b2]">{number}</span>
          <Icon size={20} className="text-[#956f2c]" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-[#101827] sm:mt-7 sm:text-lg">{title}</h3>
        <p className="mt-2 hidden text-sm leading-6 text-[#647084] sm:block">{text}</p>
      </div>
    </li>
  );
}

function ReviewPlaceholder({
  featured = false,
  icon: Icon,
  index,
  text,
  title,
  tone,
}: {
  featured?: boolean;
  icon: typeof PlayCircle;
  index: string;
  text: string;
  title: string;
  tone: "navy" | "red" | "light";
}) {
  const tones = {
    navy: "bg-[#11151d] text-white border-[#11151d]",
    red: "bg-[#c7a55a] text-[#15130f] border-[#c7a55a]",
    light: "bg-[#eef1f5] text-[#101827] border-[#dce2eb]",
  };
  const muted = tone === "light" ? "text-[#647084]" : "text-white/70";
  const line = tone === "light" ? "border-[#cfd6e0]" : "border-white/18";

  return (
    <article
      className={`flex min-h-72 flex-col overflow-hidden rounded-md border p-6 md:p-7 ${featured ? "lg:min-h-[340px]" : ""} ${tones[tone]}`}
    >
      <div
        className={`flex items-center justify-between border-b pb-5 ${line}`}
      >
        <span className={`text-xs font-bold ${muted}`}>{index}</span>
        <Icon size={featured ? 30 : 24} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <div className="mt-auto pt-10">
        <p className={`text-[11px] font-semibold uppercase ${muted}`}>
          История клиента
        </p>
        <h3
          className={`mt-3 font-semibold leading-tight ${featured ? "text-2xl md:text-3xl" : "text-xl"}`}
        >
          {title}
        </h3>
        <p className={`mt-3 text-sm leading-6 ${muted}`}>{text}</p>
      </div>
    </article>
  );
}
