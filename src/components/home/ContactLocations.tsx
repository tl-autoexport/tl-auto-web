"use client";

import { ArrowRight, MapPin, Phone } from "lucide-react";
import { useMemo, useState } from "react";
import { CLIENT_CONTACT } from "@/lib/contact";

type Country = "ru" | "kr";

const locations = [
  {
    id: "volzhsky",
    country: "ru" as const,
    countryLabel: "Россия",
    city: "Волжский",
    address: "г. Волжский, ул. Мира, 75",
    phone: CLIENT_CONTACT.russiaPhoneLabel,
    phoneHref: `tel:${CLIENT_CONTACT.russiaPhone}`,
    mapEmbed: "https://yandex.ru/map-widget/v1/?ll=44.807133%2C48.769444&z=16&pt=44.807133%2C48.769444%2Cpm2rdm",
    mapLink: "https://yandex.ru/maps/?text=Волжский%2C%20улица%20Мира%2C%2075",
    mapLabel: "Яндекс Карты",
  },
  {
    id: "volgograd",
    country: "ru" as const,
    countryLabel: "Россия",
    city: "Волгоград",
    address: "г. Волгоград, ул. Землячки, 27А",
    phone: CLIENT_CONTACT.russiaPhoneLabel,
    phoneHref: `tel:${CLIENT_CONTACT.russiaPhone}`,
    mapEmbed: "https://yandex.ru/map-widget/v1/?ll=44.497589%2C48.759763&z=16&pt=44.497589%2C48.759763%2Cpm2rdm",
    mapLink: "https://yandex.ru/maps/?text=Волгоград%2C%20улица%20Землячки%2C%2027А",
    mapLabel: "Яндекс Карты",
  },
  {
    id: "incheon",
    country: "kr" as const,
    countryLabel: "Южная Корея",
    city: "Incheon",
    address: "A-2201, Songdo Centum Hive, 301 Incheon Tower-daero, Yeonsu-gu, Incheon 22007",
    phone: "+82 10-7626-0741",
    phoneHref: "tel:+821076260741",
    mapEmbed: "https://maps.google.com/maps?q=Songdo%20Centum%20Hive%20301%20Incheon%20Tower-daero&t=&z=15&ie=UTF8&iwloc=&output=embed",
    mapLink: "https://www.google.com/maps/search/?api=1&query=Songdo%20Centum%20Hive%20301%20Incheon%20Tower-daero",
    mapLabel: "Google Maps",
  },
] as const;

export function ContactLocations() {
  const [country, setCountry] = useState<Country>("ru");
  const [locationId, setLocationId] = useState("volzhsky");
  const countryLocations = useMemo(() => locations.filter((item) => item.country === country), [country]);
  const active = locations.find((item) => item.id === locationId && item.country === country) ?? countryLocations[0];

  function selectCountry(next: Country) {
    setCountry(next);
    setLocationId(locations.find((item) => item.country === next)!.id);
  }

  return (
    <section id="contacts" className="scroll-mt-28 border-y border-[#dce2eb] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-5 sm:py-14">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#956f2c]">Контакты и адреса</p>
            <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">Мы на связи в России и Корее</h2>
          </div>
          <div
            className="inline-flex self-start rounded-2xl border border-[#dfe4eb] bg-[#f3f5f8] p-1 shadow-[0_6px_18px_rgba(16,24,39,0.06)]"
            aria-label="Выберите страну"
          >
            {(["ru", "kr"] as const).map((code) => (
              <button
                className={`min-h-10 rounded-xl px-4 text-sm font-semibold transition duration-200 ${country === code ? "bg-white text-[#8b682b] shadow-[0_2px_8px_rgba(16,24,39,0.12)] ring-1 ring-[#eadab5]" : "text-[#667389] hover:bg-white/70 hover:text-[#101827]"}`}
                key={code}
                onClick={() => selectCountry(code)}
                type="button"
              >
                {code === "ru" ? "Россия" : "Корея"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce2eb] bg-[#f7f8fa] shadow-sm lg:grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="relative min-h-[280px] bg-[#e9edf2] sm:min-h-[360px]">
            <iframe
              allowFullScreen
              className="absolute inset-0 h-full w-full border-0"
              key={active.id}
              loading="eager"
              referrerPolicy="no-referrer-when-downgrade"
              src={active.mapEmbed}
              title={`Карта офиса TL Auto — ${active.city}`}
            />
          </div>

          <div className="flex flex-col p-5 sm:p-7">
            <div className="flex flex-wrap gap-2">
              {countryLocations.map((location) => (
                <button
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${active.id === location.id ? "border-[#956f2c] bg-[#fbf7ed] text-[#7f5d25]" : "border-[#d8dde6] bg-white text-[#647084] hover:border-[#956f2c]"}`}
                  key={location.id}
                  onClick={() => setLocationId(location.id)}
                  type="button"
                >
                  {location.city}
                </button>
              ))}
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-[#956f2c]">{active.countryLabel}</p>
            <h3 className="mt-2 text-2xl font-semibold text-[#101827]">{active.city}</h3>
            <div className="mt-5 space-y-4 text-sm leading-6">
              <a className="flex items-start gap-3 text-[#4e5b6d] transition hover:text-[#956f2c]" href={active.mapLink} rel="noreferrer" target="_blank"><MapPin className="mt-0.5 shrink-0 text-[#956f2c]" size={18} /><span>{active.address}</span></a>
              <a className="flex items-center gap-3 font-semibold text-[#101827] transition hover:text-[#956f2c]" href={active.phoneHref}><Phone className="shrink-0 text-[#956f2c]" size={18} />{active.phone}</a>
            </div>
            <a className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#11151d] px-5 text-sm font-semibold text-white transition hover:bg-[#1b3555] lg:mt-auto" href={active.mapLink} rel="noreferrer" target="_blank">Открыть в {active.mapLabel} <ArrowRight size={16} /></a>
          </div>
        </div>
      </div>
    </section>
  );
}
