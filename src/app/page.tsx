import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  CarFront,
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
  getCatalogMetrics,
  getCarDetail,
  getShowcasePhoto,
  hasShowcasePhoto,
  type CatalogCar,
} from "@/server/cars/repository";
import { carDisplayTitle, translateFuel } from "@/server/normalization/display";
import { SiteHeader } from "@/components/site/SiteHeader";
import { HeroShowroom } from "@/components/home/HeroShowroom";
import { RemoteImage } from "@/components/site/RemoteImage";

export const revalidate = 300;

const rub = new Intl.NumberFormat("ru-RU");

function snapshotResultNumber(result: unknown, key: string) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const value = (result as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

function isPassable(car: CatalogCar) {
  if (!car.year || !car.registration_month) return false;
  const registration = new Date(car.year, car.registration_month - 1, 1);
  const now = new Date();
  const ageMonths =
    (now.getFullYear() - registration.getFullYear()) * 12 +
    now.getMonth() -
    registration.getMonth();
  return ageMonths >= 36 && ageMonths < 60;
}

export default async function Home() {
  const [cars, under160Cars, passableCars, catalogMetrics] = await Promise.all([
    getCatalogCars({ limit: 24 }),
    getCatalogCars({ limit: 24, maxPowerHp: 160 }),
    getCatalogCars({ limit: 24, passable: true }),
    getCatalogMetrics(),
  ]);
  const heroCar = cars.find(hasShowcasePhoto) ?? cars[0];
  const usedCarIds = new Set(heroCar ? [heroCar.id] : []);
  const under160 = selectShelfCars(
    under160Cars.filter(hasShowcasePhoto),
    usedCarIds,
  );
  const passable = selectShelfCars(
    passableCars.filter((car) => hasShowcasePhoto(car) && isPassable(car)),
    usedCarIds,
  );
  const heroDetail = heroCar
    ? await getCarDetail(heroCar.primary_source, heroCar.source_id)
    : null;
  const heroImage = heroDetail
    ? getShowcasePhoto(heroDetail)
    : heroCar
      ? getShowcasePhoto(heroCar)
      : null;
  const heroCalc = heroDetail?.calc_snapshots?.[0];
  const heroDomesticCosts =
    (heroCalc?.freight_rub ?? 0) + (heroCalc?.broker_rub ?? 0);
  const heroCustomsCosts =
    (heroCalc?.duty_rub ?? 0) +
    snapshotResultNumber(heroCalc?.result, "exciseRub") +
    snapshotResultNumber(heroCalc?.result, "vatRub") +
    (heroCalc?.fees_rub ?? 0) +
    (heroCalc?.util_rub ?? 0);

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-[#101827]">
      <SiteHeader />

      <HeroShowroom
        carHref={
          heroCar
            ? `/cars/${heroCar.primary_source}/${heroCar.source_id}`
            : null
        }
        carTitle={heroCar ? carDisplayTitle(heroCar) : "Автомобиль из Кореи"}
        imageUrl={heroImage}
        metrics={catalogMetrics}
        priceSteps={[
          { label: "Автомобиль", value: heroCalc?.car_price_rub ?? null },
          { label: "Корея и доставка", value: heroDomesticCosts || null },
          { label: "Таможня и сборы", value: heroCustomsCosts || null },
          {
            label: "Итого",
            value: heroCalc?.total_rub ?? heroCar?.price_rub ?? null,
          },
        ]}
        sourceUpdatedAt={heroCar?.source_updated_at ?? null}
        totalPriceRub={heroCalc?.total_rub ?? heroCar?.price_rub ?? null}
      />

      <VehicleShelf
        id="under-160"
        title="Рекомендации до 160 л.с."
        description="Автомобили с доступной мощностью и уже рассчитанной стоимостью до Владивостока."
        href="/catalog?shelf=under-160"
        cars={under160}
        empty="В текущей витрине ещё нет подходящих автомобилей."
      />

      <VehicleShelf
        id="passable"
        title="Проходные автомобили 3-5 лет"
        description="Витрина строится по месяцу первой регистрации, а не по условному году выпуска."
        href="/catalog?shelf=passable"
        cars={passable}
        empty="В текущем импорте нет автомобилей в этом возрастном диапазоне."
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
    </main>
  );
}

function VehicleShelf({
  cars,
  description,
  empty,
  href,
  id,
  title,
}: {
  cars: CatalogCar[];
  description: string;
  empty: string;
  href: string;
  id: string;
  title: string;
}) {
  return (
    <section id={id} className="mx-auto max-w-7xl px-4 py-7 sm:px-5 sm:py-10">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
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
        <div className="scrollbar-none mt-5 flex snap-x gap-3 overflow-x-auto pb-1 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible xl:grid-cols-4">
          {cars.map((car) => (
            <HomeCarCard key={car.id} car={car} />
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

function HomeCarCard({ car }: { car: CatalogCar }) {
  const photo = getShowcasePhoto(car);
  return (
    <Link
      href={`/cars/${car.primary_source}/${car.source_id}`}
      className="group w-[78vw] max-w-[300px] shrink-0 snap-start overflow-hidden rounded-md bg-white ring-1 ring-[#dce2eb] transition hover:-translate-y-0.5 hover:shadow-md sm:w-auto sm:max-w-none"
    >
      <div className="relative aspect-[4/3] bg-[#e9edf3]">
        {photo ? (
          <RemoteImage
            src={photo}
            alt={carDisplayTitle(car)}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
            fallback={<CarFront size={34} />}
          />
        ) : (
          <CarFront
            className="absolute inset-0 m-auto text-[#8a96a8]"
            size={34}
          />
        )}
        <div className="absolute left-3 top-3 flex gap-2">
          {car.accident_count === 0 ? (
            <span className="rounded-sm bg-[#e8f5ef] px-2 py-1 text-xs font-semibold text-[#18794e]">
              Без ДТП
            </span>
          ) : null}
          {car.insurance_payout_count != null && car.insurance_payout_count > 0 ? (
            <span className="rounded-sm bg-[#fff2e5] px-2 py-1 text-xs font-semibold text-[#9a5b1c]">
              Страховые выплаты: {car.insurance_payout_count}
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 min-h-12 text-base font-semibold group-hover:text-[#956f2c]">
          {carDisplayTitle(car)}
        </h3>
        <p className="mt-2 text-sm text-[#647084]">
          {car.year ?? "-"} год · {rub.format(car.mileage_km ?? 0)} км
        </p>
        <div className="mt-4 flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-[#647084]">до Владивостока</p>
            <p className="whitespace-nowrap text-xl font-semibold tabular-nums">
              {rub.format(car.price_rub ?? 0)}{"\u00A0"}₽
            </p>
          </div>
          <p className="text-xs text-[#647084]">
            {car.power_hp ?? "-"} л.с.
            <br />
            {translateFuel(car.fuel_type)}
          </p>
        </div>
      </div>
    </Link>
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
