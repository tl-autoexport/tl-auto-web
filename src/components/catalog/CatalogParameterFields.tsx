"use client";

import { ChevronDown } from "lucide-react";
import { translateFuel, translateTransmission } from "@/server/normalization/display";

export function CatalogParameterFields({ values, onChange, bodies, transmissions, fuels = ["gasoline", "diesel", "hybrid", "electric", "lpg"] }: {
  values: Record<string, string>;
  onChange?: (name: string, value: string) => void;
  bodies: string[];
  transmissions: string[];
  fuels?: string[];
}) {
  const inputClass = "h-12 w-full min-w-0 rounded-xl border border-[#d7dee8] bg-white px-3 text-base text-[#273246] outline-none focus:border-[#a98239] focus:ring-2 focus:ring-[#c7a55a]/20";
  const range = (label: string, prefix: string) => <fieldset className="min-w-0" key={prefix}>
    <legend className="mb-2 text-sm text-[#647084]">{label}</legend>
    <div className="grid grid-cols-2 gap-2">{["Min", "Max"].map((side) => {
      const name = `${prefix}${side}`;
      return <input aria-label={`${label}: ${side === "Min" ? "от" : "до"}`} className={inputClass} inputMode="numeric" key={name} name={name} placeholder={side === "Min" ? "От" : "До"} {...(onChange ? { value: values[name] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.target.value) } : { defaultValue: values[name] ?? "" })} />;
    })}</div>
  </fieldset>;
  const select = (label: string, name: string, options: string[], translate = (value: string) => value) => <label className="grid min-w-0 gap-2 text-sm text-[#647084]" key={name}>{label}<select className={inputClass} name={name} {...(onChange ? { value: values[name] ?? "", onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(name, event.target.value) } : { defaultValue: values[name] ?? "" })}><option value="">Любой</option>{options.map(value => <option key={value} value={value}>{translate(value)}</option>)}</select></label>;
  return <div className="grid gap-4">
    <section className="rounded-2xl border border-[#e0e5ec] bg-white p-4 sm:p-5">
      <h3 className="mb-4 text-lg font-semibold text-[#101827]">Основные параметры</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {range("Цена, ₽", "price")}{range("Пробег, км", "mileage")}{range("Год выпуска", "year")}
        {select("Кузов", "body", bodies)}{select("Коробка", "transmission", transmissions, translateTransmission)}
      </div>
    </section>
    <details className="group rounded-2xl border border-[#e0e5ec] bg-white" open>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-lg font-semibold text-[#101827] sm:px-5 [&::-webkit-details-marker]:hidden">Дополнительные параметры<ChevronDown className="shrink-0 transition group-open:rotate-180" size={20} /></summary>
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 sm:px-5 sm:pb-5 lg:grid-cols-3">
        {range("Объём двигателя, см³", "engine")}{range("Мощность, л.с.", "power")}
        {["Цвет", "Опции"].map(label => <div key={label} className="grid gap-2 text-sm text-[#647084]">{label}<div aria-disabled="true" className="flex h-12 items-center rounded-xl border border-[#e1e5eb] bg-[#f7f8fa] px-3 text-sm text-[#8a94a4]">Скоро</div></div>)}
        {select("Топливо", "fuel", fuels, translateFuel)}{select("Привод", "drive", ["FWD", "RWD", "2WD", "4WD"], value => ({ FWD: "Передний", RWD: "Задний" })[value] ?? value)}
      </div>
    </details>
    <section className="rounded-2xl border border-[#e0e5ec] bg-white p-4 sm:p-5"><h3 className="mb-3 text-base font-semibold">Популярные настройки</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["under160", "До 160 л.с."], ["passable", "Проходные 3–5 лет"], ["clean", "Без ДТП"], ["noInsurance", "Без страховых выплат"]].map(([name, label]) => <label key={name} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#f1f3f6] px-3 py-2 text-sm text-[#273246]"><input name={name} type="checkbox" value="1" {...(onChange ? { checked: values[name] === "1", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.target.checked ? "1" : "") } : { defaultChecked: values[name] === "1" })} />{label}</label>)}</div></section>
  </div>;
}
