export type CountryCode = "RU" | "KZ" | "BY" | "UZ" | "KG" | "DE" | "SE" | "IT" | "NL" | "AE";

export type Destination = {
  countryCode: CountryCode;
  countryLabel: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
  cities: readonly { id: string; label: string }[];
};

export const DESTINATIONS: readonly Destination[] = [
  { countryCode: "RU", countryLabel: "Россия", currencyCode: "RUB", currencySymbol: "₽", locale: "ru-RU", cities: [{ id: "vladivostok", label: "Владивосток" }, { id: "ussuriysk", label: "Уссурийск" }, { id: "volgograd", label: "Волгоград" }, { id: "moscow", label: "Москва" }, { id: "saint-petersburg", label: "Санкт-Петербург" }, { id: "krasnodar", label: "Краснодар" }, { id: "kazan", label: "Казань" }] },
  { countryCode: "KZ", countryLabel: "Казахстан", currencyCode: "KZT", currencySymbol: "₸", locale: "ru-KZ", cities: [{ id: "almaty", label: "Алматы" }] },
  { countryCode: "BY", countryLabel: "Беларусь", currencyCode: "BYN", currencySymbol: "Br", locale: "ru-BY", cities: [{ id: "minsk", label: "Минск" }] },
  { countryCode: "UZ", countryLabel: "Узбекистан", currencyCode: "UZS", currencySymbol: "сум", locale: "ru-UZ", cities: [{ id: "tashkent", label: "Ташкент" }] },
  { countryCode: "KG", countryLabel: "Кыргызстан", currencyCode: "KGS", currencySymbol: "сом", locale: "ru-KG", cities: [{ id: "bishkek", label: "Бишкек" }] },
  { countryCode: "DE", countryLabel: "Германия", currencyCode: "EUR", currencySymbol: "€", locale: "de-DE", cities: [{ id: "bremerhaven", label: "Бремерхафен" }] },
  { countryCode: "SE", countryLabel: "Швеция", currencyCode: "EUR", currencySymbol: "€", locale: "sv-SE", cities: [{ id: "gothenburg", label: "Гётеборг" }, { id: "stockholm", label: "Стокгольм" }] },
  { countryCode: "IT", countryLabel: "Италия", currencyCode: "EUR", currencySymbol: "€", locale: "it-IT", cities: [{ id: "genova", label: "Генуя" }] },
  { countryCode: "NL", countryLabel: "Нидерланды", currencyCode: "EUR", currencySymbol: "€", locale: "nl-NL", cities: [{ id: "rotterdam", label: "Роттердам" }] },
  { countryCode: "AE", countryLabel: "ОАЭ", currencyCode: "AED", currencySymbol: "د.إ", locale: "ar-AE", cities: [{ id: "dubai", label: "Дубай" }, { id: "jebel-ali", label: "Джебель-Али" }] },
];

export const DEFAULT_DESTINATION = { countryCode: "RU" as const, cityId: "vladivostok" };

export function getDestination(countryCode: CountryCode, cityId?: string) {
  const country = DESTINATIONS.find((item) => item.countryCode === countryCode) ?? DESTINATIONS[0];
  const city = country.cities.find((item) => item.id === cityId) ?? country.cities[0];
  return { country, city };
}
