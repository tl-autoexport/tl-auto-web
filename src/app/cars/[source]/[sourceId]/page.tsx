import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  CarFront,
  Check,
  ChevronDown,
  ClipboardCheck,
  KeyRound,
  Minus,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getCarDetail,
  getShowcasePhoto,
} from "@/server/cars/repository";
import {
  carDisplayTitle,
  translateHeyDealerNote,
  translateHeyDealerText,
  translateConditionDescription,
  translateConditionLabel,
  translateFuel,
  translateOption,
  translateTransmission,
} from "@/server/normalization/display";
import { CarMediaShowcase } from "./CarMediaShowcase";
import { InspectionPhotoGallery } from "./InspectionPhotoGallery";
import type { ThermalEntry, ThermalReference } from "./thermalTypes";
import { PriceCalculationCard } from "./PriceCalculationCard";
import { SiteHeader } from "@/components/site/SiteHeader";
import { formatEngineCapacity, formatVehicleYear } from "@/lib/vehicle-format";

const rub = new Intl.NumberFormat("ru-RU");
const getCachedCarDetail = cache(getCarDetail);

function won(value: number) {
  return `${rub.format(value)}\u00A0₩`;
}

type CarDetailPageProps = {
  params: Promise<{ source: string; sourceId: string }>;
};

export async function generateMetadata({
  params,
}: CarDetailPageProps): Promise<Metadata> {
  const { source, sourceId } = await params;
  const car = await getCachedCarDetail(source, sourceId);

  if (!car) {
    return {
      title: "Автомобиль не найден",
      robots: { index: false, follow: false },
    };
  }

  const title = carDisplayTitle(car);
  const details = [
    car.year ? formatVehicleYear(car.year) : null,
    car.mileage_km ? `${rub.format(car.mileage_km)} км` : null,
    car.power_hp ? `${car.power_hp} л.с.` : null,
    car.price_rub
      ? `${rub.format(car.price_rub)} ₽ до Владивостока`
      : null,
  ].filter(Boolean);
  const description = `${title}: ${details.join(", ")}. Фотографии, характеристики, история и расчёт стоимости для России.`;
  const canonical = `/cars/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`;
  const photo = getShowcasePhoto(car);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      images: photo ? [{ url: photo, alt: title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: photo ? [photo] : undefined,
    },
  };
}

