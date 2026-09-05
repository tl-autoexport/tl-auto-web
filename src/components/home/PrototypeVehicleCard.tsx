"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  MessageCircle,
  Share2,
} from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";
import { useDestination } from "@/components/site/DestinationProvider";
import { vehicleClientMessage, whatsappContactUrl } from "@/lib/contact";
import { translateFuel } from "@/server/normalization/display";
import type { CatalogCar } from "@/server/cars/repository";

const rub = new Intl.NumberFormat("ru-RU");
const engine = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const day = 24 * 60 * 60 * 1000;

const BODY_SHAPE_BY_MODEL: Record<string, string> = {
  K8: "Седан",
  K5: "Седан",
  Sonata: "Седан",
  G80: "Седан",
  G90: "Седан",
  Grandeur: "Седан",
  Avante: "Седан",
  Elantra: "Седан",
};

function bodyShapeForCard(car: CatalogCar) {
  const storedShape = car.vehicle_specs?.body_shape;
  if (typeof storedShape === "string" && storedShape.trim()) return storedShape;
  if (car.body_type === "SUV") return "Кроссовер";
  if (car.body_type === "Минивэн") return "Минивэн";
  if (car.body_type === "Спорткар") return "Спорткар";
  return BODY_SHAPE_BY_MODEL[car.model ?? ""] ?? null;
}

function daysOnSale(car: CatalogCar) {
  const listedAt = car.published_at ?? car.source_updated_at ?? car.created_at;
  if (!listedAt) return null;
  const elapsed = Math.floor((Date.now() - new Date(listedAt).getTime()) / day);
  return Math.max(0, elapsed);
}

