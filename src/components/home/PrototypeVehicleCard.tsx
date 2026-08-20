"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Link2,
  MessageCircle,
  Share2,
} from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";
import { vehicleClientMessage, whatsappContactUrl } from "@/lib/contact";
import { translateFuel } from "@/server/normalization/display";
import type { CatalogCar } from "@/server/cars/repository";

const rub = new Intl.NumberFormat("ru-RU");
const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

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
  const specs = [
    car.mileage_km != null ? `${rub.format(car.mileage_km)} км` : null,
    car.year ? `${car.year} г.` : null,
    car.power_hp ? `${car.power_hp} л.с.` : null,
    car.fuel_type ? translateFuel(car.fuel_type) : null,
    car.engine_cc ? `${(car.engine_cc / 1000).toFixed(1)} л` : null,
    car.drive_type,
    car.transmission,
  ].filter((value): value is string => Boolean(value));
  const updatedAt = car.source_updated_at ? new Date(car.source_updated_at) : null;

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
    <article className="w-[84vw] max-w-[360px] shrink-0 snap-start overflow-hidden rounded-[24px] bg-white shadow-[0_14px_35px_rgba(28,43,61,0.13)] ring-1 ring-[#dce2eb] sm:w-auto sm:max-w-none">
      <div className="relative aspect-[4/3] overflow-hidden bg-[#e8edf3]">
        {photos.length ? <RemoteImage alt={title} className="object-cover" fill sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 84vw" src={photos[photoIndex].url} /> : <div className="flex h-full items-center justify-center text-sm text-[#647084]">Фото временно недоступно</div>}
        {photos.length > 1 ? <>
          <button aria-label="Предыдущее фото" className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={() => changePhoto(-1)} type="button"><ChevronLeft size={18} /></button>
          <button aria-label="Следующее фото" className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#182234] shadow-sm transition hover:bg-white" onClick={() => changePhoto(1)} type="button"><ChevronRight size={18} /></button>
          <span className="absolute bottom-2 right-2 rounded-full bg-[#101827]/78 px-2.5 py-1 text-[11px] font-semibold text-white">{photoIndex + 1} / {photos.length}</span>
        </> : null}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Link className="text-xl font-bold leading-tight text-[#101827] transition hover:text-[#956f2c]" href={detailsHref}>{title}</Link>
          {car.year ? <span className="shrink-0 rounded-full border border-[#cfd6e0] px-2.5 py-1 text-xs font-semibold text-[#536174]">{car.year}</span> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {car.accident_count === 0 ? <span className="rounded-full bg-[#e8f5ef] px-2.5 py-1 text-xs font-semibold text-[#18794e]">Без ДТП</span> : null}
          {car.insurance_payout_count != null && car.insurance_payout_count > 0 ? <span className="rounded-full bg-[#fff2e5] px-2.5 py-1 text-xs font-semibold text-[#9a5b1c]">Страховые выплаты: {car.insurance_payout_count}</span> : null}
        </div>

        {specs.length ? <p className="mt-4 text-sm leading-6 text-[#273246]">{specs.join(" · ")}</p> : null}
        {car.badge ? <p className="mt-1 text-xs text-[#7a8798]">{car.badge}</p> : null}

        <div className="mt-5">
          <p className="text-2xl font-bold tabular-nums text-[#101827]">{rub.format(car.price_rub ?? 0)} ₽</p>
          <p className="mt-1 text-sm text-[#647084]">Цена до Владивостока</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1fr_52px] border-y border-[#f0e4e4] bg-[#fff8f7] text-sm font-semibold text-[#ba4b42]">
        <a className="flex min-h-12 items-center justify-center gap-1 border-r border-[#f0e4e4] px-2 transition hover:bg-[#fff0ee]" href={whatsappContactUrl(message)} rel="noreferrer" target="_blank"><MessageCircle size={16} /> Вопрос</a>
        <a className="flex min-h-12 items-center justify-center border-r border-[#f0e4e4] px-2 transition hover:bg-[#fff0ee]" href={whatsappContactUrl(message)} rel="noreferrer" target="_blank">Заказать</a>
        <button aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"} className="flex items-center justify-center transition hover:bg-[#fff0ee]" onClick={() => setFavorite((current) => !current)} type="button"><Heart fill={favorite ? "currentColor" : "none"} size={22} /></button>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-[#7a8798]">
        <span>{updatedAt ? `Обновлено ${date.format(updatedAt)}` : "Южная Корея"}</span>
        <button aria-label="Поделиться объявлением" className="inline-flex items-center gap-1 font-semibold text-[#647084] hover:text-[#956f2c]" onClick={share} type="button"><Share2 size={15} /> Поделиться</button>
      </div>
      {shareNotice ? <span aria-live="polite" className="sr-only">{shareNotice}</span> : null}
      <Link aria-label="Открыть подробную карточку автомобиля" className="sr-only" href={detailsHref}><Link2 size={1} /></Link>
    </article>
  );
}
