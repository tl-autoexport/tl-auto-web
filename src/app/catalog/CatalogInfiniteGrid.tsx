"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PrototypeVehicleCard } from "@/components/home/PrototypeVehicleCard";
import { writeSavedCatalogUrl } from "@/lib/catalog-state";
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

type SavedState = {
  cars?: CatalogCardSummary[];
  cursor?: string | null;
  scrollY?: number;
  savedAt?: number;
};

/** Browsing state of one filtered listing, kept for return navigations. */
const STATE_PREFIX = "tl-auto:catalog:v1:";

// Restore on the client before the browser paints, so the document already has
// the restored height and a deep scroll position is never clamped onto a short
// page (which used to flash the footer).
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function CatalogInfiniteGrid({ initialCars, initialCursor, query }: Props) {
  const [cars, setCars] = useState(initialCars);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const pendingScrollRef = useRef<{ scrollY: number; cars: number } | null>(null);
  const stateKey = useMemo(() => `${STATE_PREFIX}${query}`, [query]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", cursor);
      params.set("limit", "24");
      const response = await fetch(`/api/catalog/feed?${params.toString()}`, {
        signal: controller.signal,
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
      window.clearTimeout(timeout);
      requestRef.current = null;
      setLoading(false);
    }
  }, [cursor, loading, query]);

  useIsomorphicLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(stateKey) ?? "null") as SavedState | null;
      if (!saved?.savedAt || Date.now() - saved.savedAt > 15 * 60_000) return;
      const restoredCars = Array.isArray(saved.cars) && saved.cars.length > initialCars.length
        ? saved.cars
        : null;
      if (restoredCars) {
        setCars(restoredCars);
        setCursor(saved.cursor ?? null);
      }
      if (typeof saved.scrollY === "number") {
        pendingScrollRef.current = {
          scrollY: saved.scrollY,
          cars: restoredCars ? restoredCars.length : cars.length,
        };
      }
    } catch {
      // A missing or malformed cache must never affect catalogue browsing.
    }
  }, [cars.length, initialCars.length, stateKey]);

  // Runs after the restored list has been committed and before paint, so the
  // position is applied once the page is tall enough for it.
  useIsomorphicLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending || cars.length < pending.cars) return;
    pendingScrollRef.current = null;
    window.scrollTo({ top: pending.scrollY, behavior: "instant" as ScrollBehavior });
  }, [cars.length]);

  // The browser would otherwise restore the deep offset itself, onto whatever
  // height the page happens to have at that moment.
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

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
      writeSavedCatalogUrl(`${window.location.pathname}${window.location.search}`);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    // A client-side navigation never unloads the document, so `pagehide` alone
    // never fires between catalogue pages: capture link clicks as well.
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("a[href]")) persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [cars, cursor, stateKey]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cars.map((car, index) => (
          <div className="lg:[content-visibility:auto] lg:[contain-intrinsic-size:auto_430px]" key={car.id}>
            <PrototypeVehicleCard car={car} priorityImage={index < 4} />
          </div>
        ))}
      </div>
      <div className={`mt-7 flex items-center justify-center ${loading ? "min-h-16" : "min-h-12"}`} ref={sentinelRef}>
        {loading ? <span className="inline-flex items-center gap-2 text-sm text-[#647084]"><LoaderCircle className="animate-spin" size={18} /> Загружаем ещё автомобили</span> : null}
        {error ? <button className="rounded-md border border-[#c7a55a] bg-white px-4 py-2 text-sm font-semibold text-[#7b5a22]" onClick={() => void loadMore()} type="button">Повторить загрузку</button> : null}
        {!cursor && cars.length > 0 ? <span className="text-sm text-[#647084]">Все подходящие автомобили показаны</span> : null}
      </div>
    </>
  );
}