export function PrototypeVehicleCard({ car }: { car: CatalogCar }) {
  const { country, city } = useDestination();
  const photos = useMemo(
    () => (car.car_media ?? [])
      .filter((media) => media.media_type === "image")
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order),
    [car.car_media],
  );
  const [shareNotice, setShareNotice] = useState("");
  const title = [car.brand, car.model].filter(Boolean).join(" ") || "Автомобиль из Кореи";
  const detailsHref = `/cars/${car.primary_source}/${car.source_id}`;
  const message = vehicleClientMessage({ source: car.primary_source, sourceId: car.source_id, title });
  const seats = typeof car.vehicle_specs?.seats === "number" ? `${car.vehicle_specs.seats} мест` : null;
  const primaryFacts = [
    car.brand,
    car.model,
    car.engine_cc ? `${engine.format(car.engine_cc / 1000)} л` : null,
    car.transmission,
    car.year ? `${car.year} г.` : null,
    car.mileage_km ? `${rub.format(car.mileage_km)} км` : null,
  ].filter((value): value is string => Boolean(value));
  const secondaryFacts = [
    car.trim || car.badge,
    car.fuel_type ? translateFuel(car.fuel_type) : null,
    car.power_hp ? `${car.power_hp} л.с.` : null,
    car.drive_type,
    bodyShapeForCard(car),
    seats ?? "Места уточняются",
  ].filter((value): value is string => Boolean(value));
  const saleDays = daysOnSale(car);
  const isVladivostokPrice = country.countryCode === "RU" && city.id === "vladivostok";
  const hasExactVladivostokPrice = isVladivostokPrice && car.price_rub != null;
  const isElectricPending = car.fuel_type === "electric" && car.price_rub == null;
  const pendingPriceLabel = country.countryCode === "KZ" && city.id === "almaty"
    ? "Расчёт до Алматы уточняется"
    : `Расчёт до ${city.label} уточняется`;
  const pendingPriceMeta = country.countryCode === "KZ"
    ? "В тенге · с доставкой · без таможни"
    : `Тариф для направления ${country.countryLabel} уточняется`;

  const share = async () => {
    const shareData = { title, text: `Автомобиль ${title} в каталоге TL Auto`, url: window.location.origin + detailsHref };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(shareData.url);
        setShareNotice("Ссылка скопирована");
      }
    } catch {
      // Closing the native share sheet is not an error worth showing to a visitor.
    }
  };

  return (
    <article
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_14px_35px_rgba(28,43,61,0.13)] ring-1 ring-[#dce2eb] sm:min-h-[412px] sm:rounded-[24px]"
    >
      <Link aria-label={`Открыть карточку ${title}`} className="absolute inset-0 z-0" href={detailsHref} prefetch={false} />

      <div className="pointer-events-none relative z-10 aspect-[2.25/1] overflow-hidden bg-[#e8edf3]">
        {photos[0] ? (
          <RemoteImage alt={title} className="object-cover" fill loading="eager" sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, calc(100vw - 48px)" src={photos[0].url} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#647084]">Фото временно недоступно</div>
        )}
      </div>

      <div className="pointer-events-none relative z-10 flex-1 p-2.5 sm:p-4">
        <div>
          {hasExactVladivostokPrice ? (
            <>
              <p className="text-xl font-bold tabular-nums text-[#101827] sm:text-2xl">{rub.format(car.price_rub!)} ₽</p>
              <p className="mt-0.5 text-xs text-[#647084] sm:mt-1 sm:text-sm">Цена под ключ до Владивостока</p>
            </>
          ) : (
            <>
              <p className="text-base font-bold leading-tight text-[#101827] sm:text-lg">{isElectricPending ? "Расчёт электромобиля уточняется" : pendingPriceLabel}</p>
              <p className="mt-0.5 text-xs text-[#647084] sm:mt-1 sm:text-sm">{isElectricPending ? "Стоимость зависит от действующих правил ввоза" : pendingPriceMeta}</p>
            </>
          )}
        </div>

        <h3 className="mt-2 flex flex-wrap items-center gap-1.5 text-lg font-bold leading-tight text-[#101827] transition hover:text-[#956f2c] sm:mt-4 sm:gap-2 sm:text-xl">
          <span>{primaryFacts.length ? primaryFacts.slice(0, 2).join(" ") : title}</span>
          {car.year ? <span className="rounded-full border border-[#cfd6e0] px-2 py-0.5 text-xs font-medium text-[#4e5b6d] sm:px-2.5 sm:py-1 sm:text-sm">{car.year}</span> : null}
        </h3>
        <div className="mt-1 flex flex-wrap gap-1.5 sm:mt-3">
          {car.accident_count === 0 ? <span className="rounded-full bg-[#e8f5ef] px-2 py-0.5 text-[11px] font-semibold text-[#18794e] sm:px-2.5 sm:py-1 sm:text-xs">Без ДТП</span> : null}
          {car.insurance_payout_count != null && car.insurance_payout_count > 0 ? <span className="rounded-full bg-[#fff2e5] px-2 py-0.5 text-[11px] font-semibold text-[#9a5b1c] sm:px-2.5 sm:py-1 sm:text-xs">Страховые выплаты: {car.insurance_payout_count}</span> : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-[#273246] sm:mt-2 sm:text-sm sm:leading-6">
          {primaryFacts.slice(2).join(" · ") || "Основные характеристики уточняются"}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#273246] sm:mt-2 sm:text-sm sm:leading-6">
          {secondaryFacts.join(" · ") || "Комплектация уточняется"}
        </p>
      </div>

      <div className="relative z-10 flex items-center gap-2 border-t border-[#e4e9e7] bg-white px-2.5 py-2.5 text-[#207a45] sm:px-4">
        <a aria-label={`Получить консультацию по автомобилю ${title}`} className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#207a45] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(32,122,69,0.24)] transition hover:bg-[#176136] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#207a45] focus-visible:ring-offset-2 sm:h-11 sm:px-5" href={whatsappContactUrl(message)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><MessageCircle size={17} /><span className="truncate">Консультация</span></a>
        <button aria-label="Поделиться объявлением" className="grid h-10 w-16 shrink-0 place-items-center rounded-xl border border-[#dce5df] bg-white transition hover:border-[#207a45] hover:bg-[#f4faf6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#207a45] focus-visible:ring-offset-2 sm:h-11 sm:w-20" onClick={(event) => { event.stopPropagation(); void share(); }} title="Поделиться объявлением" type="button"><Share2 size={18} /><span className="sr-only">Поделиться объявлением</span></button>
      </div>

      <div className="pointer-events-none relative z-10 px-2.5 py-1.5 text-[11px] text-[#7a8798] sm:px-4 sm:py-3 sm:text-xs">
        <span>{saleDays != null ? `В продаже ${saleDays} дней` : "Срок продажи уточняется"}</span>
      </div>
      {shareNotice ? <span aria-live="polite" className="sr-only">{shareNotice}</span> : null}
    </article>
  );
}
