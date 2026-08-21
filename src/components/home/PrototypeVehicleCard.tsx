"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const photos = useMemo(
    () => (car.car_media ?? [])
      .filter((media) => media.media_type === "image")
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order),
    [car.car_media],
  );
  const [photoIndex, setPhotoIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const touchStartX = useRef<number | null>(null);
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

  const changePhoto = useCallback((direction: -1 | 1) => {
    setPhotoIndex((current) => (current + direction + photos.length) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    if (!galleryOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGalleryOpen(false);
      if (event.key === "ArrowLeft") changePhoto(-1);
      if (event.key === "ArrowRight") changePhoto(1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changePhoto, galleryOpen]);

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
      className="relative flex h-full min-h-[412px] w-full flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_14px_35px_rgba(28,43,61,0.13)] ring-1 ring-[#dce2eb]"
    >
      <Link aria-label={`Открыть карточку ${title}`} className="absolute inset-0 z-0" href={detailsHref} prefetch={false} />

      <div
        aria-label={`Открыть галерею: ${title}`}
        className="relative z-10 aspect-[2.25/1] cursor-zoom-in overflow-hidden bg-[#e8edf3]"
        onClick={() => photos.length && setGalleryOpen(true)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && photos.length) {
            event.preventDefault();
            setGalleryOpen(true);
          }
        }}
        role="button"
        tabIndex={photos.length ? 0 : -1}
      >
        {photos.length ? <RemoteImage alt={title} className="object-cover" fill sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 84vw" src={photos[photoIndex].url} /> : <div className="flex h-full items-center justify-center text-sm text-[#647084]">Фото временно недоступно</div>}
        {photos.length > 1 ? <>
          <button aria-label="Предыдущее фото" className="pointer-events-auto absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={(event) => { event.stopPropagation(); changePhoto(-1); }} type="button"><ChevronLeft size={18} /></button>
          <button aria-label="Следующее фото" className="pointer-events-auto absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={(event) => { event.stopPropagation(); changePhoto(1); }} type="button"><ChevronRight size={18} /></button>
          <span className="absolute bottom-2 right-2 rounded-full bg-[#101827]/78 px-2.5 py-1 text-[11px] font-semibold text-white">{photoIndex + 1} / {photos.length}</span>
        </> : null}
      </div>

      <div className="pointer-events-none relative z-10 flex-1 p-3 sm:p-4">
        <div>
          <p className="text-xl font-bold tabular-nums text-[#101827] sm:text-2xl">{rub.format(car.price_rub ?? 0)} ₽</p>
          <p className="mt-0.5 text-xs text-[#647084] sm:mt-1 sm:text-sm">Цена под ключ до Владивостока</p>
        </div>

        <h3 className="mt-3 flex flex-wrap items-center gap-1.5 text-lg font-bold leading-tight text-[#101827] transition hover:text-[#956f2c] sm:mt-4 sm:gap-2 sm:text-xl">
          <span>{primaryFacts.length ? primaryFacts.slice(0, 2).join(" ") : title}</span>
          {car.year ? <span className="rounded-full border border-[#cfd6e0] px-2 py-0.5 text-xs font-medium text-[#4e5b6d] sm:px-2.5 sm:py-1 sm:text-sm">{car.year}</span> : null}
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
          {car.accident_count === 0 ? <span className="rounded-full bg-[#e8f5ef] px-2 py-0.5 text-[11px] font-semibold text-[#18794e] sm:px-2.5 sm:py-1 sm:text-xs">Без ДТП</span> : null}
          {car.insurance_payout_count != null && car.insurance_payout_count > 0 ? <span className="rounded-full bg-[#fff2e5] px-2 py-0.5 text-[11px] font-semibold text-[#9a5b1c] sm:px-2.5 sm:py-1 sm:text-xs">Страховые выплаты: {car.insurance_payout_count}</span> : null}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-[#273246] sm:mt-2 sm:text-sm sm:leading-6">
          {primaryFacts.slice(2).join(" · ") || "Основные характеристики уточняются"}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-[#273246] sm:mt-2 sm:text-sm sm:leading-6">
          {secondaryFacts.join(" · ") || "Комплектация уточняется"}
        </p>
      </div>

      <div className="relative z-10 grid grid-cols-3 border-y border-[#f0e4e4] bg-[#fff8f7] text-[11px] font-semibold text-[#ba4b42] sm:text-xs">
        <button aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"} className="flex min-h-10 items-center justify-center gap-0.5 border-r border-[#f0e4e4] px-0.5 transition hover:bg-[#fff0ee] sm:min-h-12 sm:gap-1 sm:px-1" onClick={(event) => { event.stopPropagation(); setFavorite((current) => !current); }} type="button"><Heart fill={favorite ? "currentColor" : "none"} size={15} /> Избранное</button>
        <a className="flex min-h-10 items-center justify-center gap-0.5 border-r border-[#f0e4e4] px-0.5 transition hover:bg-[#fff0ee] sm:min-h-12 sm:gap-1 sm:px-1" href={whatsappContactUrl(message)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><MessageCircle size={15} /> Консультация</a>
        <button aria-label="Поделиться объявлением" className="flex min-h-10 items-center justify-center gap-0.5 px-0.5 transition hover:bg-[#fff0ee] sm:min-h-12 sm:gap-1 sm:px-1" onClick={(event) => { event.stopPropagation(); void share(); }} type="button"><Share2 size={15} /> Поделиться</button>
      </div>

      <div className="pointer-events-none relative z-10 px-3 py-2 text-[11px] text-[#7a8798] sm:px-4 sm:py-3 sm:text-xs">
        <span>{saleDays != null ? `В продаже ${saleDays} дней` : "Срок продажи уточняется"}</span>
      </div>
      {shareNotice ? <span aria-live="polite" className="sr-only">{shareNotice}</span> : null}
      {galleryOpen && photos.length ? (
        <div
          aria-label={`Фотогалерея ${title}`}
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col bg-[#101318]/95 p-3 text-white sm:p-6"
          onClick={() => setGalleryOpen(false)}
          role="dialog"
        >
          <div className="flex items-center justify-between gap-4 px-1 pb-3 sm:px-2">
            <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
            <button aria-label="Закрыть галерею" className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-2xl leading-none hover:bg-white/20" onClick={() => setGalleryOpen(false)} type="button">×</button>
          </div>
          <div
            className="relative min-h-0 flex-1"
            onClick={(event) => event.stopPropagation()}
            onTouchEnd={(event) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start == null) return;
              const distance = event.changedTouches[0].clientX - start;
              if (Math.abs(distance) > 45) changePhoto(distance > 0 ? -1 : 1);
            }}
            onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }}
          >
            <RemoteImage alt={`${title}, фото ${photoIndex + 1}`} className="object-contain" fill priority sizes="100vw" src={photos[photoIndex].url} />
            {photos.length > 1 ? <>
              <button aria-label="Предыдущее фото" className="absolute left-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 hover:bg-black/75 sm:left-4" onClick={() => changePhoto(-1)} type="button"><ChevronLeft size={25} /></button>
              <button aria-label="Следующее фото" className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 hover:bg-black/75 sm:right-4" onClick={() => changePhoto(1)} type="button"><ChevronRight size={25} /></button>
            </> : null}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto px-1 pt-3 sm:pt-4">
            {photos.map((photo, index) => <button aria-label={`Открыть фото ${index + 1}`} className={`relative size-14 shrink-0 overflow-hidden rounded-md ${index === photoIndex ? "ring-2 ring-[#c7a55a]" : "opacity-60 hover:opacity-100"}`} key={`${photo.url}-${index}`} onClick={() => setPhotoIndex(index)} type="button"><RemoteImage alt="" className="object-cover" fill sizes="56px" src={photo.url} /></button>)}
          </div>
        </div>
      ) : null}
    </article>
  );
}
