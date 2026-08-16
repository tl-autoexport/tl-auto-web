"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

export function LiveCatalogCount({ initialCount, mobile = false }: { initialCount: number; mobile?: boolean }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const updateCount = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        controller?.abort();
        controller = new AbortController();
        const query = new URLSearchParams(new FormData(form) as never);
        query.delete("sort");
        try {
          const response = await fetch(`/api/catalog/count?${query.toString()}`, { signal: controller.signal });
          if (!response.ok) return;
          const payload = await response.json() as { count?: number };
          if (typeof payload.count === "number") setCount(payload.count);
        } catch (error) {
          if ((error as { name?: string }).name !== "AbortError") return;
        }
      }, 250);
    };

    form.addEventListener("input", updateCount);
    form.addEventListener("change", updateCount);
    return () => {
      form.removeEventListener("input", updateCount);
      form.removeEventListener("change", updateCount);
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      className={mobile
        ? "flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7a55a] text-sm font-semibold text-[#15130f]"
        : "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#c7a55a] px-6 text-sm font-semibold text-[#15130f]"}
      type="submit"
    >
      <Search size={17} /> {mobile ? `Показать ${count} автомобилей` : `Показать ${count}`}
    </button>
  );
}
