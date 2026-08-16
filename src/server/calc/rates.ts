import type { CalcRates } from "./types";

const CBR_DAILY_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type CalcRateSnapshot = {
  rates: CalcRates;
  asOf: string;
  source: "cbr.ru";
};

let cache: { expiresAt: number; snapshot: CalcRateSnapshot } | null = null;

function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function readCurrency(xml: string, charCode: string) {
  const block = xml.match(
    new RegExp(`<Valute[^>]*>\\s*<NumCode>[^<]+</NumCode>\\s*<CharCode>${charCode}</CharCode>[\\s\\S]*?</Valute>`),
  )?.[0];
  if (!block) throw new Error(`CBR rate ${charCode} is missing`);

  const nominal = Number(block.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]);
  const value = parseNumber(block.match(/<Value>([^<]+)<\/Value>/)?.[1] ?? "");
  if (!Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(value) || value <= 0) {
    throw new Error(`CBR rate ${charCode} is invalid`);
  }
  return value / nominal;
}

function parseCbrDate(xml: string): string {
  const value = xml.match(/<ValCurs[^>]*Date="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!value) throw new Error("CBR rate date is missing");
  return `${value[3]}-${value[2]}-${value[1]}`;
}

export async function getCbrCalcRates(): Promise<CalcRateSnapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.snapshot;

  const response = await fetch(CBR_DAILY_RATES_URL, {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "TL-Auto/1.0 price calculator",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`CBR request failed with ${response.status}`);

  const xml = await response.text();
  const snapshot: CalcRateSnapshot = {
    rates: {
      krwRub: readCurrency(xml, "KRW"),
      usdRub: readCurrency(xml, "USD"),
      eurRub: readCurrency(xml, "EUR"),
    },
    asOf: parseCbrDate(xml),
    source: "cbr.ru",
  };
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, snapshot };
  return snapshot;
}
