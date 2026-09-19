"use client";

import { Info, X } from "lucide-react";
import { useId, useState } from "react";

const POWER_NOTE = "Мощность указана по открытым источникам и может отличаться от фактических данных автомобиля.";

export function PowerKeyFact({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <div className="min-w-0 rounded bg-[#f7f9fb] px-3 py-2.5 ring-1 ring-[#e8ecf2]">
        <button
          aria-controls={id}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-[11px] text-[#647084] transition hover:text-[#956f2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#956f2c] sm:text-xs"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          Мощность
          <Info size={14} strokeWidth={2} />
        </button>
        <strong className="mt-1 block truncate text-sm font-semibold tabular-nums sm:text-base">{value}</strong>
      </div>

      {open ? (
        <div
          className="col-span-2 flex items-start gap-2.5 rounded-xl border border-[#dfc98e] border-l-[3px] bg-[#fbf7ed] px-3.5 py-3 text-xs font-normal leading-5 text-[#3d4655] shadow-[0_8px_24px_rgba(32,39,51,0.08)] sm:px-4 sm:text-[13px]"
          id={id}
          role="status"
        >
          <Info className="mt-0.5 shrink-0 text-[#a67c2d]" size={16} strokeWidth={1.8} />
          <span className="min-w-0 flex-1">{POWER_NOTE}</span>
          <button
            aria-label="Закрыть пояснение"
            className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[#7b8493] transition hover:bg-white hover:text-[#273246]"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}
