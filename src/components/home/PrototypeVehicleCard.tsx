"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Share2,
} from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";
import { vehicleClientMessage, whatsappContactUrl } from "@/lib/contact";
import { translateFuel } from "@/server/normalization/display";
import type { CatalogCar } from "@/server/cars/repository";

const rub = new Intl.NumberFormat("ru-RU");
const engine = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const day = 24 * 60 * 60 * 1000;

function daysOnSale(car: CatalogCar) {
  const listedAt = car.published_at ?? car.source_updated_at ?? car.created_at;
  if (!listedAt) return null;
  const elapsed = Math.floor((Date.now() - new Date(listedAt).getTime()) / day);
  return Math.max(0, elapsed);
}

export function PrototypeVehicleCard({ car }: { car: CatalogCar }) {
  const photos = useMemo(
    () => (car.car_media ?? [])
      .filter((media) => media.media_type === "image")
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order),
    [car.car_media],
  );
  const [photoIndex, setPhotoIndex] = useState(0);
  const [favorite, setFavorite] = useState(false);
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
  ].filter((value): value is string => Boolean(value));
  const secondaryFacts = [
    car.trim || car.badge,
    car.fuel_type ? translateFuel(car.fuel_type) : null,
    car.power_hp ? `${car.power_hp} л.с.` : null,
    car.drive_type,
    car.body_type,
    seats ?? "Места уточняются",
  ].filter((value): value is string => Boolean(value));
  const saleDays = daysOnSale(car);

  const changePhoto = (direction: -1 | 1) => {
    setPhotoIndex((current) => (current + direction + photos.length) % photos.length);
  };

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
      className="relative w-[84vw] max-w-[360px] shrink-0 snap-start overflow-hidden rounded-[24px] bg-white shadow-[0_14px_35px_rgba(28,43,61,0.13)] ring-1 ring-[#dce2eb] sm:w-auto sm:max-w-none"
    >
      <Link aria-label={`Открыть карточку ${title}`} className="absolute inset-0 z-0" href={detailsHref} prefetch={false} />

      <div className="pointer-events-none relative z-10 aspect-[2.25/1] overflow-hidden bg-[#e8edf3]">
        {photos.length ? <RemoteImage alt={title} className="object-cover" fill sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 84vw" src={photos[photoIndex].url} /> : <div className="flex h-full items-center justify-center text-sm text-[#647084]">Фото временно недоступно</div>}
        {photos.length > 1 ? <>
          <button aria-label="Предыдущее фото" className="pointer-events-auto absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={(event) => { event.stopPropagation(); changePhoto(-1); }} type="button"><ChevronLeft size={18} /></button>
          <button aria-label="Следующее фото" className="pointer-events-auto absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={(event) => { event.stopPropagation(); changePhoto(1); }} type="button"><ChevronRight size={18} /></button>
          <span className="absolute bottom-2 right-2 rounded-full bg-[#101827]/78 px-2.5 py-1 text-[11px] font-semibold text-white">{photoIndex + 1} / {photos.length}</span>
        </> : null}
      </div>

      <div className="pointer-events-none relative z-10 p-4">
        <div>
          <p className="text-2xl font-bold tabular-nums text-[#101827]">{rub.format(car.price_rub ?? 0)} ₽</p>
          <p className="mt-1 text-sm text-[#647084]">Цена под ключ до Владивостока</p>
        </div>

        <h3 className="mt-4 block text-xl font-bold leading-tight text-[#101827] transition hover:text-[#956f2c]">
          {primaryFacts.length ? primaryFacts.slice(0, 2).join(" ") : title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#273246]">
          {primaryFacts.slice(2).join(" · ") || "Основные характеристики уточняются"}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#273246]">
          {secondaryFacts.join(" · ") || "Комплектация уточняется"}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {car.accident_count === 0 ? <span className="rounded-full bg-[#e8f5ef] px-2.5 py-1 text-xs font-semibold text-[#18794e]">Без ДТП</span> : null}
          {car.insurance_payout_count != null && car.insurance_payout_count > 0 ? <span className="rounded-full bg-[#fff2e5] px-2.5 py-1 text-xs font-semibold text-[#9a5b1c]">Страховые выплаты: {car.insurance_payout_count}</span> : null}
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-3 border-y border-[#f0e4e4] bg-[#fff8f7] text-xs font-semibold text-[#ba4b42]">
        <button aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"} className="flex min-h-12 items-center justify-center gap-1 border-r border-[#f0e4e4] px-1 transition hover:bg-[#fff0ee]" onClick={(event) => { event.stopPropagation(); setFavorite((current) => !current); }} type="button"><Heart fill={favorite ? "currentColor" : "none"} size={17} /> Избранное</button>
        <a className="flex min-h-12 items-center justify-center gap-1 border-r border-[#f0e4e4] px-1 transition hover:bg-[#fff0ee]" href={whatsappContactUrl(message)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><MessageCircle size={17} /> Консультация</a>
        <button aria-label="Поделиться объявлением" className="flex min-h-12 items-center justify-center gap-1 px-1 transition hover:bg-[#fff0ee]" onClick={(event) => { event.stopPropagation(); void share(); }} type="button"><Share2 size={17} /> Поделиться</button>
      </div>

      <div className="pointer-events-none relative z-10 px-4 py-3 text-xs text-[#7a8798]">
        <span>{saleDays != null ? `В продаже ${saleDays} дней` : "Срок продажи уточняется"}</span>
      </div>
      {shareNotice ? <span aria-live="polite" className="sr-only">{shareNotice}</span> : null}
    </article>
  );
}
