import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateRuVladivostok } from "@/server/calc/ru";
import { calculateKzAlmaty, getKzTariffs } from "@/server/calc/kz";
import { getCbrCalcRates } from "@/server/calc/rates";
import {
  FixedWindowRateLimiter,
  RequestBodyTooLargeError,
  getRequestClientKey,
  rateLimitHeaders,
  readJsonWithLimit,
} from "@/server/http/request-guard";

const MAX_BODY_BYTES = 8 * 1024;
const calculatorLimiter = new FixedWindowRateLimiter(30, 60_000);

const calcSchema = z.object({
  priceKrw: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(1990).max(2100),
  month: z.coerce.number().int().min(1).max(12).default(6),
  engineCc: z.coerce.number().int().positive(),
  powerHp: z.coerce.number().int().positive().optional(),
  hybridDvsPowerHp: z.coerce.number().int().positive().optional(),
  hybridElectricPowerKw: z.coerce.number().positive().optional(),
  hybridDvsAboveElectric30Min: z.coerce.boolean().optional(),
  hybridSequential: z.coerce.boolean().optional(),
  fuelType: z.string().optional(),
  countryCode: z.enum(["RU", "KZ", "BY", "UZ", "KG", "DE", "SE", "IT", "NL", "AE"]).default("RU"),
  destinationCity: z.string().default("Владивосток"),
}).refine((value) => value.powerHp != null || value.hybridDvsPowerHp != null, {
  message: "Укажите мощность автомобиля или мощность ДВС гибрида.",
});

export async function POST(request: Request) {
  const rateLimit = calculatorLimiter.consume(getRequestClientKey(request));
  const responseHeaders = rateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Повторите расчёт через минуту." },
      {
        status: 429,
        headers: {
          ...responseHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Запрос слишком большой." },
        { status: 413, headers: responseHeaders },
      );
    }
    return NextResponse.json(
      { error: "Некорректный JSON." },
      { status: 400, headers: responseHeaders },
    );
  }
  const parsed = calcSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте параметры расчёта." },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    if (parsed.data.countryCode === "KZ" && parsed.data.destinationCity === "Алматы") {
      const { tariffs, missing } = getKzTariffs();
      if (!tariffs) {
        return NextResponse.json(
          {
            error: `Для расчёта Казахстана нужно подтвердить: ${missing.join(", ")}.`,
            calculationStatus: "pending",
            countryCode: "KZ",
            destinationCity: "Алматы",
            currencyCode: "KZT",
            currencySymbol: "₸",
            customsIncluded: false,
            missingTariffs: missing,
          },
          { status: 422, headers: responseHeaders },
        );
      }
      const rateSnapshot = await getCbrCalcRates();
      return NextResponse.json(
        calculateKzAlmaty({
          priceKrw: parsed.data.priceKrw,
          rates: rateSnapshot.rates,
          tariffs,
          ratesAsOf: rateSnapshot.asOf,
          ratesSource: rateSnapshot.source,
        }),
        { headers: responseHeaders },
      );
    }
    if (parsed.data.countryCode !== "RU" || parsed.data.destinationCity !== "Владивосток") {
      return NextResponse.json(
        { error: "Для выбранного направления тарифы ещё уточняются.", calculationStatus: "pending" },
        { status: 422, headers: responseHeaders },
      );
    }
    const rateSnapshot = await getCbrCalcRates();
    return NextResponse.json(
      calculateRuVladivostok({
        ...parsed.data,
        rates: rateSnapshot.rates,
        ratesAsOf: rateSnapshot.asOf,
        ratesSource: rateSnapshot.source,
        rateDetails: rateSnapshot.rateDetails,
      }),
      { headers: responseHeaders },
    );
  } catch (error) {
    console.error("Unable to load current CBR rates", error);
    return NextResponse.json(
      { error: "Актуальные курсы ЦБ временно недоступны. Расчёт не выполнен." },
      { status: 503, headers: responseHeaders },
    );
  }
}
