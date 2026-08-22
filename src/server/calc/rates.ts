import type { CalcRateDetails, CalcRates } from "./types";
import { createSupabasePublic } from "@/server/supabase/public";

const CBR_DAILY_RATES_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const NAVER_USDT_KRW_URL = "https://m.stock.naver.com/front-api/chart/cryptoChartData";
const CBR_MARKUP_PERCENT = 4;
const USDT_KRW_ADJUSTMENT = 20;
const CBR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USDT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_STORED_RATE_AGE_MS = 24 * 60 * 60 * 1000;

export type CalcRateSnapshot = {
  rates: CalcRates;
  asOf: string;
  source: "cbr.ru + naver.com/Bithumb";
  rateDetails: CalcRateDetails;
};

type CbrSnapshot = {
  usdRub: number;
  eurRub: number;
  krwRub: number;
  kztRub: number;
  asOf: string;
};

let cbrCache: { expiresAt: number; snapshot: CbrSnapshot } | null = null;
let usdtCache: { expiresAt: number; priceKrw: number } | null = null;

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

async function fetchCbrRates(): Promise<CbrSnapshot> {
  if (cbrCache && cbrCache.expiresAt > Date.now()) return cbrCache.snapshot;
  const response = await fetch(CBR_DAILY_RATES_URL, {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "TL-Auto/1.0 price calculator",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`CBR request failed with ${response.status}`);

  const xml = await response.text();
  const snapshot = {
    usdRub: readCurrency(xml, "USD"),
    eurRub: readCurrency(xml, "EUR"),
    krwRub: readCurrency(xml, "KRW"),
    kztRub: readCurrency(xml, "KZT"),
    asOf: parseCbrDate(xml),
  };
  cbrCache = { expiresAt: Date.now() + CBR_CACHE_TTL_MS, snapshot };
  return snapshot;
}

async function fetchUsdtKrw(): Promise<number> {
  if (usdtCache && usdtCache.expiresAt > Date.now()) return usdtCache.priceKrw;
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const url = new URL(NAVER_USDT_KRW_URL);
  url.searchParams.set("exchangeType", "BITHUMB");
  url.searchParams.set("nfTicker", "USDT");
  url.searchParams.set("marketType", "KRW");
  url.searchParams.set("type", "days");
  url.searchParams.set("interval", "1");
  url.searchParams.set("from", from.toISOString().slice(0, 19));
  url.searchParams.set("to", now.toISOString().slice(0, 19));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://m.stock.naver.com/fchart/crypto/BITHUMB/USDT",
      "User-Agent": "TL-Auto/1.0 price calculator",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Naver USDT/KRW request failed with ${response.status}`);
  const payload = (await response.json()) as {
    isSuccess?: boolean;
    result?: Array<{ closePrice?: number }>;
  };
  const last = payload.result?.at(-1)?.closePrice;
  if (!payload.isSuccess || !Number.isFinite(last) || Number(last) <= USDT_KRW_ADJUSTMENT) {
    throw new Error("Naver USDT/KRW response is invalid");
  }
  usdtCache = { expiresAt: Date.now() + USDT_CACHE_TTL_MS, priceKrw: Number(last) };
  return Number(last);
}

export async function getCbrCalcRates(): Promise<CalcRateSnapshot> {
  try {
    return await buildLiveRateSnapshot();
  } catch (liveError) {
    try {
      const stored = await getStoredRateSnapshot();
      if (stored) return stored;
    } catch (storedError) {
      console.error("Unable to load stored calculation rates", storedError);
    }
    throw liveError;
  }
}

async function buildLiveRateSnapshot(): Promise<CalcRateSnapshot> {
  const [cbr, usdtKrwRaw] = await Promise.all([fetchCbrRates(), fetchUsdtKrw()]);
  const markup = 1 + CBR_MARKUP_PERCENT / 100;
  const usdtKrwAdjusted = usdtKrwRaw - USDT_KRW_ADJUSTMENT;
  const usdRub = cbr.usdRub * markup;
  const eurRub = cbr.eurRub * markup;
  const krwRub = usdRub / usdtKrwAdjusted;
  const fetchedAt = new Date().toISOString();
  const rateDetails: CalcRateDetails = {
    cbrMarkupPercent: CBR_MARKUP_PERCENT,
    cbrUsdRub: cbr.usdRub,
    cbrEurRub: cbr.eurRub,
    cbrKrwRub: cbr.krwRub,
    cbrKztRub: cbr.kztRub,
    usdtKrwRaw,
    usdtKrwAdjustment: -USDT_KRW_ADJUSTMENT,
    usdtKrwAdjusted,
    fetchedAt,
    source: "cbr.ru + naver.com/Bithumb",
  };
  return {
    rates: { krwRub, usdRub, eurRub, kztRub: cbr.kztRub },
    asOf: cbr.asOf,
    source: "cbr.ru + naver.com/Bithumb",
    rateDetails,
  };
}

async function getStoredRateSnapshot(): Promise<CalcRateSnapshot | null> {
  const supabase = createSupabasePublic();
  const { data, error } = await supabase
    .from("calc_rate_snapshots")
    .select("rates,rate_details,source,as_of,fetched_at,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const fetchedAt = new Date(String(data.fetched_at));
  if (!Number.isFinite(fetchedAt.getTime()) || Date.now() - fetchedAt.getTime() > MAX_STORED_RATE_AGE_MS) return null;
  const rates = data.rates as Partial<CalcRates>;
  const details = data.rate_details as Partial<CalcRateDetails>;
  if (!Number.isFinite(rates.krwRub) || !Number.isFinite(rates.usdRub) || !Number.isFinite(rates.eurRub) || !Number.isFinite(rates.kztRub)) return null;
  return {
    rates: { krwRub: Number(rates.krwRub), usdRub: Number(rates.usdRub), eurRub: Number(rates.eurRub), kztRub: Number(rates.kztRub) },
    asOf: String(data.as_of),
    source: String(data.source) as CalcRateSnapshot["source"],
    rateDetails: {
      cbrMarkupPercent: Number(details.cbrMarkupPercent ?? CBR_MARKUP_PERCENT),
      cbrUsdRub: Number(details.cbrUsdRub ?? rates.usdRub),
      cbrEurRub: Number(details.cbrEurRub ?? rates.eurRub),
      cbrKrwRub: Number(details.cbrKrwRub ?? rates.krwRub),
      cbrKztRub: Number(details.cbrKztRub ?? rates.kztRub),
      usdtKrwRaw: Number(details.usdtKrwRaw ?? 0),
      usdtKrwAdjustment: Number(details.usdtKrwAdjustment ?? -USDT_KRW_ADJUSTMENT),
      usdtKrwAdjusted: Number(details.usdtKrwAdjusted ?? 0),
      fetchedAt: fetchedAt.toISOString(),
      source: String(data.source),
    },
  };
}
