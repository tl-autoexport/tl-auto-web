"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type BrandModelFieldsProps = {
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  initialBrand: string;
  initialModel: string;
};

export function BrandModelFields({
  brands,
  initialBrand,
  initialModel,
  modelsByBrand,
}: BrandModelFieldsProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [model, setModel] = useState(initialModel);
  const allModels = useMemo(
    () => Array.from(new Set(Object.values(modelsByBrand).flat())).sort(),
    [modelsByBrand],
  );
  const models = brand ? modelsByBrand[brand] ?? [] : allModels;

  return (
    <>
      <SelectField
        label="Марка"
        name="brand"
        options={brands}
        placeholder="Все марки"
        value={brand}
        onChange={(nextBrand) => {
          setBrand(nextBrand);
          setModel("");
        }}
      />
      <SelectField
        label="Модель"
        name="model"
        options={models}
        placeholder={brand ? "Все модели марки" : "Все модели"}
        value={model}
        onChange={setModel}
      />
    </>
  );
}

function SelectField({
  label,
  name,
  onChange,
  options,
  placeholder,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  value: string;
}) {
  const active = Boolean(value);
  return (
    <label className="grid gap-1.5 text-sm text-[#647084]">
      <span>{label}</span>
      <span className="relative">
        <select
          className={`h-11 w-full appearance-none rounded-md border px-3 pr-9 text-sm font-medium outline-none transition ${active ? "border-[#c7a55a] bg-[#fbf7ed] text-[#7b5a22]" : "border-[#d7dee8] bg-white text-[#273246]"} focus:border-[#101827]`}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {active ? (
          <Check className="pointer-events-none absolute right-8 top-3 text-[#c7a55a]" size={17} />
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-3 top-3 text-[#647084]" size={17} />
      </span>
    </label>
  );
}
