"use client";

import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from "react";
import { passoImageProxyUrl } from "@/lib/passo-image";
import { RemoteImage } from "@/components/site/RemoteImage";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

export function PassoMediaGallery({ title, urls }: { title: string; urls: string[] }) {
  const images = [...new Set(urls.filter(Boolean))];
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const suppressOpen = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = images[selected] ?? null;
  const close = () => setOpen(false);

  useDialogAccessibility({ dialogRef, initialFocusRef: closeRef, onClose: close, open });

  useEffect(() => {
    if (!open || images.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setSelected((value) => (value - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setSelected((value) => (value + 1) % images.length);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [images.length, open]);

  if (!current) return <div className="flex aspect-[4/3] items-center justify-center rounded-[20px] bg-[#e9edf3] text-[#647084]"><ImageIcon size={40} /></div>;

  const previous = () => setSelected((value) => (value - 1 + images.length) % images.length);
  const next = () => setSelected((value) => (value + 1) % images.length);
  const updateFromScroll = (scrollLeft: number, firstSlide: HTMLElement | null, gap: number) => {
    if (!firstSlide) return;
    setSelected(Math.max(0, Math.min(images.length - 1, Math.round(scrollLeft / (firstSlide.offsetWidth + gap)))));
  };
  const openFromRail = () => {
    if (!suppressOpen.current) setOpen(true);
  };

  return (
    <>
      <div className="relative bg-[#eef1f5] p-1.5 sm:hidden">
        <div
          aria-label={`Лента фотографий: ${title}`}
          className="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto touch-pan-x"
          onClick={openFromRail}
          onScroll={(event) => updateFromScroll(event.currentTarget.scrollLeft, event.currentTarget.firstElementChild as HTMLElement | null, 8)}
          onTouchEnd={(event) => {
            const start = touchStartX.current;
            touchStartX.current = null;
            if (start !== null && Math.abs(event.changedTouches[0]?.clientX - start) > 10) {
              suppressOpen.current = true;
              window.setTimeout(() => { suppressOpen.current = false; }, 0);
            }
          }}
          onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
          role="button"
          tabIndex={0}
        >
          {images.map((url, index) => <div className="relative aspect-[16/10] w-[calc(100%-32px)] shrink-0 snap-start overflow-hidden rounded-[18px] bg-[#dfe4ec]" key={url}><RemoteImage alt={`${title}, фото ${index + 1}`} className="object-cover" fill loading={index === 0 ? "eager" : "lazy"} sizes="calc(100vw - 48px)" src={passoImageProxyUrl(url)} fallback={<ImageIcon size={32} />} /></div>)}
        </div>
        {images.length > 1 ? <Counter current={selected} total={images.length} /> : null}
      </div>

      <div className="relative hidden aspect-[4/3] overflow-hidden rounded-[20px] bg-[#eef1f5] p-1.5 sm:block">
        <button aria-label="Открыть фото в полном размере" className="group relative block h-full w-full cursor-zoom-in overflow-hidden rounded-[16px]" onClick={() => setOpen(true)} type="button"><RemoteImage alt={title} className="object-contain transition duration-300 group-hover:scale-[1.01]" fill priority sizes="(min-width: 1024px) 60vw, 100vw" src={passoImageProxyUrl(current)} fallback={<ImageIcon size={40} />} /></button>
        {images.length > 1 ? <><button aria-label="Предыдущее фото" className="absolute left-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[#152035] shadow-md transition hover:scale-105" onClick={previous} type="button"><ChevronLeft size={24} /></button><button aria-label="Следующее фото" className="absolute right-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[#152035] shadow-md transition hover:scale-105" onClick={next} type="button"><ChevronRight size={24} /></button><Counter current={selected} total={images.length} /></> : null}
      </div>

      {images.length > 1 ? <div className="mt-3 hidden grid-cols-4 gap-2 sm:grid sm:grid-cols-5">{images.map((url, index) => <button aria-label={`Выбрать фото ${index + 1}`} className={`relative aspect-square overflow-hidden rounded-lg bg-[#e9edf3] ${index === selected ? "ring-2 ring-[#a98239]" : "ring-1 ring-[#d8dde6]"}`} key={url} onClick={() => setSelected(index)} type="button"><RemoteImage alt={`${title}, фото ${index + 1}`} className="object-cover" fill sizes="(min-width: 640px) 120px, 22vw" src={passoImageProxyUrl(url)} fallback={<ImageIcon size={20} />} /></button>)}</div> : null}

      {open ? <FullscreenGallery close={close} closeRef={closeRef} dialogRef={dialogRef} images={images} selected={selected} setSelected={setSelected} title={title} /> : null}
    </>
  );
}

function FullscreenGallery({ close, closeRef, dialogRef, images, selected, setSelected, title }: { close: () => void; closeRef: RefObject<HTMLButtonElement | null>; dialogRef: RefObject<HTMLDivElement | null>; images: string[]; selected: number; setSelected: Dispatch<SetStateAction<number>>; title: string }) {
  const move = (direction: -1 | 1) => setSelected((value) => (value + direction + images.length) % images.length);
  const updateFromScroll = (scrollLeft: number, firstSlide: HTMLElement | null) => {
    if (!firstSlide) return;
    setSelected(Math.max(0, Math.min(images.length - 1, Math.round(scrollLeft / (firstSlide.offsetWidth + 12)))));
  };
  return <div aria-label={`Фотогалерея ${title}`} aria-modal="true" className="fixed inset-0 z-[100] flex flex-col bg-[#07101c]/95 text-white" ref={dialogRef} role="dialog" tabIndex={-1}>
    <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-semibold sm:text-base">{title}</p><p className="text-xs text-white/60">{selected + 1} из {images.length}</p></div><button aria-label="Закрыть фотогалерею" className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={close} ref={closeRef} type="button"><X size={22} /></button></div>
    <div className="relative min-h-0 flex-1 p-3 sm:p-8">
      <div className="scrollbar-none flex h-full snap-x snap-mandatory gap-3 overflow-x-auto sm:hidden" onScroll={(event) => updateFromScroll(event.currentTarget.scrollLeft, event.currentTarget.firstElementChild as HTMLElement | null)}>{images.map((url, index) => <div className="relative h-full w-full shrink-0 snap-center" key={url}><RemoteImage alt={`${title}, фото ${index + 1}`} className="object-contain" fill priority={index === selected} sizes="100vw" src={passoImageProxyUrl(url)} fallback="Фото временно недоступно" /></div>)}</div>
      <div className="relative hidden h-full sm:block"><RemoteImage alt={`${title}, фото ${selected + 1}`} className="object-contain" fill priority sizes="100vw" src={passoImageProxyUrl(images[selected])} fallback="Фото временно недоступно" />{images.length > 1 ? <><button aria-label="Предыдущее фото" className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80" onClick={() => move(-1)} type="button"><ChevronLeft size={24} /></button><button aria-label="Следующее фото" className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80" onClick={() => move(1)} type="button"><ChevronRight size={24} /></button></> : null}</div>
    </div>
  </div>;
}

function Counter({ current, total }: { current: number; total: number }) {
  return <span className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-[#152035]/85 px-2.5 py-1 text-xs font-semibold text-white">{current + 1} / {total}</span>;
}
