"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";
import { publicMediaUrl } from "@/lib/media-url";

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
      <div className="rounded bg-white p-4 shadow-sm ring-1 ring-[#d8dde6] sm:p-5">
        <div className="flex items-center gap-2">
          <Camera className="text-[#a98239]" size={20} />
          <div>
            <h2 className="text-lg font-semibold sm:text-xl">Фото осмотра</h2>
            <p className="mt-1 text-xs text-[#647084] sm:text-sm">
              Материалы проверки, полученные из Encar
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
              src={publicMediaUrl(selected.url)}
              unoptimized
            />
          </div>
        </div>
      )}
    </>
  );
}
