"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function StoryCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const remaining = track.scrollWidth - track.clientWidth - track.scrollLeft;
    setEdges({ atStart: track.scrollLeft <= 1, atEnd: remaining <= 1 });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(track);
    track.addEventListener("scroll", updateEdges, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", updateEdges);
    };
  }, [updateEdges]);

  function move(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.78), behavior: "smooth" });
  }

  return (
    <div className="group/stories relative">
      <div
        ref={trackRef}
        aria-label="Актуальные предложения"
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 pr-12 sm:mx-0 sm:px-0 sm:pr-14"
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
      <button
        aria-label="Предыдущие баннеры"
        className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#d8dde6] bg-white/95 text-[#101827] shadow-md transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
        disabled={edges.atStart}
        onClick={() => move(-1)}
        type="button"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        aria-label="Следующие баннеры"
        className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#d8dde6] bg-white/95 text-[#101827] shadow-md transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
        disabled={edges.atEnd}
        onClick={() => move(1)}
        type="button"
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
