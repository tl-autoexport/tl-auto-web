"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Heart, Image as ImageIcon, MessageCircle, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CatalogCar } from "@/server/cars/repository";
import type { CalcRates } from "@/server/calc/types";
import { calculatePowersportsPrice } from "@/server/calc/powersports";
import { carDisplayTitle, translateFuel, translateTransmission } from "@/server/normalization/display";
import { passoImageProxyUrl } from "@/lib/passo-image";
import { RemoteImage } from "@/components/site/RemoteImage";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

const number = new Intl.NumberFormat("ru-RU");

type Props = {
  car: CatalogCar;
  calculationRates: CalcRates | null;
};

export function PassoCatalogCard({ car, calculationRates }: Props) {
  const images = useMemo(() => collectImages(car), [car]);
  const [selected, setSelected] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const suppressPhotoClick = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isJetski = car.vehicle_type === "jetski";
  const specs = car.vehicle_specs ?? {};
  const title = carDisplayTitle(car);
  const detailsHref = `/catalog/item/${car.primary_source}/${car.source_id}`;
  const calculation = calculatePowersportsPrice(isJetski ? "jetski" : "motorcycle", car.price_krw, calculationRates);
  const facts = buildFacts(car, specs);

  const select = (index: number) => setSelected((index + images.length) % images.length);
  const previous = () => select(selected - 1);
  const next = () => select(selected + 1);
  const closeViewer = () => setViewerOpen(false);

  useDialogAccessibility({ dialogRef, initialFocusRef: closeRef, onClose: closeViewer, open: viewerOpen });

  useEffect(() => {
    if (!viewerOpen || images.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") previous();
      if (event.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // Keyboard navigation deliberately follows the current image index.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, selected, images.length]);

  return (
    <article className="flex w-[calc(100vw-42px)] shrink-0 snap-start flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_12px_30px_rgba(31,43,65,0.09)] ring-1 ring-[#d8dde6] md:w-auto md:rounded-[20px]">
      <div className="bg-[#eef1f5] p-1.5 sm:hidden">
        {images.length ? (
          <button
            aria-label={`Открыть фотогалерею: ${title}`}
            className="relative block aspect-[16/10] w-full overflow-hidden rounded-[19px] bg-[#dfe4ec] touch-pan-y"
            onClick={() => {
              if (!suppressPhotoClick.current) setViewerOpen(true);
            }}
            onTouchEnd={(event) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              const end = event.changedTouches[0]?.clientX;
              if (start === null || end == null || Math.abs(end - start) < 35) return;
              suppressPhotoClick.current = true;
              if (end > start) previous(); else next();
              window.setTimeout(() => { suppressPhotoClick.current = false; }, 220);
            }}
            onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
            type="button"
          >
            <span className="flex h-full w-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${selected * 100}%)` }}>
              {images.map((url, index) => (
                <span className="relative h-full w-full shrink-0" key={url}>
                  <RemoteImage alt={`${title}, фото ${index + 1}`} className="object-cover" fill loading={index === 0 ? "eager" : "lazy"} sizes="calc(100vw - 54px)" src={passoImageProxyUrl(url)} fallback={<ImageIcon size={32} />} />
                </span>
              ))}
            </span>
          </button>
        ) : <PhotoFallback />}
        {images.length > 1 ? <PhotoCounter current={selected} total={images.length} /> : null}
      </div>

      <div className="relative hidden aspect-[16/10] bg-[#eef1f5] p-1.5 sm:block">
        {images[selected] ? (
          <button aria-label="Открыть фотогалерею" className="group relative block h-full w-full cursor-zoom-in overflow-hidden rounded-[16px] bg-[#dfe4ec]" onClick={() => setViewerOpen(true)} type="button">
            <RemoteImage alt={title} className="object-cover transition duration-300 group-hover:scale-[1.015]" fill loading="eager" sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" src={passoImageProxyUrl(images[selected])} fallback={<ImageIcon size={36} />} />
          </button>
        ) : <PhotoFallback />}
        {images.length > 1 ? <>
          <button aria-label="Предыдущее фото" className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[#152035] shadow-md transition hover:scale-105" onClick={previous} type="button"><ChevronLeft size={21} /></button>
          <button aria-label="Следующее фото" className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[#152035] shadow-md transition hover:scale-105" onClick={next} type="button"><ChevronRight size={21} /></button>
          <PhotoCounter current={selected} total={images.length} />
        </> : null}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isJetski ? "bg-[#e3f3f5] text-[#126f79]" : "bg-[#eef0f7] text-[#445276]"}`}>{typeLabel(car.vehicle_type)}</span>
            <Link className="mt-2 block" href={detailsHref}><h2 className="line-clamp-2 text-xl font-semibold leading-tight text-[#101827] transition hover:text-[#8a6828]">{title}</h2></Link>
          </div>
          {car.year ? <span className="shrink-0 rounded-full border border-[#d3dae5] px-2.5 py-1 text-sm font-medium text-[#536176]">{car.year}</span> : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-[#536176]">{facts.primary.join(" · ") || "Характеристики уточняются"}</p>
        {facts.secondary.length ? <p className="mt-1.5 min-h-11 text-sm leading-6 text-[#536176]">{facts.secondary.join(" · ")}</p> : <div className="min-h-11" />}
        <p className="mt-2 text-xs font-medium text-[#7a8798]">Южная Корея · доставка до Москвы</p>
        <div className="mt-5 border-t border-[#e9edf2] pt-4">
          <p className="text-xs text-[#7a8798]">Ориентировочная цена до Москвы</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-[#101827]">{calculation.totalRub != null ? `${number.format(calculation.totalRub)} ₽` : "Расчёт уточняется"}</p>
          {car.price_krw != null ? <p className="mt-1 text-xs text-[#7a8798]">Цена в Корее: {number.format(car.price_krw)} ₩</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[#e5ebe8] bg-[#f8fbf9] px-3 py-3">
        <Link className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#21864a] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#176f3b]" href={detailsHref}><MessageCircle size={18} /> Консультация</Link>
        <button aria-label="Добавить в избранное" className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d7e5dc] bg-white text-[#258149] transition hover:bg-[#edf7f0]" type="button"><Heart size={19} /></button>
        <button aria-label="Поделиться объявлением" className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d7e5dc] bg-white text-[#258149] transition hover:bg-[#edf7f0]" onClick={() => shareListing(title, detailsHref)} type="button"><Share2 size={18} /></button>
      </div>

      {viewerOpen ? <FullscreenViewer close={closeViewer} closeRef={closeRef} dialogRef={dialogRef} images={images} selected={selected} setSelected={setSelected} title={title} /> : null}
    </article>
  );
}

function FullscreenViewer({ close, closeRef, dialogRef, images, selected, setSelected, title }: { close: () => void; closeRef: RefObject<HTMLButtonElement | null>; dialogRef: RefObject<HTMLDivElement | null>; images: string[]; selected: number; setSelected: (value: number) => void; title: string }) {
  const touchStartX = useRef<number | null>(null);
  const mobileViewerRailRef = useRef<HTMLDivElement>(null);
  const move = (direction: -1 | 1) => setSelected((selected + direction + images.length) % images.length);

  useEffect(() => {
    const rail = mobileViewerRailRef.current;
    if (!rail || selected === 0) return;
    rail.scrollLeft = rail.clientWidth * selected;
    // Position the viewer on the photo that was selected in the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div aria-label={`Фотогалерея ${title}`} aria-modal="true" className="fixed inset-0 z-[100] flex flex-col bg-[#07101c]/95 text-white" ref={dialogRef} role="dialog" tabIndex={-1}>
    <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-xs text-white/60">{selected + 1} из {images.length}</p></div><button aria-label="Закрыть фотогалерею" className="grid size-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={close} ref={closeRef} type="button"><X size={22} /></button></div>
    <div className="relative min-h-0 flex-1 p-3 sm:p-8">
      <div className="scrollbar-none flex h-full snap-x snap-mandatory gap-3 overflow-x-auto sm:hidden" ref={mobileViewerRailRef} onScroll={(event) => { const slide = event.currentTarget.firstElementChild as HTMLElement | null; if (slide) setSelected(Math.max(0, Math.min(images.length - 1, Math.round(event.currentTarget.scrollLeft / (slide.offsetWidth + 12))))); }} onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { const start = touchStartX.current; touchStartX.current = null; if (start !== null && Math.abs(event.changedTouches[0]?.clientX - start) > 25) return; }}>
        {images.map((url, index) => <div className="relative h-full w-full shrink-0 snap-center" key={url}><RemoteImage alt={`${title}, фото ${index + 1}`} className="object-contain" fill priority={index === selected} sizes="100vw" src={passoImageProxyUrl(url)} fallback="Фото временно недоступно" /></div>)}
      </div>
      <div className="relative hidden h-full sm:block"><RemoteImage alt={`${title}, фото ${selected + 1}`} className="object-contain" fill priority sizes="100vw" src={passoImageProxyUrl(images[selected])} fallback="Фото временно недоступно" />{images.length > 1 ? <><button aria-label="Предыдущее фото" className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80" onClick={() => move(-1)} type="button"><ChevronLeft size={24} /></button><button aria-label="Следующее фото" className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80" onClick={() => move(1)} type="button"><ChevronRight size={24} /></button></> : null}</div>
    </div>
  </div>;
}

function PhotoCounter({ current, total }: { current: number; total: number }) {
  return <span className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-[#152035]/85 px-2.5 py-1 text-xs font-semibold text-white">{current + 1} / {total}</span>;
}

function PhotoFallback() {
  return <div className="flex aspect-[16/10] items-center justify-center rounded-[16px] bg-[#dfe4ec] text-[#647084]"><ImageIcon size={34} /></div>;
}

function collectImages(car: CatalogCar) {
  return [...new Set((car.car_media ?? [])
    .filter((media) => media.media_type === "image" && Boolean(media.url))
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order)
    .map((media) => media.url))];
}

function buildFacts(car: CatalogCar, specs: Record<string, unknown>) {
  const numberFrom = (...keys: string[]) => {
    for (const key of keys) {
      const value = specs[key] ?? (key === "engine_cc" ? car.engine_cc : key === "power_hp" ? car.power_hp : null);
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && /^\d+(?:[.,]\d+)?$/.test(value.trim())) return Number(value.replace(",", "."));
    }
    return null;
  };
  const textFrom = (...keys: string[]) => keys.map((key) => specs[key]).find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const mileage = car.vehicle_type === "jetski"
    ? numberFrom("engine_hours", "moto_hours", "hours", "operating_hours", "engine_status")
    : car.mileage_km;
  const mileageText = mileage != null ? `${number.format(mileage)} ${car.vehicle_type === "jetski" ? "моточасов" : "км"}` : null;
  const primary = [car.year ? `${car.year} г.` : null, mileageText, numberFrom("engine_cc") ? `${number.format(numberFrom("engine_cc")!)} см³` : null].filter((value): value is string => Boolean(value));
  const fuel = textFrom("fuel") ?? car.fuel_type;
  const transmission = textFrom("transmission") ?? car.transmission;
  const secondary = [
    numberFrom("power_hp") ? `${number.format(numberFrom("power_hp")!)} л.с.` : null,
    fuel ? translateFuel(fuel) : null,
    transmission ? translateTransmission(String(transmission)) : null,
    textFrom("drive_type", "drive", "propulsion", "engine_type"),
    textFrom("condition", "status"),
  ].filter((value): value is string => Boolean(value));
  return { primary, secondary: [...new Set(secondary)] };
}

function typeLabel(type: CatalogCar["vehicle_type"]) {
  if (type === "jetski") return "Гидроцикл";
  if (type === "scooter") return "Скутер";
  return "Мотоцикл";
}

async function shareListing(title: string, href: string) {
  const url = new URL(href, window.location.origin).toString();
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard?.writeText(url);
  } catch {
    // Closing a native share dialog is not an application error.
  }
}
