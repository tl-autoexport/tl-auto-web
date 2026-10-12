import { BrandLogo } from "./BrandLogo";
import { splitGenerationLabel } from "@/lib/catalog-cascade";

export function CascadeOption({ label, brand, generation, selected, cars, onClick }: {
  label: string; brand?: string; generation?: boolean; selected: boolean; cars?: number; onClick: () => void;
}) {
  const { name, period } = generation ? splitGenerationLabel(label) : { name: label, period: null };
  return <button aria-pressed={selected} className={`flex min-h-14 w-full items-center gap-3 border-b border-[#edf0f4] px-4 py-3 text-left text-sm transition ${selected ? "bg-[#fbf7ed]" : "hover:bg-[#f7f9fc]"}`} onClick={onClick} type="button">
    {brand ? <BrandLogo brand={brand} size={28} /> : null}
    <span className="min-w-0 flex-1 break-words font-medium leading-5 text-[#273246]">{name}{period ? <span className="mt-1 block text-xs font-normal text-[#647084]">{period}</span> : null}</span>
    {cars !== undefined ? <span className="shrink-0 text-xs tabular-nums text-[#7a8798]">{cars}</span> : null}
    <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded border text-xs ${selected ? "border-[#647084] bg-[#a98239] text-white" : "border-[#b9c1cb] text-transparent"}`}>✓</span>
  </button>;
}
