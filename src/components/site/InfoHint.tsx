"use client";

import { Info, X } from "lucide-react";
import { useId, useState } from "react";

export function InfoHint({ text, label = "Подробнее" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="contents">
      <button aria-controls={id} aria-expanded={open} aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-[#647084] transition hover:bg-[#eef1f6] hover:text-[#956f2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#956f2c]" onClick={() => setOpen((value) => !value)} type="button">
        <Info size={14} strokeWidth={2} />
      </button>
      {open ? (
        <span
          className="mt-2 flex w-full basis-full items-start gap-2.5 rounded-xl border border-[#dfc98e] border-l-[3px] bg-[#fbf7ed] px-3.5 py-3 text-left text-xs font-normal leading-5 text-[#3d4655] shadow-[0_8px_24px_rgba(32,39,51,0.08)] sm:px-4 sm:text-[13px]"
          id={id}
          role="status"
        >
          <Info className="mt-0.5 shrink-0 text-[#a67c2d]" size={16} strokeWidth={1.8} />
          <span className="min-w-0 flex-1">{text}</span>
          <button
            aria-label="Закрыть подсказку"
            className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[#7b8493] transition hover:bg-white hover:text-[#273246]"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X size={15} />
          </button>
        </span>
      ) : null}
    </span>
  );
}
