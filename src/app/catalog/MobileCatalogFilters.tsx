"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ChevronDown, Filter, RotateCcw, X } from "lucide-react";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

type SortOption = {
  label: string;
  value: string;
};

export function MobileCatalogFilters({
  activeCount,
  children,
  currentQuery,
  sort,
  sortOptions,
  totalCars,
}: {
  activeCount: number;
  children: ReactNode;
  currentQuery: string;
  sort: string;
  sortOptions: SortOption[];
  totalCars: number;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeRef,
    onClose: () => setOpen(false),
    open,
  });

  function changeSort(value: string) {
    const params = new URLSearchParams(currentQuery);
    params.set("sort", value);
    params.delete("page");
    window.location.assign(`/catalog?${params.toString()}#catalog-results`);
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_minmax(150px,1fr)] gap-2">
        <button
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold ${
            activeCount
              ? "border-[#ed1c2b] bg-[#fff1f2] text-[#d71927]"
              : "border-[#d7dee8] bg-white text-[#273246]"
          }`}
          onClick={() => setOpen(true)}
          type="button"
        >
          <Filter size={17} />
          Фильтры
          {activeCount ? (
            <span className="grid size-5 place-items-center rounded-full bg-[#ed1c2b] text-[11px] text-white">
              {activeCount}
            </span>
          ) : null}
        </button>

        <label className="relative">
          <span className="sr-only">Сортировка</span>
          <select
            aria-label="Сортировка"
            className="h-11 w-full appearance-none rounded-md border border-[#d7dee8] bg-white px-3 pr-8 text-[12px] font-semibold text-[#273246]"
            onChange={(event) => changeSort(event.target.value)}
            value={sort}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-3 text-[#647084]"
            size={17}
          />
        </label>
      </div>

      {open ? (
        <div
          ref={dialogRef}
          aria-label="Фильтры каталога"
          aria-modal="true"
          className="fixed inset-0 z-[90] grid grid-rows-[auto_minmax(0,1fr)] bg-[#f4f6f9]"
          role="dialog"
        >
          <header className="flex min-h-16 items-center justify-between border-b border-[#dce2eb] bg-white px-4 pt-[env(safe-area-inset-top)]">
            <div>
              <h2 className="text-lg font-semibold text-[#101827]">Фильтры</h2>
              <p className="text-xs text-[#647084]">{totalCars} автомобилей найдено</p>
            </div>
            <div className="flex items-center gap-1">
              {activeCount ? (
                <a
                  className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs font-semibold text-[#647084]"
                  href="/catalog"
                >
                  <RotateCcw size={15} />
                  Сбросить
                </a>
              ) : null}
              <button
                ref={closeRef}
                aria-label="Закрыть фильтры"
                className="grid size-11 place-items-center rounded-full text-[#101827]"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={24} />
              </button>
            </div>
          </header>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      ) : null}
    </>
  );
}
