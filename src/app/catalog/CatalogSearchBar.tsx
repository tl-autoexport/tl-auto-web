"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function CatalogSearchBar({ brands, models, initialValue }: { brands: string[]; models: Array<{ brand: string; model: string }>; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const normalized = normalize(value);
  const suggestions = useMemo(() => {
    if (normalized.length < 2) return [];
    return [...brands.map((brand) => ({ label: brand, query: brand, kind: "Марка" })), ...models.map(({ brand, model }) => ({ label: `${brand} ${model}`, query: `${brand} ${model}`, kind: "Модель" }))]
      .filter((item, index, items) => items.findIndex((candidate) => normalize(candidate.label) === normalize(item.label)) === index)
      .filter((item) => normalize(item.label).includes(normalized)).slice(0, 8);
  }, [brands, models, normalized]);

  const submit = (query = value) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    if (query.trim()) params.set("search", query.trim()); else params.delete("search");
    window.location.assign(`/catalog${params.toString() ? `?${params.toString()}` : ""}#catalog-results`);
  };

  return <div className="border-b border-[#dce2eb] bg-white"><div className="mx-auto max-w-7xl px-3 py-3 sm:px-5 md:py-4"><form className="relative" onSubmit={(event) => { event.preventDefault(); submit(); }}><Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#69768a]" size={19} /><input aria-label="Поиск по марке или модели" autoComplete="off" className="h-12 w-full rounded-xl border border-[#d7dee8] bg-white py-2 pl-11 pr-11 text-base text-[#101827] outline-none transition placeholder:text-[#7a8798] focus:border-[#956f2c] focus:ring-2 focus:ring-[#c7a55a]/20" enterKeyHint="search" inputMode="search" onChange={(event) => setValue(event.target.value)} placeholder="Поиск по марке или модели" value={value} />{value ? <button aria-label="Очистить поиск" className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-[#69768a] hover:bg-[#f0f3f7]" onClick={() => { setValue(""); submit(""); }} type="button"><X size={17} /></button> : null}</form>{suggestions.length ? <div className="relative z-10"><div className="absolute inset-x-0 top-2 overflow-hidden rounded-xl border border-[#dce2eb] bg-white shadow-[0_12px_30px_rgba(16,24,39,0.14)]">{suggestions.map((item) => <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-[#f7f8fa]" key={`${item.kind}-${item.query}`} onClick={() => { setValue(item.query); submit(item.query); }} type="button"><span className="font-medium text-[#101827]">{item.label}</span><span className="text-xs text-[#7a8798]">{item.kind}</span></button>)}</div></div> : null}</div></div>;
}
