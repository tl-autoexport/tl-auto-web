"use client";

import { ChevronLeft, ChevronRight, Image as ImageIcon, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { passoImageProxyUrl } from "@/lib/passo-image";
import { RemoteImage } from "@/components/site/RemoteImage";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

export function PassoMediaGallery({ title, urls }: { title: string; urls: string[] }) {
  const images = [...new Set(urls.filter(Boolean))];
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
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

  if (!current) return <div className="flex aspect-[4/3] items-center justify-center rounded bg-[#e9edf3] text-[#647084]"><ImageIcon size={40} /></div>;

  const show = (index: number) => {
    setSelected(index);
    setOpen(true);
  };
  const previous = () => setSelected((value) => (value - 1 + images.length) % images.length);
  const next = () => setSelected((value) => (value + 1) % images.length);

  return (
    <>
      <div className="relative aspect-[4/3] overflow-hidden rounded bg-[#e9edf3]">
        <button aria-label="Открыть фото в полном размере" className="group relative block h-full w-full cursor-zoom-in" onClick={() => setOpen(true)} type="button">
          <RemoteImage alt={title} className="object-contain transition duration-300 group-hover:scale-[1.01]" fill priority sizes="(min-width: 1024px) 60vw, 100vw" src={passoImageProxyUrl(current)} fallback={<ImageIcon size={40} />} />
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[#07101c]/80 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"><Maximize2 size={15} /> Увеличить</span>
        </button>
        {images.length > 1 ? <span className="absolute right-3 top-3 rounded bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">{selected + 1} / {images.length}</span> : null}
      </div>

      {images.length > 1 ? <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">{images.map((url, index) => <button aria-label={`Открыть фото ${index + 1}`} className={`relative aspect-square overflow-hidden rounded bg-[#e9edf3] ${index === selected ? "ring-2 ring-[#a98239]" : "ring-1 ring-[#d8dde6]"}`} key={url} onClick={() => show(index)} type="button"><RemoteImage alt={`${title}, фото ${index + 1}`} className="object-cover" fill sizes="(min-width: 640px) 120px, 22vw" src={passoImageProxyUrl(url)} fallback={<ImageIcon size={20} />} /></button>)}</div> : null}

      {open ? <div aria-label={`Фотогалерея ${title}`} aria-modal="true" className="fixed inset-0 z-[100] flex flex-col bg-[#07101c]/95 text-white" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-semibold sm:text-base">{title}</p><p className="text-xs text-white/60">{selected + 1} из {images.length}</p></div><button aria-label="Закрыть фотогалерею" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={close} ref={closeRef} type="button"><X size={22} /></button></div>
        <div className="relative min-h-0 flex-1 p-4 sm:p-8"><RemoteImage alt={`${title}, фото ${selected + 1}`} className="object-contain" fill priority sizes="100vw" src={passoImageProxyUrl(current)} fallback="Фото временно недоступно" />{images.length > 1 ? <><button aria-label="Предыдущее фото" className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80 sm:left-6" onClick={previous} type="button"><ChevronLeft size={24} /></button><button aria-label="Следующее фото" className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 transition hover:bg-black/80 sm:right-6" onClick={next} type="button"><ChevronRight size={24} /></button></> : null}</div>
        {images.length > 1 ? <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-black/25 px-4 py-3 sm:px-6">{images.map((url, index) => <button aria-label={`Выбрать фото ${index + 1}`} className={`relative h-14 w-20 shrink-0 overflow-hidden rounded ${index === selected ? "ring-2 ring-[#cda54c]" : "ring-1 ring-white/20"}`} key={`${url}-modal`} onClick={() => setSelected(index)} type="button"><RemoteImage alt="" className="object-cover" fill sizes="80px" src={passoImageProxyUrl(url)} fallback="Нет фото" /></button>)}</div> : null}
      </div> : null}
    </>
  );
}
