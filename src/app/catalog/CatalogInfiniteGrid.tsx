"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PrototypeVehicleCard } from "@/components/home/PrototypeVehicleCard";
import type { CatalogCardSummary } from "@/server/cars/repository";

type FeedResponse = {
  cars: CatalogCardSummary[];
  nextCursor: string | null;
};

type Props = {
  initialCars: CatalogCardSummary[];
  initialCursor: string | null;
  query: string;
};

export function CatalogInfiniteGrid({ initialCars, initialCursor, query }: Props) {
  const [cars, setCars] = useState(initialCars);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const stateKey = useMemo(() => `tl-auto:catalog:v1:${query}`, [query]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading || requestRef.current) return;
    requestRef.current = new AbortController();
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", cursor);
      params.set("limit", "24");
      const response = await fetch(`/api/catalog/feed?${params.toString()}`, {
        signal: requestRef.current.signal,
      });
      if (!response.ok) throw new Error(`Catalogue feed returned ${response.status}`);
      const next = await response.json() as FeedResponse;
      setCars((current) => {
        const merged = [...current, ...next.cars];
        const unique = Array.from(new Map(merged.map((car) => [car.id, car])).values());
        return unique;
      });
      setCursor(next.nextCursor);
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(true);
    } finally {
      requestRef.current = null;
      setLoading(false);
    }
  }, [cursor, loading, query]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(stateKey) ?? "null") as {
        cars?: CatalogCardSummary[];
        cursor?: string | null;
        scrollY?: number;
        savedAt?: number;
      } | null;
      if (!saved || !Array.isArray(saved.cars) || saved.cars.length <= initialCars.length || !saved.savedAt || Date.now() - saved.savedAt > 15 * 60_000) return;
      window.requestAnimationFrame(() => {
        setCars(saved.cars!);
        setCursor(saved.cursor ?? null);
        window.scrollTo({ top: saved.scrollY ?? 0, behavior: "instant" });
      });
    } catch {
      // A missing or malformed cache must never affect catalogue browsing.
    }
  }, [initialCars.length, stateKey]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  useEffect(() => {
    const persist = () => {
      try {
        sessionStorage.setItem(stateKey, JSON.stringify({ cars, cursor, scrollY: window.scrollY, savedAt: Date.now() }));
      } catch {
        // Storage is an optional back-navigation optimisation.
      }
    };
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [cars, cursor, stateKey]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cars.map((car, index) => (
          <div className="[content-visibility:auto] [contain-intrinsic-size:auto_430px]" key={car.id}>
            <PrototypeVehicleCard car={car} priorityImage={index < 3} />
          </div>
        ))}
      </div>
      <div className="mt-7 flex min-h-12 items-center justify-center" ref={sentinelRef}>
        {loading ? <span className="inline-flex items-center gap-2 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={18} /> Загружаем ещё автомобили</span> : null}
        {error ? <button className="rounded-md border border-[#c7a55a] bg-white px-4 py-2 text-sm font-semibold text-[#7b5a22]" onClick={() => void loadMore()} type="button">Повторить загрузку</button> : null}
        {!cursor && cars.length > 0 ? <span className="text-sm text-[#647084]">Все подходящие автомобили показаны</span> : null}
      </div>
    </>
  );
}
