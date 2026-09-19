"use client";

import { Info, X } from "lucide-react";
import { useId, useState } from "react";

export function InfoHint({ text, label = "Подробнее" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex align-middle">
      <button aria-controls={id} aria-expanded={open} aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-[#647084] transition hover:bg-[#eef1f6] hover:text-[#956f2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#956f2c]" onClick={() => setOpen((value) => !value)} type="button">
        <Info size={14} strokeWidth={2} />
      </button>
      {open ? <span className="fixed inset-x-3 bottom-24 z-50 max-h-[40vh] w-auto overflow-y-auto rounded-xl bg-[#101827] p-4 text-left text-sm font-normal leading-5 text-white shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-2 sm:max-h-none sm:w-72 sm:overflow-visible sm:rounded-lg sm:p-3 sm:text-xs" id={id} role="status"><span className="flex items-start gap-3"><span className="flex-1">{text}</span><button aria-label="Закрыть подсказку" className="shrink-0 text-white/60 hover:text-white" onClick={() => setOpen(false)} type="button"><X size={16} /></button></span></span> : null}
    </span>
  );
}
