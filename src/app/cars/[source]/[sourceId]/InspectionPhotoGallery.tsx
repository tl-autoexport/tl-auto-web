"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Camera, ChevronDown, X } from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";

type InspectionPhoto = {
  url: string;
  thumbnail_url: string | null;
  sort_order: number;
};

export function InspectionPhotoGallery({
  media,
  title,
}: {
  media: InspectionPhoto[];
  title: string;
}) {
  const [selected, setSelected] = useState<InspectionPhoto | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ordered = [...media].sort((left, right) => left.sort_order - right.sort_order);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return (
    <>
      <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#d8dde6]">
        <button
          aria-controls="inspection-photo-gallery"
          aria-expanded={expanded}
          className="flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fbfaf7] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#a98239] sm:px-5"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f8f4eb] text-[#a98239]">
            <Camera size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-[#101827] sm:text-lg">Фото осмотра</span>
            <span className="mt-0.5 block text-xs text-[#718096] sm:text-sm">
              {ordered.length} {ordered.length === 1 ? "фотография" : ordered.length > 1 && ordered.length < 5 ? "фотографии" : "фотографий"} Encar
            </span>
          </span>
          <span className="mr-1 hidden rounded-full bg-[#f4f5f7] px-3 py-1 text-xs font-medium text-[#647084] sm:inline-flex">
            {expanded ? "Свернуть" : "Показать фото"}
          </span>
          <ChevronDown aria-hidden="true" className={`shrink-0 text-[#7a8798] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} size={20} />
        </button>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          id="inspection-photo-gallery"
          inert={!expanded}
        >
          <div className="overflow-hidden">
            <div className="grid gap-3 border-t border-[#edf0f4] bg-[#fcfcfb] p-4 sm:grid-cols-2 sm:p-5">
          {ordered.map((image, index) => (
            <figure
              className="overflow-hidden rounded bg-[#f7f9fb] ring-1 ring-[#e8ecf2]"
              key={`${image.url}-${index}`}
            >
              <button
                className="block w-full cursor-zoom-in text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a98239] focus-visible:ring-inset"
                onClick={() => setSelected(image)}
                type="button"
                aria-label={`Увеличить фото осмотра ${index + 1}`}
              >
                <div className="relative aspect-[4/3]">
                  <RemoteImage
                    alt={`${title} — фото осмотра Encar`}
                    className="object-contain"
                    fill
                    loading="lazy"
                    sizes="(min-width: 640px) 50vw, 100vw"
                    src={image.thumbnail_url ?? image.url}
                    fallback="Фото осмотра недоступно"
                  />
                </div>
                <figcaption className="border-t border-[#e8ecf2] px-3 py-2 text-xs text-[#647084]">
                  {index === 0 ? "Основной кадр осмотра" : `Кадр осмотра ${index + 1}`}
                  <span className="ml-2 text-[#a98239]">Нажмите для увеличения</span>
                </figcaption>
              </button>
            </figure>
          ))}
            </div>
          </div>
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07101c]/90 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Увеличенное фото осмотра"
          onClick={() => setSelected(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => setSelected(null)}
            type="button"
            aria-label="Закрыть увеличенное фото"
          >
            <X size={24} />
          </button>
          <div
            className="relative h-[min(86vh,900px)] w-[min(94vw,1200px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              alt={`${title} — увеличенное фото осмотра Encar`}
              className="object-contain"
              fill
              priority
              sizes="94vw"
              src={selected.url}
              unoptimized
            />
          </div>
        </div>
      )}
    </>
  );
}
