"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { RemoteImage } from "@/components/site/RemoteImage";

const MAX_PREVIEW_PHOTOS = 5;

type Props = {
  alt: string;
  href: string;
  mediaCount?: number | null;
  primaryImageUrl: string | null;
  priority?: boolean;
  source: string;
  sourceId: string;
};

/**
 * Compact catalogue gallery. It starts with one cover image and requests no
 * more than four additional previews only after the visitor starts browsing.
 */
export function CatalogCardPhotoGallery({ alt, href, mediaCount = 0, primaryImageUrl, priority = false, source, sourceId }: Props) {
  const [images, setImages] = useState(() => primaryImageUrl ? [primaryImageUrl] : []);
  const [selected, setSelected] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const imagesRef = useRef(images);
  const requestRef = useRef<Promise<string[]> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const declaredMediaCount = mediaCount ?? 0;
  const indicatorCount = Math.min(MAX_PREVIEW_PHOTOS, Math.max(images.length, declaredMediaCount));

  const loadImages = useCallback(async () => {
    if (imagesRef.current.length > 1 || declaredMediaCount < 2) return imagesRef.current;
    if (requestRef.current) return requestRef.current;

    setLoading(true);
    requestRef.current = fetch(`/api/catalog/preview-media?source=${encodeURIComponent(source)}&sourceId=${encodeURIComponent(sourceId)}`)
      .then(async (response) => response.ok ? response.json() as Promise<{ images?: unknown }> : { images: [] })
      .then((payload) => {
        const fetched = Array.isArray(payload.images)
          ? payload.images.filter((value): value is string => typeof value === "string" && Boolean(value))
          : [];
        const next = [...new Set([primaryImageUrl, ...fetched].filter((value): value is string => Boolean(value)))].slice(0, MAX_PREVIEW_PHOTOS);
        imagesRef.current = next;
        setImages(next);
        return next;
      })
      .catch(() => imagesRef.current)
      .finally(() => {
        requestRef.current = null;
        setLoading(false);
      });
    return requestRef.current;
  }, [declaredMediaCount, primaryImageUrl, source, sourceId]);

  const move = useCallback(async (direction: -1 | 1) => {
    const available = await loadImages();
    if (available.length < 2) return;
    setSelected((current) => (current + direction + available.length) % available.length);
  }, [loadImages]);

  const current = images[selected] ?? primaryImageUrl;
  const handleTouchEnd = (event: React.TouchEvent<HTMLAnchorElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const horizontalDistance = touch.clientX - start.x;
    const verticalDistance = touch.clientY - start.y;
    if (Math.abs(horizontalDistance) < 36 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    event.preventDefault();
    suppressClickRef.current = true;
    void move(horizontalDistance > 0 ? -1 : 1);
    window.setTimeout(() => { suppressClickRef.current = false; }, 350);
  };

  return (
    <div className="group relative aspect-[2.25/1] overflow-hidden bg-[#e8edf3] sm:aspect-[16/10]">
      {current ? (
        <Link
          aria-label={`Открыть карточку ${alt}`}
          className="group block h-full w-full touch-pan-y"
          href={href}
          onClick={(event) => {
            if (!suppressClickRef.current) return;
            event.preventDefault();
            suppressClickRef.current = false;
          }}
          onTouchEnd={handleTouchEnd}
          onTouchStart={(event) => { touchStartRef.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 }; }}
        >
          <RemoteImage alt={`${alt}, фото ${selected + 1}`} className="object-cover transition duration-300 group-hover:scale-[1.015]" decoding="async" fill loading={priority && selected === 0 ? "eager" : "lazy"} priority={priority && selected === 0} sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, calc(100vw - 48px)" src={current} />
        </Link>
      ) : (
        <Link aria-label={`Открыть карточку ${alt}`} className="flex h-full items-center justify-center text-sm text-[#647084]" href={href}>Фото временно недоступно</Link>
      )}

      {indicatorCount > 1 ? <div aria-label={`Фото ${selected + 1} из ${indicatorCount}`} className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-[#101827]/35 px-2 py-1" role="status">
        {Array.from({ length: indicatorCount }, (_, index) => <span className={`h-1.5 rounded-full bg-white shadow-sm ${index === selected ? "w-4" : "w-1.5 opacity-70"}`} key={index} />)}
        {isLoading ? <ImageIcon className="ml-0.5 text-white/80" size={11} /> : null}
      </div> : null}

      {indicatorCount > 1 ? <div className="absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-2 sm:flex">
        <button aria-label="Предыдущее фото" className="grid size-8 place-items-center rounded-full bg-white/90 text-[#152035] opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-white" onClick={() => void move(-1)} type="button"><ChevronLeft size={18} /></button>
        <button aria-label="Следующее фото" className="grid size-8 place-items-center rounded-full bg-white/90 text-[#152035] opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-white" onClick={() => void move(1)} type="button"><ChevronRight size={18} /></button>
      </div> : null}
    </div>
  );
}
