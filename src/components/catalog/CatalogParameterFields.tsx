"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { bodyTypeFilterValue } from "@/lib/catalog-filter-values";
import { CATALOG_COLORS, CATALOG_OPTIONS } from "@/lib/catalog-appearance-filters";
import { translateFuel, translateTransmission } from "@/server/normalization/display";

export function CatalogParameterFields({ values, onChange, bodies, transmissions, fuels = ["gasoline", "diesel", "hybrid", "electric", "lpg"] }: {
  values: Record<string, string>;
  onChange?: (name: string, value: string) => void;
  bodies: string[];
  transmissions: string[];
  fuels?: string[];
}) {
  const [showAllColors, setShowAllColors] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [localSelections, setLocalSelections] = useState({ colors: values.colors ?? "", options: values.options ?? "" });
  const selection = (name: "colors" | "options") => onChange ? values[name] ?? "" : localSelections[name];
  const updateSelection = (name: "colors" | "options", value: string, event: React.SyntheticEvent<HTMLElement>) => {
    if (onChange) return onChange(name, value);
    const form = event.currentTarget.closest("form");
    setLocalSelections(previous => ({ ...previous, [name]: value }));
    if (form) window.setTimeout(() => form.dispatchEvent(new Event("change", { bubbles: true })), 0);
  };
  useEffect(() => {
    if (!onChange) setLocalSelections({ colors: values.colors ?? "", options: values.options ?? "" });
  }, [onChange, values.colors, values.options]);
  const inputClass = "h-12 w-full min-w-0 rounded-xl border border-[#d7dee8] bg-white px-3 text-base text-[#273246] outline-none focus:border-[#647084]";
  const selectedColors = new Set(selection("colors").split(",").filter(Boolean));
  const selectedOptions = new Set(selection("options").split(",").filter(Boolean));
  const appearanceFilters = <>
    <fieldset className="min-w-0 sm:col-span-2 lg:col-span-3">
      <legend className="mb-2 text-sm text-[#647084]">Цвет кузова</legend>
      <div className="flex flex-wrap gap-2">
        {(showAllColors ? CATALOG_COLORS : CATALOG_COLORS.slice(0, 8)).map(color => {
          const active = selectedColors.has(color.id);
          return <button aria-pressed={active} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm transition ${active ? "border-[#273246] bg-[#f1f3f6] text-[#182133]" : "border-[#e1e5eb] bg-white text-[#273246] hover:bg-[#f7f8fa]"}`} key={color.id} onClick={event => updateSelection("colors", toggleValue(selection("colors"), color.id), event)} type="button"><span aria-hidden="true" className="size-4 rounded-full border border-black/10" style={{ backgroundColor: color.swatch }} />{color.label}</button>;
        })}
        <button aria-expanded={showAllColors} className="min-h-10 px-2 text-sm font-medium text-[#526078] underline underline-offset-4" onClick={() => setShowAllColors(value => !value)} type="button">{showAllColors ? "Скрыть" : "Другие цвета"}</button>
      </div>
      <input name="colors" type="hidden" value={selection("colors")} />
    </fieldset>
    <fieldset className="min-w-0 sm:col-span-2 lg:col-span-3">
      <legend className="mb-2 text-sm text-[#647084]">Опции</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOG_OPTIONS.slice(0, 8).map(option => <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${selectedOptions.has(option.id) ? "border-[#9aa5b5] bg-[#f4f6f9] text-[#182133]" : "border-[#e1e5eb] bg-white text-[#273246]"}`} key={option.id}><input checked={selectedOptions.has(option.id)} className="size-4 accent-[#273246]" onChange={event => updateSelection("options", toggleValue(selection("options"), option.id), event)} type="checkbox" /><span>{option.label}</span></label>)}
      </div>
      <button aria-expanded={showAllOptions} className="mt-2 min-h-9 text-sm font-medium text-[#526078] underline underline-offset-4" onClick={() => setShowAllOptions(value => !value)} type="button">{showAllOptions ? "Скрыть дополнительные опции" : `Все опции${selectedOptions.size ? ` · выбрано ${selectedOptions.size}` : ""}`}</button>
      {showAllOptions ? <div className="mt-2 grid gap-2">{[...new Set(CATALOG_OPTIONS.map(option => option.group))].map(group => {
        const groupedOptions = CATALOG_OPTIONS.filter(option => option.group === group && !CATALOG_OPTIONS.slice(0, 8).some(primary => primary.id === option.id));
        if (!groupedOptions.length) return null;
        return <details className="group/option rounded-xl border border-[#e1e5eb] bg-white" key={group}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium text-[#273246] [&::-webkit-details-marker]:hidden">{group}<ChevronDown className="transition group-open/option:rotate-180" size={16} /></summary><div className="grid gap-1 border-t border-[#edf0f4] p-2 sm:grid-cols-2">{groupedOptions.map(option => <label className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm ${selectedOptions.has(option.id) ? "bg-[#f4f6f9] text-[#182133]" : "text-[#273246]"}`} key={option.id}><input checked={selectedOptions.has(option.id)} className="size-4 accent-[#273246]" onChange={event => updateSelection("options", toggleValue(selection("options"), option.id), event)} type="checkbox" /><span>{option.label}</span></label>)}</div></details>;
      })}</div> : null}
      <input name="options" type="hidden" value={selection("options")} />
      <p className="mt-1 text-xs text-[#7a8798]">Если выбрано несколько опций, автомобиль должен иметь каждую из них.</p>
    </fieldset>
  </>;
  const range = (label: string, prefix: string) => <fieldset className="min-w-0" key={prefix}>
    <legend className="mb-2 text-sm text-[#647084]">{label}</legend>
    <div className="grid grid-cols-2 gap-2">{["Min", "Max"].map((side) => {
      const name = `${prefix}${side}`;
      if (prefix !== "price") {
        const options = prefix === "year"
          ? Array.from({ length: new Date().getFullYear() - 1979 }, (_, index) => String(new Date().getFullYear() - index))
          : Array.from({ length: prefix === "mileage" ? 1001 : prefix === "power" ? 201 : 100 }, (_, index) => String(prefix === "mileage" ? index * 1000 : prefix === "power" ? index * 10 : (index + 1) * 100));
        const current = values[name] ?? "";
        if (current && !options.includes(current)) options.push(current);
        return <select aria-label={`${label}: ${side === "Min" ? "от" : "до"}`} className={inputClass} key={name} name={name} {...(onChange ? { value: current, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(name, event.target.value) } : { defaultValue: current })}><option value="">{side === "Min" ? "От" : "До"}</option>{options.map(value => <option key={value} value={value}>{prefix === "engine" ? (Number(value) / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 3 }) : Number(value).toLocaleString("ru-RU", { useGrouping: prefix !== "year" })}</option>)}</select>;
      }
      return <input aria-label={`${label}: ${side === "Min" ? "от" : "до"}`} className={inputClass} inputMode="numeric" key={name} name={name} placeholder={side === "Min" ? "От" : "До"} {...(onChange ? { value: values[name] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.target.value) } : { defaultValue: values[name] ?? "" })} />;
    })}</div>
  </fieldset>;
  const select = (label: string, name: string, options: string[], translate = (value: string) => value) => <label className="grid min-w-0 gap-2 text-sm text-[#647084]" key={name}>{label}<select className={inputClass} name={name} {...(onChange ? { value: values[name] ?? "", onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(name, event.target.value) } : { defaultValue: values[name] ?? "" })}><option value="">Любой</option>{options.map(value => <option key={value} value={value}>{translate(value)}</option>)}</select></label>;
  return <div className="grid gap-4">
    <section className="rounded-2xl border border-[#e0e5ec] bg-white p-4 sm:p-5">
      <h3 className="mb-4 text-lg font-semibold text-[#101827]">Основные параметры</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {range("Цена, ₽", "price")}{range("Пробег, км", "mileage")}{range("Год выпуска", "year")}
        {select("Кузов", "body", [...new Set(bodies.map(value => bodyTypeFilterValue(value) ?? value))])}{select("Коробка", "transmission", transmissions, translateTransmission)}{select("Топливо", "fuel", fuels, translateFuel)}
      </div>
    </section>
    <details className="group/parameters rounded-2xl border border-[#e0e5ec] bg-white" open>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-lg font-semibold text-[#101827] sm:px-5 [&::-webkit-details-marker]:hidden">Дополнительные параметры<ChevronDown className="shrink-0 transition group-open/parameters:rotate-180" size={20} /></summary>
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 sm:px-5 sm:pb-5 lg:grid-cols-3">
        {range("Объём двигателя, л", "engine")}{select("Привод", "drive", ["FWD", "RWD", "2WD", "4WD"], value => ({ FWD: "Передний", RWD: "Задний" })[value] ?? value)}{range("Мощность, л.с.", "power")}
        {appearanceFilters}
      </div>
    </details>
    <section className="rounded-2xl border border-[#e0e5ec] bg-white p-4 sm:p-5"><h3 className="mb-3 text-lg font-semibold text-[#101827]">Популярные настройки</h3><div className="flex flex-wrap gap-2">{[["under160", "До 160 л.с."], ["crossovers4wd", "Кроссоверы 4WD"], ["electricOnly", "Электромобили"], ["lpgOnly", "Авто на газу"], ["clean", "Без ДТП"], ["noInsurance", "Без страховых"]].map(([name, label]) => <label key={name} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 py-2 text-sm font-medium transition ${values[name] === "1" ? "bg-[#101827] text-white" : "bg-[#f1f3f6] text-[#273246] hover:bg-[#e7e9ed]"}`}><input aria-label={label} className="sr-only" name={name} type="checkbox" value="1" {...(onChange ? { checked: values[name] === "1", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.target.checked ? "1" : "") } : { defaultChecked: values[name] === "1" })} />{label}</label>)}</div></section>
  </div>;
}

function toggleValue(value: string | undefined, id: string) {
  const selected = new Set((value ?? "").split(",").filter(Boolean));
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  return [...selected].join(",");
}