export default async function CarDetailPage({
  params,
}: CarDetailPageProps) {
  const { source, sourceId } = await params;
  const car = await getCachedCarDetail(source, sourceId);
  if (!car) notFound();

  const calc = car.calc_snapshots?.[0];
  const title = carDisplayTitle(car);
  const optionGroups = buildOptionGroups(car.car_options ?? []);
  const inspectionGroups = buildInspectionGroups(
    car.car_condition_reports ?? [],
  );
  const conditionItems = buildConditionItems(car.car_condition_reports ?? []);
  const eyeReport = getEyeReport(car.car_condition_reports ?? []);
  const carHistory = getCarHistory(car.car_condition_reports ?? []);
  const imageMedia = (car.car_media ?? []).filter(
    (media) => media.media_type === "image",
  );
  const thermalMedia = imageMedia.filter(
    (media) =>
      media.category?.startsWith("thermal_") &&
      media.category !== "thermal_reference",
  );
  const thermalReferenceMedia = imageMedia.filter(
    (media) => media.category === "thermal_reference",
  );
  const inspectionRecordMedia = imageMedia.filter(
    (media) => media.category === "inspection_record",
  );
  const inspectionImages = imageMedia.filter(
    (media) => media.category === "encar_inspection_document",
  );
  const actionMedia = (car.car_media ?? []).filter(
    (media) => media.media_type === "panorama" || media.media_type === "video",
  );
  const galleryMedia = imageMedia.filter(
    (media) =>
      !media.category?.startsWith("thermal_") &&
      media.category !== "thermal_reference" &&
      media.category !== "underbody" &&
      media.category !== "inspection_record" &&
      media.category !== "encar_inspection_document" &&
      media.category !== "exterior_360_thumbnail",
  );

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#121722]">
      <SiteHeader />

      <section className="mx-auto flex max-w-7xl flex-col gap-4 px-3 pb-24 pt-4 sm:gap-6 sm:px-5 sm:py-6 lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:grid lg:min-w-0 lg:gap-6">
          <div className="order-1 min-w-0 lg:order-none">
            <CarMediaShowcase
              actions={actionMedia}
              badges={[
                ...(car.accident_count === 0 ? ["Без ДТП"] : []),
                ...(car.insurance_payout_count != null && car.insurance_payout_count > 0
                  ? [`Страховые выплаты: ${car.insurance_payout_count}`]
                  : []),
              ]}
              images={galleryMedia.length ? galleryMedia : imageMedia}
              title={title}
            />
          </div>

          <div className="order-3 grid min-w-0 gap-4 sm:gap-6 lg:order-none [&>*]:min-w-0">
            <div className="rounded bg-white p-4 shadow-sm ring-1 ring-[#d8dde6] sm:p-5">
              <div className="flex items-center gap-2">
                <CarFront className="text-[#a98239]" size={20} />
                <h2 className="text-lg font-semibold sm:text-xl">Общие данные</h2>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
                <KeyFact
                  label="Год регистрации"
                  value={formatYearMonth(car.year, car.registration_month)}
                />
                <KeyFact
                  label="Пробег"
                  value={
                    car.mileage_km ? `${rub.format(car.mileage_km)} км` : "-"
                  }
                />
                <KeyFact
                  label="Двигатель"
                  value={formatEngineCapacity(car.engine_cc)}
                />
                <KeyFact
                  label="Мощность"
                  value={car.power_hp ? `${car.power_hp} л.с.` : "-"}
                />
              </div>
              <div className="mt-3 grid gap-2.5 text-[13px] sm:mt-4 sm:gap-3 sm:text-sm">
                <Spec label="Топливо" value={translateFuel(car.fuel_type)} />
                <Spec
                  label="КПП"
                  value={translateTransmission(car.transmission)}
                />
                <Spec label="Привод" value={car.drive_type ?? "-"} />
                <Spec label="Цвет" value={car.color ?? "-"} />
              </div>
            </div>

            <ConditionOverview
              car={car}
              carHistory={carHistory}
              conditionItems={conditionItems}
              eyeReport={eyeReport}
              reports={car.car_condition_reports ?? []}
            />

            {inspectionImages.length > 0 && (
              <InspectionPhotoGallery media={inspectionImages} title={title} />
            )}

            {inspectionGroups.length > 0 && (
              <EncarInspection groups={inspectionGroups} />
            )}

            <div className="rounded bg-white p-5 shadow-sm ring-1 ring-[#d8dde6]">
              <div className="flex items-center gap-2">
                <KeyRound className="text-[#a98239]" size={20} />
                <h2 className="text-xl font-semibold">Комплектация</h2>
              </div>
              <EncarEquipmentAccordion groups={optionGroups} />
            </div>
          </div>
        </div>

        <div className="order-2 min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:self-start">
          <PriceCalculationCard
            calc={calc}
            engineCc={car.engine_cc}
            fuel={translateFuel(car.fuel_type)}
            mileageKm={car.mileage_km}
            powerHp={car.power_hp}
            priceKrw={car.price_krw}
            source={source}
            sourceId={sourceId}
            title={title}
            year={car.year}
            registrationMonth={car.registration_month}
          />
        </div>
      </section>
    </main>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-7 items-start justify-between gap-3 border-b border-dashed border-[#cbd3df] pb-2">
      <span className="text-[#647084]">{label}</span>
      <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function KeyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-[#f7f9fb] px-3 py-2.5 ring-1 ring-[#e8ecf2]">
      <span className="block truncate text-[11px] text-[#647084] sm:text-xs">{label}</span>
      <strong className="mt-1 block truncate text-sm font-semibold tabular-nums sm:text-base">{value}</strong>
    </div>
  );
}

function formatHeyDealerMeasurement(value: string) {
  const number = Number.parseFloat(value.replaceAll(",", ""));
  if (!Number.isFinite(number)) return value;
  if (/km\/ℓ/i.test(value)) {
    return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км/л`;
  }
  if (/mm/i.test(value)) return `${rub.format(Math.round(number))} мм`;
  return value;
}

function OptionStatusIcon({ present }: { present: boolean | null }) {
  if (present === true) {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#956f2c] text-white">
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  if (present === false) {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#edf0f4] text-[#a9b0bc]">
        <X size={13} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#fff4d8] text-[#a56b00]">
      <Minus size={13} strokeWidth={2.5} />
    </span>
  );
}

function HeyDealerEquipmentSummary({
  details,
  groups,
}: {
  details: HeyDealerDetails;
  groups: ReturnType<typeof buildOptionGroups>;
}) {
  const installedGroups = groups
    .map((group) => ({
      title: heyDealerGroupTitle(group.title),
      items: group.items.filter((item) => item.present === true),
    }))
    .filter((group) => group.items.length > 0);
  const installedCount = installedGroups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  const hasContent = installedCount > 0 || details.hasFactoryContent;

  if (!hasContent) {
    return (
      <div className="mt-5 flex items-center gap-3 text-sm text-[#647084]">
        <ShieldAlert size={18} />
        Данные о комплектации отсутствуют в источнике.
      </div>
    );
  }

  return (
    <div className="mt-5">
      {installedCount > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-[#5f6c80]">Основные опции</span>
            <span className="h-px flex-1 border-t border-dashed border-[#b8c0cd]" />
            <strong className="text-lg text-[#121722]">{installedCount}</strong>
          </div>

          <div className="mt-6 grid gap-x-12 gap-y-7 sm:grid-cols-2">
            {installedGroups.map((group) => (
              <section key={group.title}>
                <h3 className="text-base font-semibold text-[#242b37]">
                  {group.title}
                </h3>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-[#3a4353]">
                  {group.items.map((item) => (
                    <li
                      className="flex items-start gap-2.5"
                      key={`${group.title}-${item.name}`}
                    >
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#121722]" />
                      <span>{item.name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {(details.factoryDescription.length > 0 ||
        details.packages.length > 0) && (
        <div className="mt-7 border-t border-[#e3e7ee] pt-6">
          <h3 className="text-base font-semibold text-[#242b37]">
            Заводская комплектация
          </h3>
          {details.factoryDescription.length > 0 && (
            <EquipmentTextList
              className="mt-3"
              items={details.factoryDescription}
            />
          )}
          {details.packages.map((item) => (
            <div className="mt-5" key={`${item.name}-${item.items.join("-")}`}>
              <h4 className="text-sm font-semibold text-[#242b37]">
                {item.name}
              </h4>
              <EquipmentTextList className="mt-3" items={item.items} />
            </div>
          ))}
        </div>
      )}

      {details.recommendations.length > 0 && (
        <div className="mt-7 rounded bg-[#f3f5f8] p-4 md:p-5">
          <h3 className="text-sm font-semibold text-[#242b37]">
            Почему автомобиль рекомендуют
          </h3>
          <EquipmentTextList className="mt-3" items={details.recommendations} />
        </div>
      )}

      {details.inspectorNotes.length > 0 && (
        <div className="mt-5 border-l-2 border-[#a98239] bg-[#f7fbfa] px-4 py-3">
          <h3 className="text-sm font-semibold text-[#242b37]">
            Комментарий инспектора
          </h3>
          <EquipmentTextList className="mt-2" items={details.inspectorNotes} />
        </div>
      )}
    </div>
  );
}

function heyDealerGroupTitle(title: string) {
  const labels: Record<string, string> = {
    "Экстерьер и интерьер": "Интерьер и экстерьер",
    "Комфорт и мультимедиа": "Мультимедиа и комфорт",
  };
  return labels[title] ?? title;
}

function EquipmentTextList({
  className,
  items,
}: {
  className?: string;
  items: string[];
}) {
  return (
    <ul
      className={`grid gap-2 text-sm leading-6 text-[#3a4353] ${className ?? ""}`}
    >
      {items.map((item, index) => (
        <li className="flex items-start gap-2.5" key={`${item}-${index}`}>
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#a98239]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function EncarEquipmentAccordion({
  groups,
}: {
  groups: ReturnType<typeof buildOptionGroups>;
}) {
  if (!groups.length) {
    return (
      <div className="mt-5 flex items-center gap-3 text-sm text-[#647084]">
        <ShieldAlert size={18} />
        Данные о комплектации отсутствуют в источнике.
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-2">
      {groups.map((group) => (
        <details
          className="group overflow-hidden rounded border border-[#e3e7ee] bg-[#fafbfc]"
          key={group.title}
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#242b37]">
                {group.title}
              </span>
              <span className="mt-0.5 block text-xs text-[#7b8596]">
                {group.presentCount} установлено
                {group.absentCount > 0
                  ? ` · не установлено: ${group.absentCount}`
                  : ""}
                {group.unknownCount > 0
                  ? ` · ${group.unknownCount} не подтверждено`
                  : ""}
              </span>
            </span>
            <ChevronDown
              className="shrink-0 text-[#7b8596] transition-transform duration-200 group-open:rotate-180"
              size={18}
            />
          </summary>
          <div className="grid gap-x-7 gap-y-3 border-t border-[#e3e7ee] bg-white px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((option) => (
              <div
                className={`flex min-h-8 items-start gap-2.5 text-sm leading-5 ${option.present === true ? "text-[#242b37]" : "text-[#8a94a3]"}`}
                key={`${group.title}-${option.name}`}
              >
                <OptionStatusIcon present={option.present} />
                <span>
                  {option.name}
                  <span className="block text-xs text-[#7b8596]">
                    {option.present === true
                      ? "Установлено"
                      : option.present === false
                        ? "Не установлено"
                        : "Статус не подтверждён источником"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function ConditionOverview({
  car,
  carHistory,
  conditionItems,
  eyeReport,
  reports,
}: {
  car: {
    owners_count: number | null;
    accident_count: number | null;
    insurance_payout_count: number | null;
    insurance_payout_total_krw: number | null;
  };
  carHistory: Record<string, unknown> | null;
  conditionItems: Array<{ label: string; description: string | null }>;
  eyeReport: Record<string, unknown> | null;
  reports: Array<{ report_type: string; raw_payload?: unknown }>;
}) {
  const accident = getObject(eyeReport?.accident);
  const exchangeCount = asNumber(accident?.outer_panel_exchange_count);
  const weldCount = asNumber(accident?.outer_panel_weld_count);
  const bodyMarks = buildBodyMarks(eyeReport, reports);
  const insuranceEvents = buildInsuranceEvents(carHistory);
  const ownerCount =
    asNumber(carHistory?.owner_changed_count) ?? car.owners_count;
  const accidentCount =
    asNumber(carHistory?.my_car_accident_count) ?? car.accident_count;
  const payoutTotal =
    asNumber(carHistory?.my_car_accident_cost) ??
    car.insurance_payout_total_krw;
  const payoutCount = insuranceEvents.length || car.insurance_payout_count;
  const nonInsurancePeriods = Array.isArray(
    carHistory?.nonInsurancePeriodResponse,
  )
    ? carHistory.nonInsurancePeriodResponse.length
    : null;

  return (
    <div className="rounded bg-white p-4 shadow-sm ring-1 ring-[#d8dde6] sm:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-[#a98239]" size={20} />
        <h2 className="text-lg font-semibold sm:text-xl">История и состояние кузова</h2>
      </div>
      <div className="mt-4 grid gap-4 sm:gap-5">
        <BodyConditionMap marks={bodyMarks} insuranceEvents={insuranceEvents} />
        <div className="grid content-start gap-x-6 gap-y-3 text-sm md:grid-cols-2">
          <Spec
            label="Владельцы"
            value={ownerCount ? String(ownerCount) : "Нет данных"}
          />
          <Spec
            label="Страховые случаи"
            value={
              accidentCount !== null ? String(accidentCount) : "Нет данных"
            }
          />
          <Spec
            label="Страховые выплаты"
            value={
              payoutTotal !== null
                ? won(payoutTotal)
                : "Нет данных"
            }
          />
          <Spec
            label="Кол-во выплат"
            value={payoutCount !== null ? String(payoutCount) : "Нет данных"}
          />
          {nonInsurancePeriods !== null && (
            <Spec
              label="Периоды без страхового покрытия"
              value={String(nonInsurancePeriods)}
            />
          )}
          <Spec
            label="Замена внешних панелей"
            value={
              exchangeCount !== null ? String(exchangeCount) : "Нет данных"
            }
          />
          <Spec
            label="Ремонт/сварка панелей"
            value={weldCount !== null ? String(weldCount) : "Нет данных"}
          />
          {conditionItems.map((item) => (
            <div className="border-t border-[#edf0f5] pt-3" key={item.label}>
              <p className="font-semibold">{item.label}</p>
              {item.description && (
                <p className="mt-1 text-[#647084]">{item.description}</p>
              )}
            </div>
          ))}
        </div>
        {nonInsurancePeriods !== null && nonInsurancePeriods > 0 && (
          <div className="flex items-start gap-3 rounded bg-[#fff8e6] p-3 text-sm text-[#7a5411] ring-1 ring-[#f0d28a]">
            <ShieldAlert className="mt-0.5 shrink-0" size={18} />
            <p>
              Encar зафиксировал периоды без страхового покрытия. События,
              произошедшие в эти даты, могли не попасть в страховую историю.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

type BodyMark = {
  code: "X" | "W" | "C" | "A" | "U" | "T";
  label: string;
  part: string;
  x: number;
  y: number;
};

function BodyConditionMap({
  insuranceEvents,
  marks,
}: {
  insuranceEvents: InsuranceEvent[];
  marks: BodyMark[];
}) {
  const byCode = new Map<string, BodyMark[]>();
  for (const mark of marks)
    byCode.set(mark.code, [...(byCode.get(mark.code) ?? []), mark]);

  return (
    <div className="rounded bg-white p-3 ring-1 ring-[#edf0f5] sm:p-4">
      <div className="mx-auto grid w-full max-w-[760px] grid-cols-2 items-start gap-1 rounded bg-white pt-1 sm:gap-3 sm:px-2">
        <div className="relative aspect-[1456/1364] overflow-hidden rounded bg-white">
          <Image
            alt=""
            className="object-contain"
            fill
            sizes="(min-width: 1024px) 380px, 50vw"
            src="/assets/body-condition-top.png"
          />
          {marks.map((mark) => (
            <span
              className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-[0_2px_6px_rgba(15,23,42,0.16)] ring-1 ring-white sm:h-6 sm:w-6 sm:text-xs md:h-7 md:w-7 md:text-sm ${markColor(mark.code)}`}
              key={`${mark.code}-${mark.part}-${mark.x}-${mark.y}`}
              style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
              title={mark.label}
            >
              {mark.code}
            </span>
          ))}
        </div>
        <div className="relative aspect-[1456/1364] overflow-hidden rounded bg-white">
          <Image
            alt=""
            className="object-contain"
            fill
            sizes="(min-width: 1024px) 380px, 50vw"
            src="/assets/body-condition-bottom.png"
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] font-semibold text-[#647084] sm:mt-4 sm:flex sm:flex-wrap sm:gap-x-4 sm:text-xs">
        <Legend code="X" label="замена" />
        <Legend code="W" label="ремонт" />
        <Legend code="C" label="коррозия" />
        <Legend code="A" label="царапина" />
        <Legend code="U" label="неровность" />
        <Legend code="T" label="повреждение" />
      </div>

      {!marks.length && (
        <p className="mt-3 rounded bg-[#fbfcfe] px-3 py-2 text-xs text-[#647084] ring-1 ring-[#edf0f5] sm:mt-4 sm:text-sm">
          В отчёте Encar нет данных о повреждениях кузова для выделения на схеме.
        </p>
      )}

      <div className="mt-3 divide-y divide-[#edf0f5] rounded bg-[#fbfcfe] ring-1 ring-[#edf0f5] sm:mt-4">
        <DamageDetails
          code="X"
          items={byCode.get("X") ?? []}
          title="Замена деталей"
        />
        <DamageDetails
          code="W"
          items={byCode.get("W") ?? []}
          title="Ремонт деталей"
        />
        <DamageDetails
          code="T"
          items={byCode.get("T") ?? []}
          title="Следы окраса/повреждений"
        />
        {insuranceEvents.length > 0 && (
          <InsuranceDetails events={insuranceEvents} />
        )}
      </div>
    </div>
  );
}

function InsuranceDetails({ events }: { events: InsuranceEvent[] }) {
  const total = events.reduce((sum, event) => sum + event.amount, 0);
  return (
    <details className="group p-2.5 sm:p-3">
      <summary className="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[13px] font-semibold sm:gap-3 sm:text-sm">
        <span className="leading-4">Детализация страховых выплат</span>
        <span className="whitespace-nowrap text-right text-[12px] text-[#647084] tabular-nums sm:text-sm">
          {won(total)}
        </span>
        <ChevronDown className="size-4 shrink-0 text-[#647084] transition group-open:rotate-180" />
      </summary>
      <div className="mt-2.5 grid gap-2.5 sm:mt-3 sm:gap-3">
        {events.map((event, index) => (
          <div
            className="rounded bg-white p-3 ring-1 ring-[#edf0f5]"
            key={`${event.date}-${index}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold tabular-nums">{event.date}</p>
                <p className="mt-1 text-xs text-[#647084]">{event.kind}</p>
              </div>
              <p className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">{won(event.amount)}</p>
            </div>
            <div className="mt-2.5 grid gap-1.5 text-xs text-[#647084]">
              <Spec
                label="Запчасти"
                value={
                  event.component ? won(event.component) : "-"
                }
              />
              <Spec
                label="Окрас"
                value={event.painting ? won(event.painting) : "-"}
              />
              <Spec
                label="Работы"
                value={event.wage ? won(event.wage) : "-"}
              />
            </div>
            {event.operations.length > 0 && (
              <details className="mt-3 rounded bg-[#fbfcfe] p-3 text-xs leading-5 text-[#3a4353] ring-1 ring-[#edf0f5]">
                <summary className="cursor-pointer list-none font-semibold text-[#121722]">
                  Что указано в расчёте
                </summary>
                <ul className="mt-2 grid gap-1">
                  {event.operations.map((operation) => (
                    <li className="flex gap-2" key={operation}>
                      <span className="text-[#956f2c]">•</span>
                      <span>{operation}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function DamageDetails({
  code,
  items,
  title,
}: {
  code: BodyMark["code"];
  items: BodyMark[];
  title: string;
}) {
  if (!items.length) return null;
  return (
    <details className="group p-2.5 sm:p-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold sm:text-sm">
        <span className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${markColor(code)}`}
          >
            {code}
          </span>
          {title}
        </span>
        <span className="flex items-center gap-3 text-[#647084]">
          {items.length}
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        {items.map((mark) => (
          <span
            className="flex items-center justify-between gap-3 rounded bg-white px-3 py-2 text-sm ring-1 ring-[#edf0f5]"
            key={`${code}-${mark.part}`}
          >
            <span>{mark.label}</span>
            <span className={`h-2 w-2 rounded-full ${markColor(code)}`} />
          </span>
        ))}
      </div>
    </details>
  );
}

function Legend({ code, label }: { code: BodyMark["code"]; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${markColor(code)}`}
      >
        {code}
      </span>
      {label}
    </span>
  );
}

type OptionRow = {
  category: string | null;
  name_original: string | null;
  name_ru: string | null;
  value_original: string | null;
  value_ru: string | null;
  is_present: boolean | null;
  sort_order: number;
};

type OptionView = {
  name: string;
  present: boolean | null;
  value: string | null;
};

const OPTION_GROUP_ORDER = [
  "Экстерьер и интерьер",
  "Безопасность",
  "Комфорт и мультимедиа",
  "Сиденья",
  "Дополнительные опции",
  "Другое",
];

function buildOptionGroups(rows: OptionRow[]) {
  const groups = new Map<string, OptionView[]>();
  const seen = new Set<string>();

  for (const option of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    const name = option.name_ru ?? translateOption(option.name_original);
    if (!name) continue;
    const category = option.category || "Другое";
    const key = `${category}:${name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.set(category, [
      ...(groups.get(category) ?? []),
      {
        name,
        present: option.is_present,
        value: option.value_ru ?? translateOption(option.value_original),
      },
    ]);
  }

  return [
    ...OPTION_GROUP_ORDER,
    ...[...groups.keys()].filter(
      (group) => !OPTION_GROUP_ORDER.includes(group),
    ),
  ]
    .map((title) => {
      const items = groups.get(title) ?? [];
      return {
        title,
        items,
        presentCount: items.filter((item) => item.present === true).length,
        absentCount: items.filter((item) => item.present === false).length,
        unknownCount: items.filter((item) => item.present === null).length,
      };
    })
    .filter((group) => group.items.length > 0);
}

type InspectionItem = {
  label: string;
  status: string;
  statusCode: string | null;
};

type InspectionGroup = {
  title: string;
  items: InspectionItem[];
};

function buildInspectionGroups(
  reports: Array<{ report_type: string; items: unknown }>,
): InspectionGroup[] {
  const report = reports.find(
    (item) => item.report_type === "encar_inspection",
  );
  if (!Array.isArray(report?.items)) return [];

  return report.items
    .map((node) => {
      const record = getObject(node);
      if (!record) return null;
      const title =
        typeof record.label_ru === "string" ? record.label_ru : null;
      const items = flattenInspectionItems(record.children);
      if (!title || !items.length) return null;
      return { title, items };
    })
    .filter((group): group is InspectionGroup => Boolean(group));
}

function flattenInspectionItems(value: unknown): InspectionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((node) => {
    const record = getObject(node);
    if (!record) return [];
    const nested = flattenInspectionItems(record.children);
    const label = typeof record.label_ru === "string" ? record.label_ru : null;
    const status =
      typeof record.status_ru === "string" ? record.status_ru : null;
    const current =
      label && status
        ? [
            {
              label,
              status,
              statusCode:
                record.status_code !== null && record.status_code !== undefined
                  ? String(record.status_code)
                  : null,
            },
          ]
        : [];
    return [...current, ...nested];
  });
}

function EncarInspection({ groups }: { groups: InspectionGroup[] }) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <div className="rounded bg-white p-5 shadow-sm ring-1 ring-[#d8dde6]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="text-[#a98239]" size={20} />
          <div>
            <h2 className="text-xl font-semibold">Внутренний осмотр</h2>
            <p className="mt-1 text-sm text-[#647084]">
              Результаты проверки, опубликованные Encar
            </p>
          </div>
        </div>
        <span className="rounded bg-[#eef8f5] px-2.5 py-1 text-xs font-semibold text-[#27866f]">
          {total} пунктов
        </span>
      </div>
      <div className="mt-5 divide-y divide-[#edf0f5] border-y border-[#edf0f5]">
        {groups.map((group) => (
          <details className="group py-1" key={group.title}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm font-semibold">
              <span>{group.title}</span>
              <span className="flex items-center gap-3 text-xs font-normal text-[#7b8596]">
                {group.items.length}
                <span className="text-lg leading-none transition group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <div className="grid gap-x-8 pb-4 sm:grid-cols-2">
              {group.items.map((item, index) => (
                <div
                  className="flex items-center justify-between gap-4 border-t border-[#f0f2f5] py-2.5 text-sm"
                  key={`${item.label}-${index}`}
                >
                  <span className="text-[#5d687a]">{item.label}</span>
                  <span
                    className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${inspectionStatusClass(item.statusCode, item.status)}`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function inspectionStatusClass(statusCode: string | null, status: string) {
  const normalized = status.toLowerCase();
  const positive =
    ["1", "2", "3"].includes(statusCode ?? "") ||
    ["исправно", "норма", "нет"].includes(normalized);
  return positive
    ? "bg-[#eaf8f1] text-[#25805f]"
    : "bg-[#fff0f1] text-[#c82c38]";
}

function formatYearMonth(year: number | null, month: number | null) {
  if (!year) return "-";
  if (!month) return formatVehicleYear(year);
  return `${String(month).padStart(2, "0")}.${year}`;
}

function buildConditionItems(
  reports: Array<{ report_type: string; items: unknown; summary: unknown }>,
) {
  const condition = reports.find(
    (report) => report.report_type === "condition",
  );
  const items = Array.isArray(condition?.items) ? condition.items : [];
  return items
    .map((item) => {
      const record =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const label = translateConditionLabel(String(record.label ?? ""));
      if (!label) return null;
      return {
        label,
        description: translateConditionDescription(
          String(record.description ?? ""),
        ),
      };
    })
    .filter((item): item is { label: string; description: string | null } =>
      Boolean(item),
    )
    .slice(0, 5);
}

function buildInspectionRecordImages(
  reports: Array<{ report_type: string; raw_payload?: unknown }>,
  media: Array<{
    url: string;
    thumbnail_url: string | null;
    category: string | null;
  }>,
) {
  const eye = reports.find((report) => report.report_type === "heydealer_eye");
  const raw = getObject(eye?.raw_payload);
  const inspectionRecords = getObject(raw?.inspection_records);
  const rawImages = Array.isArray(inspectionRecords?.images)
    ? inspectionRecords.images
    : [];
  const fromReport = rawImages
    .map((item) => {
      const record = getObject(item);
      if (!record) return null;
      const url = typeof record?.url === "string" ? record.url : null;
      if (!url) return null;
      return {
        url,
        width: asNumber(record.width),
        height: asNumber(record.height),
      };
    })
    .filter(
      (
        item,
      ): item is { url: string; width: number | null; height: number | null } =>
        Boolean(item),
    );

  if (fromReport.length > 0) return fromReport;

  return media.map((item) => ({
    url: item.thumbnail_url ?? item.url,
    width: null,
    height: null,
  }));
}

type HeyDealerDetails = {
  technical: {
    efficiency: string | null;
    length: string | null;
    width: string | null;
    factoryPriceKrw: number | null;
  };
  factoryDescription: string[];
  packages: Array<{ name: string; items: string[] }>;
  inspectorNotes: string[];
  recommendations: string[];
  hasFactoryContent: boolean;
};

function buildHeyDealerDetails(
  reports: Array<{ report_type: string; summary?: unknown }>,
): HeyDealerDetails {
  const report = reports.find(
    (item) => item.report_type === "source_description",
  );
  const summary = getObject(report?.summary);
  const technical = getObject(summary?.technical_specs);
  const carSpec = getObject(summary?.car_spec);
  const factoryDescription = translateHeyDealerNote(
    typeof carSpec?.description === "string" ? carSpec.description : null,
  );
  const rawPackages = Array.isArray(carSpec?.option_packages)
    ? carSpec.option_packages
    : [];
  const packages = rawPackages
    .map((item) => {
      const record = getObject(item);
      const rawName = typeof record?.name === "string" ? record.name : null;
      const translatedName = translateHeyDealerText(rawName);
      const items = Array.isArray(record?.detail_items)
        ? record.detail_items
            .map((entry) =>
              translateHeyDealerText(typeof entry === "string" ? entry : null),
            )
            .filter((entry): entry is string => Boolean(entry))
        : [];
      if (!translatedName || !items.length) return null;
      return {
        name: translatedName.startsWith("Пакет")
          ? translatedName
          : `Пакет «${translatedName}»`,
        items,
      };
    })
    .filter((item): item is { name: string; items: string[] } => Boolean(item));

  const inspectorNotes = [
    ...translateHeyDealerNote(
      typeof summary?.inspector_comment === "string"
        ? summary.inspector_comment
        : null,
    ),
    ...translateHeyDealerNote(
      typeof summary?.customer_comment === "string"
        ? summary.customer_comment
        : null,
    ),
  ].filter((item, index, all) => all.indexOf(item) === index);
  const recommendations = translateHeyDealerNote(
    typeof summary?.recommendation_comment === "string"
      ? summary.recommendation_comment
      : null,
  );

  return {
    technical: {
      efficiency:
        typeof technical?.efficiency === "string" ? technical.efficiency : null,
      length: typeof technical?.length === "string" ? technical.length : null,
      width: typeof technical?.width === "string" ? technical.width : null,
      factoryPriceKrw: asNumber(technical?.factory_price_krw),
    },
    factoryDescription,
    packages,
    inspectorNotes,
    recommendations,
    hasFactoryContent:
      factoryDescription.length > 0 ||
      packages.length > 0 ||
      inspectorNotes.length > 0 ||
      recommendations.length > 0,
  };
}

function getEyeReport(
  reports: Array<{ report_type: string; raw_payload?: unknown }>,
) {
  const eye = reports.find((report) => report.report_type === "heydealer_eye");
  const raw = getObject(eye?.raw_payload);
  return getObject(raw?.eye_report);
}

function getCarHistory(
  reports: Array<{
    report_type: string;
    summary?: unknown;
    raw_payload?: unknown;
  }>,
) {
  const history = reports.find((report) => report.report_type === "carhistory");
  if (history)
    return getObject(history.summary) ?? getObject(history.raw_payload);
  const encarHistory = reports.find(
    (report) => report.report_type === "encar_carhistory",
  );
  return (
    getObject(encarHistory?.raw_payload) ?? getObject(encarHistory?.summary)
  );
}

function buildInsuranceEvents(carHistory: Record<string, unknown> | null) {
  const ownEvents = Array.isArray(carHistory?.my_car_accident_list)
    ? carHistory.my_car_accident_list
    : [];
  const otherEvents = Array.isArray(carHistory?.other_car_accident_list)
    ? carHistory.other_car_accident_list
    : [];
  const encarEvents = Array.isArray(carHistory?.accidentHistoryResponse)
    ? carHistory.accidentHistoryResponse
    : [];
  return [
    ...ownEvents.map((event) =>
      buildInsuranceEvent(event, "Выплата по этому авто"),
    ),
    ...otherEvents.map((event) =>
      buildInsuranceEvent(event, "Выплата другому участнику"),
    ),
    ...encarEvents.map((event) => buildInsuranceEvent(event, null)),
  ]
    .filter((event): event is InsuranceEvent => Boolean(event))
    .sort((a, b) => b.date.localeCompare(a.date));
}

type InsuranceEvent = {
  amount: number;
  component: number | null;
  date: string;
  kind: string;
  operations: string[];
  painting: number | null;
  wage: number | null;
};

function buildInsuranceEvent(
  value: unknown,
  kind: string | null,
): InsuranceEvent | null {
  const record = getObject(value);
  if (!record) return null;
  const date =
    typeof record.accident_date === "string"
      ? record.accident_date
      : typeof record.accidentDate === "string"
        ? record.accidentDate
        : null;
  const amount =
    asNumber(record.amount) ??
    asNumber(record.insurance_money) ??
    asNumber(record.repair_estimate_amount) ??
    asNumber(record.insurance_amount) ??
    asNumber(record.repairCost);
  if (!date || amount === null) return null;
  const eventKind =
    kind ??
    translateEncarAccidentType(
      typeof record.accidentType === "string" ? record.accidentType : null,
    );
  return {
    amount,
    component: asNumber(record.component) ?? asNumber(record.partCost),
    date,
    kind: Boolean(record.is_severe_accident)
      ? `${eventKind} · серьёзный случай`
      : eventKind,
    operations: translateRepairOperations(
      typeof record.wage_description === "string"
        ? record.wage_description
        : null,
    ),
    painting: asNumber(record.painting) ?? asNumber(record.paintingCost),
    wage: asNumber(record.wage) ?? asNumber(record.laborCost),
  };
}

function translateEncarAccidentType(value: string | null) {
  if (value === "USE_MY_INSURANCE") return "Выплата по страховке владельца";
  if (value === "USE_OTHER_INSURANCE")
    return "Выплата по страховке другого участника";
  if (value === "PROPERTY_DAMAGE")
    return "Страховой случай: имущественный ущерб";
  return "Страховой случай";
}

function buildBodyMarks(
  eyeReport: Record<string, unknown> | null,
  reports: Array<{ report_type: string; raw_payload?: unknown }>,
): BodyMark[] {
  const accident = getObject(eyeReport?.accident);
  const scan = getObject(accident?.thermographic_scan);
  const eyeFindings = Array.isArray(scan?.findings) ? scan.findings : [];
  const inspection = reports.find(
    (report) => report.report_type === "encar_inspection",
  );
  const rawInspection = getObject(getObject(inspection?.raw_payload)?.inspection);
  const encarFindings = Array.isArray(rawInspection?.outers)
    ? rawInspection.outers
    : [];
  const marks = eyeFindings.length > 0
    ? eyeFindings
    : encarFindings.map((finding) => normalizeEncarBodyFinding(finding));

  return marks
    .map((finding) => {
      const record = getObject(finding);
      if (!record) return null;
      const part = typeof record.part === "string" ? record.part : null;
      if (!part) return null;
      const position = BODY_PART_POSITIONS[part];
      if (!position) return null;
      return {
        code: damageCode(record),
        label: translateBodyPart(part),
        part,
        x: position.x,
        y: position.y,
      };
    })
    .filter((mark): mark is BodyMark => Boolean(mark));
}

function normalizeEncarBodyFinding(value: unknown) {
  const record = getObject(value);
  if (!record) return null;
  const type = getObject(record.type);
  const statuses = Array.isArray(record.statusTypes) ? record.statusTypes : [];
  const status = getObject(statuses[0]);
  const attributes = Array.isArray(record.attributes)
    ? record.attributes.filter((item): item is string => typeof item === "string")
    : [];
  const rawPart = [type?.code, type?.title, ...attributes]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  const part = encarBodyPart(rawPart);
  if (!part) return null;
  const repair = [status?.code, status?.title]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return {
    part,
    repair,
    impression: repair,
  };
}

function encarBodyPart(value: string) {
  const normalized = value.toLowerCase();
  const aliases: Array<[string[], string]> = [
    [["front_bumper", "front bumper", "앞범퍼", "전범퍼"], "front_bumper"],
    [["rear_bumper", "rear bumper", "back bumper", "뒤범퍼", "후범퍼"], "rear_bumper"],
    [["hood", "bonnet", "후드", "본네트"], "hood"],
    [["trunk", "boot", "트렁크", "테일게이트"], "trunk"],
    [["roof", "루프"], "roof"],
    [["front_fender", "front fender", "앞휀더", "전휀더"], "fender_front_driver"],
    [["rear_fender", "rear fender", "뒤휀더", "후휀더", "쿼터"], "fender_rear_driver"],
    [["front_door", "front door", "앞도어", "전도어"], "door_front_driver"],
    [["rear_door", "rear door", "뒤도어", "후도어"], "door_rear_driver"],
    [["side_sil", "side sill", "rocker", "사이드실", "사이드스텝"], "side_sil_panel_driver"],
  ];
  return aliases.find(([tokens]) => tokens.some((token) => normalized.includes(token)))?.[1] ?? null;
}

function damageCode(record: Record<string, unknown>): BodyMark["code"] {
  const repair = typeof record.repair === "string" ? record.repair.toLowerCase() : "";
  const impression = typeof record.impression === "string" ? record.impression.toLowerCase() : "";
  const text = `${repair} ${impression}`;
  if (/exchange|교환|замен/.test(text)) return "X";
  if (/weld|판금|용접|рихт|ремонт/.test(text)) return "W";
  if (/corrosion|부식|корроз/.test(text)) return "C";
  if (/scratch|긁힘|царап/.test(text)) return "A";
  if (/uneven|요철|неров/.test(text)) return "U";
  return "T";
}

function markColor(code: BodyMark["code"]) {
  const colors: Record<BodyMark["code"], string> = {
    X: "bg-[#ff3131]",
    W: "bg-[#64a4e8]",
    C: "bg-[#f39a1f]",
    A: "bg-[#7891aa]",
    U: "bg-[#73785f]",
    T: "bg-[#a98274]",
  };
  return colors[code];
}

const BODY_PART_POSITIONS: Record<string, { x: number; y: number }> = {
  fender_front_driver: { x: 12, y: 19 },
  door_front_driver: { x: 13, y: 43 },
  door_rear_driver: { x: 13, y: 64 },
  fender_rear_driver: { x: 12, y: 82 },
  side_sil_panel_driver: { x: 20, y: 72 },
  fender_front_passenger: { x: 88, y: 19 },
  door_front_passenger: { x: 84, y: 43 },
  door_rear_passenger: { x: 84, y: 64 },
  fender_rear_passenger: { x: 88, y: 82 },
  side_sil_panel_passenger: { x: 78, y: 72 },
  hood: { x: 50, y: 36 },
  trunk: { x: 50, y: 82 },
  roof: { x: 50, y: 50 },
  front_bumper: { x: 50, y: 7 },
  rear_bumper: { x: 50, y: 93 },
};

function translateBodyPart(part: string) {
  const labels: Record<string, string> = {
    fender_front_driver: "переднее левое крыло",
    door_front_driver: "передняя левая дверь",
    door_rear_driver: "задняя левая дверь",
    fender_rear_driver: "заднее левое крыло",
    side_sil_panel_driver: "левый порог",
    fender_front_passenger: "переднее правое крыло",
    door_front_passenger: "передняя правая дверь",
    door_rear_passenger: "задняя правая дверь",
    fender_rear_passenger: "заднее правое крыло",
    side_sil_panel_passenger: "правый порог",
    hood: "капот",
    trunk: "крышка багажника",
    roof: "крыша",
    front_bumper: "передний бампер",
    rear_bumper: "задний бампер",
  };
  return labels[part] ?? part.replaceAll("_", " ");
}

function translateRepairOperations(description: string | null) {
  if (!description) return [];
  return description
    .replace(/\s*외\s*\d+건\s*\(총\s*\d+건\)/g, "")
    .split(",")
    .map((part) => translateRepairOperation(part.trim()))
    .filter((part): part is string => Boolean(part))
    .filter((part, index, array) => array.indexOf(part) === index)
    .slice(0, 8);
}

function translateRepairOperation(value: string) {
  if (!value) return null;
  let result = value
    .replace(/\(우\)/g, " прав.")
    .replace(/\(좌\)/g, " лев.")
    .replace(/\|/g, " / ");

  const replacements: Array<[RegExp, string]> = [
    [/리어쿼터패널/g, "заднее крыло"],
    [/리어펜더/g, "заднее крыло"],
    [/프런트펜더/g, "переднее крыло"],
    [/리어도어벨트몰딩/g, "молдинг задней двери"],
    [/프런트도어벨트몰딩/g, "молдинг передней двери"],
    [/리어도어아웃사이드핸들/g, "наружная ручка задней двери"],
    [/프런트도어아웃사이드핸들/g, "наружная ручка передней двери"],
    [/리어도어인사이드핸들/g, "внутренняя ручка задней двери"],
    [/프런트도어인사이드핸들/g, "внутренняя ручка передней двери"],
    [/리어도어트림/g, "обшивка задней двери"],
    [/프런트도어트림/g, "обшивка передней двери"],
    [/리어도어/g, "задняя дверь"],
    [/프런트도어/g, "передняя дверь"],
    [/리어컴비네이션램프/g, "задний фонарь"],
    [/백패널트림/g, "обшивка задней панели"],
    [/백패널/g, "задняя панель"],
    [/사이드스텝몰딩/g, "накладка порога"],
    [/사이드스텝/g, "порог"],
    [/센터필러/g, "центральная стойка"],
    [/연료주입구측/g, "зона лючка топлива"],
    [/아우터/g, "наружная панель"],
    [/눈썹몰딩/g, "молдинг"],
    [/전면보수/g, "полное восстановление"],
    [/표면보수/g, "локальный ремонт"],
    [/도장/g, "окрас"],
    [/탈착/g, "снятие/установка"],
    [/판금/g, "рихтовка"],
    [/교환/g, "замена"],
  ];
  for (const [pattern, replacement] of replacements)
    result = result.replace(pattern, replacement);
  result = result
    .replace(/молдинг задней дверимолдинг/g, "молдинг задней двери")
    .replace(/молдинг передней дверимолдинг/g, "молдинг передней двери")
    .replace(/[()]/g, "")
    .replace(/(прав\.|лев\.)(?=\S)/g, "$1 ")
    .replace(
      /(полное восстановление|локальный ремонт|снятие\/установка|рихтовка|замена|окрас)(?=\S)/g,
      "$1, ",
    )
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(
      /молдинг (задней|передней) двер[ьи]\s*молдинг/g,
      "молдинг $1 двери",
    )
    .trim();
  return /[가-힣]/.test(result) ? null : result;
}

function buildEyeSummary(eyeReport: Record<string, unknown> | null) {
  const accident = getObject(eyeReport?.accident);
  const summary =
    typeof accident?.accident_repairs_summary === "string"
      ? accident.accident_repairs_summary
      : null;
  const exchangeCount = asNumber(accident?.outer_panel_exchange_count);
  const repairCount = asNumber(accident?.outer_panel_weld_count);

  return {
    accidentSummary: translateAccidentSummary(summary),
    exchangeCount,
    repairCount,
  };
}

function translateAccidentSummary(summary: string | null) {
  if (summary === "complete_no_accident") return "Полностью без ДТП";
  if (summary === "simple_repair") return "Косметический ремонт";
  if (summary === "accident") return "Есть история ДТП";
  return "Нет данных";
}

function buildThermalInspection(
  eyeReport: Record<string, unknown> | null,
  thermalMedia: Array<{
    url: string;
    category: string | null;
    thumbnail_url: string | null;
  }>,
  thermalReferenceMedia: Array<{
    url: string;
    category: string | null;
    thumbnail_url: string | null;
  }>,
): { entries: ThermalEntry[]; references: ThermalReference[] } {
  const accident = getObject(eyeReport?.accident);
  const scan = getObject(accident?.thermographic_scan);
  const resultImages = Array.isArray(scan?.result_images)
    ? scan.result_images
    : [];
  const entries = resultImages
    .map((item) => {
      const record = getObject(item);
      if (!record) return null;
      const url =
        typeof record?.image_url === "string" ? record.image_url : null;
      if (!url) return null;
      return {
        url,
        type: typeof record.type === "string" ? record.type : "thermal",
        width: asNumber(record.image_width),
        height: asNumber(record.image_height),
        boxes: buildThermalBoxes(record.boxes),
      };
    })
    .filter((item): item is ThermalEntry => Boolean(item));

  const fallbackEntries =
    entries.length > 0
      ? []
      : thermalMedia.map((media) => ({
          url: media.url,
          type: media.category ?? "thermal",
          width: null,
          height: null,
          boxes: [],
        }));

  const outsideImages = Array.isArray(scan?.outside_images)
    ? scan.outside_images
    : [];
  const referencesFromReport = outsideImages
    .map((item) => {
      const record = getObject(item);
      return typeof record?.image_url === "string"
        ? { url: record.image_url }
        : null;
    })
    .filter((item): item is ThermalReference => Boolean(item));
  const fallbackReferences = referencesFromReport.length
    ? []
    : thermalReferenceMedia.map((media) => ({ url: media.url }));

  return {
    entries: entries.length ? entries : fallbackEntries,
    references: referencesFromReport.length
      ? referencesFromReport
      : fallbackReferences,
  };
}

function buildThermalBoxes(value: unknown): ThermalEntry["boxes"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = getObject(item);
      const rawBox = Array.isArray(record?.box) ? record.box : [];
      if (
        rawBox.length !== 4 ||
        rawBox.some((part) => typeof part !== "number")
      )
        return null;
      return {
        part: typeof record?.part === "string" ? record.part : null,
        box: rawBox as [number, number, number, number],
      };
    })
    .filter((item): item is ThermalEntry["boxes"][number] => Boolean(item));
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
