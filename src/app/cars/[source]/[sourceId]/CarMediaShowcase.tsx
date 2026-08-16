"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Images, Maximize2, Rotate3D, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";
import { RemoteImage } from "@/components/site/RemoteImage";

type Media = {
  url: string;
  thumbnail_url: string | null;
  media_type: string;
  category: string | null;
  is_primary: boolean;
  sort_order: number;
};

export function CarMediaShowcase({
  title,
  images,
  actions,
  sourceLabel,
}: {
  title: string;
  images: Media[];
  actions: Media[];
  sourceLabel: string;
}) {
  const exterior360 = actions.find((media) => media.category === "exterior_360");
  const interior360 = actions.find((media) => media.category === "interior_360");
  const [mode, setMode] = useState<"photo" | "exterior360" | "interior360">("photo");
  const [selected, setSelected] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryAlbum, setGalleryAlbum] = useState<GalleryAlbum>("all");
  const galleryDialogRef = useRef<HTMLDivElement>(null);
  const galleryCloseRef = useRef<HTMLButtonElement>(null);
  const selectedImage = images[selected] ?? images[0] ?? null;
  const previewImages = images.length > 6 ? images.slice(0, 5) : images.slice(0, 6);
  const hiddenImagesCount = images.length > 6 ? images.length - previewImages.length : 0;
  const filteredIndexes = useMemo(
    () =>
      images
        .map((media, index) => ({ album: mediaAlbum(media.category), index }))
        .filter((item) => galleryAlbum === "all" || item.album === galleryAlbum)
        .map((item) => item.index),
    [galleryAlbum, images],
  );
  const albums = useMemo(() => {
    const available = new Set(images.map((media) => mediaAlbum(media.category)));
    if (available.size <= 1) return galleryAlbums.filter((album) => album.key === "all");
    return galleryAlbums.filter((album) => album.key === "all" || available.has(album.key));
  }, [images]);
  const counter = useMemo(() => {
    if (!images.length) return null;
    return `${selected + 1} / ${images.length}`;
  }, [images.length, selected]);

  function moveGallery(direction: -1 | 1) {
    const indexes = filteredIndexes.length ? filteredIndexes : images.map((_, index) => index);
    if (!indexes.length) return;
    const currentPosition = indexes.indexOf(selected);
    const nextPosition = currentPosition < 0
      ? 0
      : (currentPosition + direction + indexes.length) % indexes.length;
    setSelected(indexes[nextPosition]);
  }

  function selectAlbum(album: GalleryAlbum) {
    setGalleryAlbum(album);
    const firstIndex = images.findIndex((media) => album === "all" || mediaAlbum(media.category) === album);
    if (firstIndex >= 0) setSelected(firstIndex);
  }

  useDialogAccessibility({
    dialogRef: galleryDialogRef,
    initialFocusRef: galleryCloseRef,
    onClose: () => setGalleryOpen(false),
    open: galleryOpen,
  });

  useEffect(() => {
    if (!galleryOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") moveGallery(-1);
      if (event.key === "ArrowRight") moveGallery(1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  return (
    <>
    <div className="overflow-hidden rounded bg-white shadow-sm ring-1 ring-[#d8dde6]">
      <div className="relative aspect-[16/10] bg-[#dfe4ec]">
        {mode === "exterior360" && exterior360 ? (
          <Exterior360Viewer media={exterior360} title={title} />
        ) : mode === "interior360" && interior360 ? (
          <Interior360Viewer media={interior360} title={title} />
        ) : selectedImage ? (
          <RemoteImage
            alt={title}
            className="object-cover"
            fill
            fetchPriority="high"
            loading="eager"
            sizes="(min-width: 1024px) 60vw, 100vw"
            src={selectedImage.url}
            fallback="Фото временно недоступно"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[#647084]">Нет фото</div>
        )}

        <div className="absolute left-3 top-3 flex gap-1.5 sm:left-4 sm:top-4 sm:gap-2">
          <span className="rounded bg-white/95 px-2 py-1 text-[10px] font-semibold shadow-sm sm:px-3 sm:text-xs">Корея</span>
          <span className="rounded bg-[#177d69]/95 px-2 py-1 text-[10px] font-semibold text-white shadow-sm sm:px-3 sm:text-xs">{sourceLabel}</span>
        </div>

        <div className="absolute bottom-4 left-4 hidden flex-wrap gap-2 sm:flex">
          {exterior360 && (
            <button
              aria-pressed={mode === "exterior360"}
              className={mode === "exterior360" ? activePillClass : idlePillClass}
              onClick={() => setMode("exterior360")}
              type="button"
            >
              <Rotate3D size={16} />
              360° кузов
            </button>
          )}
          {selectedImage && (
            <button
              aria-pressed={mode === "photo"}
              className={mode === "photo" ? activePillClass : idlePillClass}
              onClick={() => setMode("photo")}
              type="button"
            >
              <Images size={16} />
              Фото
            </button>
          )}
          {interior360 && (
            <button
              aria-pressed={mode === "interior360"}
              className={mode === "interior360" ? activePillClass : idlePillClass}
              onClick={() => setMode("interior360")}
              type="button"
            >
              <Rotate3D size={16} />
              360° салон
            </button>
          )}
        </div>

        {counter && mode === "photo" && (
          <div className="absolute bottom-3 right-3 rounded bg-black/65 px-2.5 py-1 text-xs font-semibold text-white sm:bottom-4 sm:right-4 sm:px-3 sm:text-sm">
            {counter}
          </div>
        )}

        {selectedImage && mode === "photo" && (
          <button
            aria-label="Открыть все фотографии"
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/65 text-white shadow backdrop-blur transition hover:bg-black/80 sm:right-4 sm:top-4 sm:h-10 sm:w-10"
            onClick={() => setGalleryOpen(true)}
            title="Открыть все фотографии"
            type="button"
          >
            <Maximize2 size={18} />
          </button>
        )}
      </div>

      {(exterior360 || selectedImage || interior360) && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-[#edf0f5] px-3 py-2.5 sm:hidden">
          {selectedImage && (
            <button
              aria-pressed={mode === "photo"}
              className={mode === "photo" ? activePillClass : idlePillClass}
              onClick={() => setMode("photo")}
              type="button"
            >
              <Images size={15} />
              Фото
            </button>
          )}
          {exterior360 && (
            <button
              aria-pressed={mode === "exterior360"}
              className={mode === "exterior360" ? activePillClass : idlePillClass}
              onClick={() => setMode("exterior360")}
              type="button"
            >
              <Rotate3D size={15} />
              Кузов 360°
            </button>
          )}
          {interior360 && (
            <button
              aria-pressed={mode === "interior360"}
              className={mode === "interior360" ? activePillClass : idlePillClass}
              onClick={() => setMode("interior360")}
              type="button"
            >
              <Rotate3D size={15} />
              Салон 360°
            </button>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="border-t border-[#edf0f5] px-3 py-2.5 sm:p-3">
          <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto pb-0.5 sm:grid sm:grid-cols-6 sm:overflow-visible">
            {previewImages.map((media, index) => (
              <button
                aria-label={`Открыть фото ${index + 1}: ${mediaCategoryLabel(media.category)}`}
                className={`relative aspect-[7/5] w-[88px] shrink-0 snap-start overflow-hidden rounded bg-[#dfe4ec] ring-offset-2 transition sm:w-auto sm:min-w-0 ${
                  mode === "photo" && index === selected ? "ring-2 ring-[#956f2c]" : "ring-1 ring-[#d8dde6]"
                }`}
                key={media.url}
                onClick={() => {
                  setSelected(index);
                  setMode("photo");
                }}
                type="button"
              >
                <RemoteImage
                  alt={title}
                  className="object-cover"
                  fill
                  sizes="112px"
                  src={media.thumbnail_url ?? media.url}
                  fallback="Нет фото"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {mediaCategoryLabel(media.category)}
                </span>
              </button>
            ))}
            {hiddenImagesCount > 0 && (
              <button
                aria-label={`Открыть остальные фотографии, ещё ${hiddenImagesCount}`}
                className="relative aspect-[7/5] w-[88px] shrink-0 snap-start overflow-hidden rounded bg-[#1a202b] text-white ring-1 ring-[#d8dde6] ring-offset-2 sm:w-auto sm:min-w-0"
                onClick={() => {
                  setSelected(previewImages.length);
                  setGalleryAlbum("all");
                  setMode("photo");
                  setGalleryOpen(true);
                }}
                type="button"
              >
                <RemoteImage
                  alt=""
                  className="object-cover opacity-45"
                  fill
                  sizes="112px"
                  src={images[previewImages.length]?.thumbnail_url ?? images[previewImages.length]?.url}
                  fallback="Нет фото"
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center text-xs font-bold sm:text-sm">
                  <Images size={18} />
                  Ещё {hiddenImagesCount}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>

    {galleryOpen && selectedImage && (
      <div
        ref={galleryDialogRef}
        aria-label={`Фотогалерея ${title}`}
        aria-modal="true"
        className="fixed inset-0 z-[90] flex flex-col bg-[#090d14]/[0.97] text-white"
        role="dialog"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
            <p className="text-xs text-white/60">{selected + 1} из {images.length}</p>
          </div>
          <button
            ref={galleryCloseRef}
            aria-label="Закрыть фотогалерею"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            onClick={() => setGalleryOpen(false)}
            type="button"
          >
            <X size={22} />
          </button>
        </div>

        <ZoomableGalleryImage
          alt={`${title}, фото ${selected + 1}`}
          key={selectedImage.url}
          onSwipe={moveGallery}
          src={selectedImage.url}
        >
          {filteredIndexes.length > 1 && (
            <>
              <button
                aria-label="Предыдущее фото"
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 backdrop-blur transition hover:bg-black/80 sm:left-6"
                onClick={(event) => {
                  event.stopPropagation();
                  moveGallery(-1);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                aria-label="Следующее фото"
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 backdrop-blur transition hover:bg-black/80 sm:right-6"
                onClick={(event) => {
                  event.stopPropagation();
                  moveGallery(1);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </ZoomableGalleryImage>

        <div className="shrink-0 border-t border-white/10 bg-black/25 px-4 pb-4 pt-3 sm:px-6">
          {albums.length > 1 && (
            <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
              {albums.map((album) => (
                <button
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${
                    galleryAlbum === album.key ? "bg-[#956f2c] text-white" : "bg-white/10 text-white/75 hover:bg-white/20"
                  }`}
                  key={album.key}
                  onClick={() => selectAlbum(album.key)}
                  type="button"
                >
                  {album.label}
                </button>
              ))}
            </div>
          )}
          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
            {filteredIndexes.map((imageIndex) => {
              const media = images[imageIndex];
              return (
                <button
                  aria-label={`Открыть фото ${imageIndex + 1}`}
                  className={`relative h-14 w-20 shrink-0 overflow-hidden rounded ${
                    imageIndex === selected ? "ring-2 ring-[#956f2c]" : "ring-1 ring-white/20"
                  }`}
                  key={`${media.url}-modal`}
                  onClick={() => setSelected(imageIndex)}
                  type="button"
                >
                  <RemoteImage alt="" className="object-cover" fill sizes="80px" src={media.thumbnail_url ?? media.url} fallback="Нет фото" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

const MIN_GALLERY_SCALE = 1;
const MAX_GALLERY_SCALE = 4;

type GalleryTransform = {
  scale: number;
  x: number;
  y: number;
};

type GalleryGesture = {
  moved: boolean;
  pinch: boolean;
  startCenter: { x: number; y: number };
  startDistance: number;
  startTransform: GalleryTransform;
  startX: number;
  lastX: number;
  lastY: number;
};

function ZoomableGalleryImage({
  alt,
  children,
  onSwipe,
  src,
}: {
  alt: string;
  children: ReactNode;
  onSwipe: (direction: -1 | 1) => void;
  src: string;
}) {
  const [transform, setTransform] = useState<GalleryTransform>({ scale: 1, x: 0, y: 0 });
  const [originalReady, setOriginalReady] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<GalleryGesture | null>(null);
  const transformRef = useRef(transform);
  const suppressClickRef = useRef(false);

  function clampTransform(next: GalleryTransform): GalleryTransform {
    const stage = stageRef.current;
    const scale = Math.min(MAX_GALLERY_SCALE, Math.max(MIN_GALLERY_SCALE, next.scale));
    if (!stage || scale === 1) return { scale, x: 0, y: 0 };
    const maxX = (stage.clientWidth * (scale - 1)) / 2;
    const maxY = (stage.clientHeight * (scale - 1)) / 2;
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function updateTransform(next: GalleryTransform) {
    const clamped = clampTransform(next);
    transformRef.current = clamped;
    setTransform(clamped);
  }

  function resetZoom() {
    updateTransform({ scale: 1, x: 0, y: 0 });
    setOriginalReady(false);
  }

  function zoomAt(nextScale: number, clientX?: number, clientY?: number) {
    const current = transformRef.current;
    const stage = stageRef.current;
    const scale = Math.min(MAX_GALLERY_SCALE, Math.max(MIN_GALLERY_SCALE, nextScale));
    if (!stage || scale === 1) {
      resetZoom();
      return;
    }
    const rect = stage.getBoundingClientRect();
    const offsetX = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const offsetY = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    const ratio = scale / current.scale;
    updateTransform({
      scale,
      x: offsetX - (offsetX - current.x) * ratio,
      y: offsetY - (offsetY - current.y) * ratio,
    });
  }

  function beginGesture() {
    const points = [...pointersRef.current.values()];
    const current = transformRef.current;
    if (points.length >= 2) {
      const [first, second] = points;
      gestureRef.current = {
        moved: true,
        pinch: true,
        startCenter: midpoint(first, second),
        startDistance: distance(first, second),
        startTransform: current,
        startX: first.x,
        lastX: first.x,
        lastY: first.y,
      };
      suppressClickRef.current = true;
      return;
    }
    const point = points[0];
    if (!point) return;
    gestureRef.current = {
      moved: false,
      pinch: false,
      startCenter: point,
      startDistance: 0,
      startTransform: current,
      startX: point.x,
      lastX: point.x,
      lastY: point.y,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setInteracting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    beginGesture();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (!gesture) return;

    if (points.length >= 2) {
      if (!gesture.pinch) {
        beginGesture();
        return;
      }
      const [first, second] = points;
      const center = midpoint(first, second);
      const scale = gesture.startTransform.scale * (distance(first, second) / Math.max(gesture.startDistance, 1));
      updateTransform({
        scale,
        x: gesture.startTransform.x + center.x - gesture.startCenter.x,
        y: gesture.startTransform.y + center.y - gesture.startCenter.y,
      });
      return;
    }

    const point = points[0];
    if (!point) return;
    const deltaX = point.x - gesture.lastX;
    const deltaY = point.y - gesture.lastY;
    if (Math.abs(point.x - gesture.startX) > 5 || Math.abs(point.y - gesture.startCenter.y) > 5) {
      gesture.moved = true;
      suppressClickRef.current = true;
    }
    gesture.lastX = point.x;
    gesture.lastY = point.y;
    if (transformRef.current.scale > 1) {
      updateTransform({
        ...transformRef.current,
        x: transformRef.current.x + deltaX,
        y: transformRef.current.y + deltaY,
      });
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      gesture &&
      !gesture.pinch &&
      transformRef.current.scale === 1 &&
      Math.abs(event.clientX - gesture.startX) > 50
    ) {
      onSwipe(event.clientX > gesture.startX ? -1 : 1);
      suppressClickRef.current = true;
    }
    if (pointersRef.current.size) beginGesture();
    else {
      gestureRef.current = null;
      setInteracting(false);
    }
  }

  function handleStageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (transformRef.current.scale > 1) resetZoom();
    else zoomAt(2, event.clientX, event.clientY);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.84 : 1.18;
    zoomAt(transformRef.current.scale * factor, event.clientX, event.clientY);
  }

  const percentage = Math.round(transform.scale * 100);
  const isZoomed = transform.scale > 1;

  return (
    <div
      aria-label={`${alt}. Нажмите для увеличения, используйте колесо мыши или жест двумя пальцами`}
      className={`relative min-h-0 flex-1 overflow-hidden touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 ${
        isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
      }`}
      onClick={handleStageClick}
      onKeyDown={(event) => {
        if (event.key === "+" || event.key === "=") zoomAt(transformRef.current.scale * 1.25);
        if (event.key === "-") zoomAt(transformRef.current.scale / 1.25);
        if (event.key === "0") resetZoom();
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (isZoomed) resetZoom();
          else zoomAt(2);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      ref={stageRef}
      role="region"
      tabIndex={0}
    >
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          transformOrigin: "center",
          transition: interacting ? "none" : "transform 180ms ease-out",
        }}
      >
        <RemoteImage
          alt={alt}
          className="pointer-events-none object-contain p-3 sm:p-8"
          fill
          loading="eager"
          onLoad={() => {
            if (transformRef.current.scale > 1) setOriginalReady(true);
          }}
          sizes="100vw"
          src={src}
          fallback="Фото временно недоступно"
        />
      </div>

      <div
        className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/65 p-1 text-white shadow backdrop-blur"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Уменьшить фотографию"
          className="grid size-9 place-items-center rounded-full transition hover:bg-white/15 disabled:opacity-35"
          disabled={!isZoomed}
          onClick={() => zoomAt(transformRef.current.scale / 1.25)}
          type="button"
        >
          <ZoomOut size={17} />
        </button>
        <span aria-live="polite" className="min-w-14 text-center text-xs font-bold">{percentage}%</span>
        <button
          aria-label="Увеличить фотографию"
          className="grid size-9 place-items-center rounded-full transition hover:bg-white/15 disabled:opacity-35"
          disabled={transform.scale >= MAX_GALLERY_SCALE}
          onClick={() => zoomAt(transformRef.current.scale * 1.25)}
          type="button"
        >
          <ZoomIn size={17} />
        </button>
        <button
          aria-label="Сбросить масштаб"
          className="grid size-9 place-items-center rounded-full transition hover:bg-white/15 disabled:opacity-35"
          disabled={!isZoomed}
          onClick={resetZoom}
          type="button"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <a
        className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full bg-black/65 px-3 py-2 text-xs font-semibold text-white shadow backdrop-blur transition hover:bg-black/85"
        href={src}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink size={14} />
        Оригинал
      </a>

      {!isZoomed && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-2 text-[11px] font-medium text-white/90 backdrop-blur">
          Нажмите для увеличения · на телефоне разведите пальцы
        </p>
      )}
      {isZoomed && !originalReady && (
        <p className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/65 px-3 py-2 text-[11px] font-medium text-white/90 backdrop-blur">
          Загружаем оригинал…
        </p>
      )}

      {children}
    </div>
  );
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: { x: number; y: number }, second: { x: number; y: number }) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function Exterior360Viewer({ media, title }: { media: Media; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ x: number; time: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateProgress = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setProgress((video.currentTime / video.duration) * 100);
      }
    };
    const startPlayback = () => {
      video.play().catch(() => undefined);
    };

    video.addEventListener("loadedmetadata", startPlayback);
    video.addEventListener("timeupdate", updateProgress);
    return () => {
      video.removeEventListener("loadedmetadata", startPlayback);
      video.removeEventListener("timeupdate", updateProgress);
    };
  }, []);

  function setVideoTime(clientX: number) {
    const video = videoRef.current;
    const drag = dragRef.current;
    if (!video || !drag || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const rect = video.getBoundingClientRect();
    const delta = (clientX - drag.x) / Math.max(rect.width, 1);
    const next = (drag.time + delta * video.duration + video.duration) % video.duration;
    video.currentTime = next;
    setProgress((next / video.duration) * 100);
  }

  function step(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.pause();
    video.currentTime = (video.currentTime + direction * video.duration * 0.035 + video.duration) % video.duration;
    setProgress((video.currentTime / video.duration) * 100);
  }

  return (
    <div className="group relative h-full w-full overflow-hidden bg-[#dfe4ec]">
      <video
        aria-label={`Панорама кузова ${title}`}
        className="h-full w-full cursor-grab touch-none select-none object-cover active:cursor-grabbing"
        loop
        muted
        playsInline
        poster={media.thumbnail_url ?? undefined}
        preload="metadata"
        ref={videoRef}
        src={media.url}
        onPointerDown={(event) => {
          const video = videoRef.current;
          if (!video) return;
          video.pause();
          setDragging(true);
          dragRef.current = { x: event.clientX, time: video.currentTime || 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => setVideoTime(event.clientX)}
        onPointerUp={(event) => {
          dragRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent" />
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <button
          aria-label="Повернуть влево"
          className="grid size-11 place-items-center rounded-full bg-black/65 text-white shadow backdrop-blur transition hover:bg-black/80"
          onClick={() => step(-1)}
          title="Повернуть влево"
          type="button"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="relative h-11 w-16 overflow-hidden rounded-full bg-black/65 px-2 shadow backdrop-blur sm:w-20">
          <div className="absolute inset-y-0 left-0 bg-[#956f2c]/85 transition-[width] duration-100" style={{ width: `${progress}%` }} />
          <div className="relative flex h-full items-center justify-center gap-2 text-xs font-bold text-white">
            <Rotate3D className={`hidden sm:block ${dragging ? "" : "animate-pulse"}`} size={16} />
            360°
          </div>
        </div>
        <button
          aria-label="Повернуть вправо"
          className="grid size-11 place-items-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/80"
          onClick={() => step(1)}
          title="Повернуть вправо"
          type="button"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function Interior360Viewer({ media, title }: { media: Media; title: string }) {
  return (
    <div className="relative h-full w-full bg-[#11161f]">
      <iframe
        allowFullScreen
        className="h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={media.url}
        title={`Панорама салона ${title}`}
      />
      <a
        aria-label="Открыть панораму салона в новой вкладке"
        className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-black/65 text-white shadow backdrop-blur transition hover:bg-black/80"
        href={media.url}
        rel="noreferrer"
        target="_blank"
        title="Открыть в новой вкладке"
      >
        <ExternalLink size={17} />
      </a>
    </div>
  );
}

const activePillClass = "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#956f2c] px-3 py-2 text-xs font-bold text-white shadow sm:gap-2 sm:px-4 sm:text-sm";
const idlePillClass = "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#172033] px-3 py-2 text-xs font-bold text-white shadow transition hover:bg-black/85 sm:gap-2 sm:bg-black/70 sm:px-4 sm:text-sm";

function mediaCategoryLabel(category: string | null) {
  if (category?.startsWith("thermal_")) return category === "thermal_reference" ? "Фото к термо" : "Термо";
  const labels: Record<string, string> = {
    outside: "Кузов",
    outer: "Кузов",
    thumbnail: "Кузов",
    exterior: "Кузов",
    inside: "Салон",
    inner: "Салон",
    option: "Оснащение",
    scratch: "Повреждение",
    outside_image: "Кузов",
    inside_image: "Салон",
    photo: "Фото",
    condition: "Состояние",
    inspection_record: "Диагностика",
    underbody: "Днище",
    thermal: "Термо",
    exterior_360_thumbnail: "360 кузов",
  };
  return labels[category ?? ""] ?? "Фото";
}

type GalleryAlbum = "all" | "exterior" | "interior" | "damage" | "other";

const galleryAlbums: Array<{ key: GalleryAlbum; label: string }> = [
  { key: "all", label: "Все фото" },
  { key: "exterior", label: "Кузов" },
  { key: "interior", label: "Салон" },
  { key: "damage", label: "Состояние" },
  { key: "other", label: "Другие фото" },
];

function mediaAlbum(category: string | null): Exclude<GalleryAlbum, "all"> {
  if (category === "inside" || category === "inside_image" || category === "inner") return "interior";
  if (category === "scratch" || category === "condition") return "damage";
  if (category === "outside" || category === "outside_image" || category === "exterior" || category === "outer" || category === "thumbnail") return "exterior";
  return "other";
}
