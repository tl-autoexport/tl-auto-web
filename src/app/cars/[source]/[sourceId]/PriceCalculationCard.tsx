"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Calculator,
  ChevronDown,
  ExternalLink,
  Info,
  MessageCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  telegramContactUrl,
  vehicleDeveloperMessage,
} from "@/lib/contact";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

type CalculationSnapshot = {
  total_rub: number | null;
  car_price_rub: number | null;
  duty_rub: number | null;
  fees_rub: number | null;
  util_rub: number | null;
  freight_rub: number | null;
  broker_rub: number | null;
  calculated_at: string;
  result: unknown;
};

type LiveCalculation = {
  carPriceRub: number;
  freightRub: number;
  brokerRub: number;
  dutyRub: number;
  feesRub: number;
  utilRub: number;
  totalRub: number;
  koreaExpensesRub: number;
  rates: { krwRub: number; usdRub: number; eurRub: number };
  ratesAsOf: string | null;
  ratesSource: string;
  rateDetails: {
    cbrMarkupPercent: number;
    cbrUsdRub: number;
    usdtKrwRaw: number;
    usdtKrwAdjustment: number;
    usdtKrwAdjusted: number;
    fetchedAt: string;
  } | null;
};

const rub = new Intl.NumberFormat("ru-RU");

function money(value: number | null | undefined) {
  return `${rub.format(value ?? 0)}\u00A0₽`;
}

function won(value: number | null | undefined) {
  return `${rub.format(value ?? 0)}\u00A0₩`;
}

function number(value: number | null | undefined) {
  return value ?? 0;
}

function rate(value: number | null | undefined) {
  return value == null ? "-" : value.toLocaleString("ru-RU", { maximumFractionDigits: 5 });
}

function resultValue(result: unknown, key: string): string | number | null {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const value = (result as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function resultNumber(result: unknown, key: string) {
  const value = resultValue(result, key);
  return typeof value === "number" ? value : 0;
}

export function PriceCalculationCard({
  calc,
  color,
  driveType,
  engineCc,
  fuel,
  mileageKm,
  powerHp,
  priceKrw,
  source,
  sourceId,
  sourceUrl,
  title,
  transmission,
  year,
  registrationMonth,
}: {
  calc: CalculationSnapshot | undefined;
  color: string | null;
  driveType: string | null;
  engineCc: number | null;
  fuel: string;
  mileageKm: number | null;
  powerHp: number | null;
  priceKrw: number | null;
  source: string;
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  transmission: string;
  year: number | null;
  registrationMonth: number | null;
}) {
  const [isModalOpen, setModalOpen] = useState(false);
  const [isDutyInfoOpen, setDutyInfoOpen] = useState(false);
  const calculationTitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeCalc, setActiveCalc] = useState<CalculationSnapshot | undefined>(calc);
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const total = number(activeCalc?.total_rub);
  const car = number(activeCalc?.car_price_rub);
  const korea = number(activeCalc?.freight_rub) + number(activeCalc?.broker_rub) + resultNumber(activeCalc?.result, "koreaExpensesRub");
  const russia = number(activeCalc?.fees_rub) + number(activeCalc?.util_rub);
  const duty = number(activeCalc?.duty_rub);
  const excise = resultNumber(activeCalc?.result, "exciseRub");
  const vat = resultNumber(activeCalc?.result, "vatRub");
  const customs = duty + excise + vat;
  const hasCalculationResult = Boolean(activeCalc?.result);
  const calculatedAt = activeCalc?.calculated_at
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(activeCalc.calculated_at))
    : null;
  const rateDetails = resultObject(activeCalc?.result, "rateDetails") as LiveCalculation["rateDetails"];
  const resultRates = resultObject(activeCalc?.result, "rates");

  async function refreshCalculation() {
    if (!priceKrw || !year || !engineCc || !powerHp) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceKrw,
          year,
          month: registrationMonth ?? 6,
          engineCc,
          powerHp,
          fuelType: fuel,
        }),
      });
      const payload = (await response.json()) as LiveCalculation | { error?: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Не удалось обновить расчёт");
      const live = payload as LiveCalculation;
      setActiveCalc({
        total_rub: live.totalRub,
        car_price_rub: live.carPriceRub,
        duty_rub: live.dutyRub,
        fees_rub: live.feesRub,
        util_rub: live.utilRub,
        freight_rub: live.freightRub,
        broker_rub: live.brokerRub,
        calculated_at: new Date().toISOString(),
        result: live,
      });
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Не удалось обновить расчёт");
    } finally {
      setRefreshing(false);
    }
  }
  const leadTelegramUrl = telegramContactUrl(
    vehicleDeveloperMessage({ source, sourceId, title }),
  );

  const portions = useMemo(
    () =>
      [
        { label: "Стоимость авто", value: car, color: "bg-[#65758c]" },
        { label: "Расходы в Южной Корее", value: korea, color: "bg-[#3568c6]" },
        {
          label: "Услуги во Владивостоке",
          value: russia,
          color: "bg-[#1683a7]",
        },
        { label: "Таможенные платежи", value: customs, color: "bg-[#7752c9]" },
      ].filter((item) => item.value > 0),
    [car, customs, korea, russia],
  );

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: () => setModalOpen(false),
    open: isModalOpen,
  });

  return (
    <>
      <aside className="rounded bg-white p-4 shadow-sm ring-1 ring-[#d8dde6] sm:p-5">
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[#956f2c] sm:text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <BadgeCheck className="size-4 shrink-0 sm:size-[18px]" />
            <span className="truncate">Источник Encar</span>
          </div>
          {sourceUrl ? (
            <a className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-[#f0bcc1] px-2.5 text-[11px] font-semibold text-[#c61927] transition hover:bg-[#fbf7ed] sm:text-xs" href={sourceUrl} rel="noopener noreferrer" target="_blank">
              Оригинал
              <ExternalLink size={13} />
            </a>
          ) : null}
        </div>
        <h1 className="mt-2 line-clamp-2 text-2xl font-semibold leading-[1.12] text-[#121722] sm:mt-3 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 text-[13px] text-[#647084] sm:mt-2 sm:text-sm">
          {year ?? "-"} год · {rub.format(mileageKm ?? 0)} км ·{" "}
          {engineCc ?? "-"} см3
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#fff0a5] px-2.5 py-1 text-[11px] font-semibold text-[#5b4d00] sm:px-3 sm:text-xs">
            Расчёт для РФ
          </span>
          <span className="rounded-full bg-[#eef1f6] px-2.5 py-1 text-[11px] font-semibold text-[#536174] sm:px-3 sm:text-xs">
            Владивосток
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3 text-[13px] text-[#647084] sm:mt-4 sm:text-sm">
          <span>Оплата</span>
          <span className="inline-flex min-h-10 items-center gap-2 rounded border border-[#d8dde6] px-3 py-2 font-medium text-[#121722]">
            ₽ в рублях <ChevronDown size={16} />
          </span>
        </div>

        <div className="mt-4 sm:mt-5">
          <p className="whitespace-nowrap text-[30px] font-semibold leading-none tracking-tight text-[#121722] tabular-nums sm:text-3xl">
            {money(total)}
          </p>
          <span className="mt-1.5 block text-xs text-[#647084] sm:text-sm">
            под ключ до Владивостока
          </span>
        </div>

        <div className="mt-5 overflow-hidden rounded-full bg-[#edf0f5] p-0.5">
          <div className="flex h-7 gap-0.5 overflow-hidden rounded-full">
            {portions.map((portion) => {
              const percent = total
                ? Math.max(5, Math.round((portion.value / total) * 100))
                : 25;
              return (
                <div
                  className={`${portion.color} flex items-center justify-center text-xs font-semibold text-white`}
                  key={portion.label}
                  style={{ width: `${percent}%` }}
                  title={`${portion.label}: ${money(portion.value)}`}
                >
                  {percent >= 8 ? `${percent}%` : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] leading-4 text-[#4e5b6d] sm:gap-x-4 sm:text-xs">
          {portions.map((portion) => (
            <div className="flex items-center gap-2" key={portion.label}>
              <span className={`h-2 w-2 rounded-full ${portion.color}`} />
              {portion.label}
            </div>
          ))}
        </div>

        <div className="relative mt-5">
          <button
            aria-expanded={isDutyInfoOpen}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded border border-[#d8dde6] bg-[#fafbfc] px-3 py-2 text-left text-xs font-medium leading-4 text-[#39475a] sm:text-sm"
            onClick={() => setDutyInfoOpen((value) => !value)}
            type="button"
          >
            Пошлина зависит от курса и даты оформления
            <Info size={16} className="text-[#647084]" />
          </button>
          {isDutyInfoOpen && (
            <div className="absolute z-10 mt-2 rounded bg-[#07152d] p-4 text-sm leading-5 text-white shadow-xl" role="status">
              <>Для автомобилей старше трёх лет пошлина определяется объёмом двигателя. Для более новых авто итог зависит от стоимости в евро на дату таможенного оформления. Коммерческий режим в TL Auto не используется.</>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-2.5 text-[13px] sm:mt-5 sm:gap-3 sm:text-sm">
          <Spec
            label="Цена в Корее"
            value={priceKrw ? won(priceKrw) : "-"}
          />
          <Spec label="Мощность" value={powerHp ? `${powerHp} л.с.` : "-"} />
          <Spec label="Топливо" value={fuel} />
          <Spec label="КПП" value={transmission} />
          <Spec label="Привод" value={driveType ?? "-"} />
          <Spec label="Цвет" value={color ?? "-"} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:grid-cols-1 sm:gap-3">
          <button
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded bg-[#956f2c] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#c91824] sm:px-5 sm:py-3"
            onClick={() => setModalOpen(true)}
            type="button"
          >
            <Calculator size={17} />
            <span className="sm:hidden">Расчёт</span>
            <span className="hidden sm:inline">Показать расчёт цены</span>
          </button>
          <a
            id="lead"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded border border-[#956f2c] px-3 py-2.5 text-sm font-semibold text-[#956f2c] transition-colors hover:bg-[#fbf7ed] sm:px-5 sm:py-3"
            href={leadTelegramUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <MessageCircle size={17} />
            <span className="sm:hidden">Связаться</span>
            <span className="hidden sm:inline">Оставить заявку</span>
          </a>
        </div>
      </aside>

      {isModalOpen && (
        <div
          ref={dialogRef}
          aria-labelledby={calculationTitleId}
          aria-modal="true"
          className="fixed inset-0 z-[80] grid place-items-center bg-[#07152d]/75 p-0 sm:p-4"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setModalOpen(false)
          }
          role="dialog"
        >
          <section className="max-h-[100dvh] w-full max-w-xl overflow-y-auto bg-[#f4f5f7] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[calc(100dvh-32px)] sm:rounded">
            <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-[#e1e5eb] bg-white px-4 py-2 sm:px-5 sm:py-4">
              <div>
                <h2 id={calculationTitleId} className="text-xl font-semibold text-[#121722]">
                  Расчёт цены
                </h2>
                {calculatedAt && (
                  <p className="mt-1 text-xs text-[#647084]">
                  Сформирован {calculatedAt}
                  </p>
                )}
              </div>
              <button
                ref={closeButtonRef}
                aria-label="Закрыть расчёт"
                className="flex size-11 items-center justify-center rounded text-[#121722] hover:bg-[#eef1f6]"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                <X size={26} />
              </button>
            </header>

            <div className="space-y-4 p-5">
              <section className="rounded bg-[#fffaf0] p-4 ring-1 ring-[#e7cf9b]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[#121722]">Актуальные курсы</h3>
                  </div>
                  <button
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded bg-[#956f2c] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#7f5d25] disabled:cursor-wait disabled:opacity-60"
                    disabled={isRefreshing || !priceKrw || !year || !engineCc || !powerHp}
                    onClick={refreshCalculation}
                    type="button"
                  >
                    <RefreshCw className={isRefreshing ? "animate-spin" : ""} size={15} />
                    {isRefreshing ? "Обновляем" : "Обновить цену"}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <RateRow label="KRW/RUB" value={`${rate(typeof resultRates?.krwRub === "number" ? resultRates.krwRub : null)} ₽`} />
                  <RateRow label="USD/RUB" value={`${rate(typeof resultRates?.usdRub === "number" ? resultRates.usdRub : null)} ₽`} />
                  <RateRow label="USDT/KRW" value={rateDetails ? `${rate(rateDetails.usdtKrwAdjusted)} ₩` : "-"} />
                </div>
                {refreshError && <p className="mt-2 text-xs font-medium text-[#b42318]">{refreshError}</p>}
              </section>
              <div className="rounded bg-white p-4 ring-1 ring-[#e1e5eb]">
                <p className="text-sm text-[#647084]">
                  Цена автомобиля в Корее
                </p>
                <p className="mt-1 text-xl font-semibold text-[#121722]">
                  <span className="whitespace-nowrap tabular-nums">{priceKrw ? won(priceKrw) : "Нет данных"}</span>
                </p>
              </div>
              <CalculationSection
                title="Расходы в Южной Корее"
                rows={[
                  ["Стоимость автомобиля", car],
                  ["Фиксированные расходы в Корее", resultNumber(calc?.result, "koreaExpensesRub")],
                  ["Фрахт", number(calc?.freight_rub)],
                  ["Брокерские услуги", number(calc?.broker_rub)],
                ]}
              />
              <CalculationSection
                title="Таможенные платежи"
                rows={[
                  ["Пошлина", duty],
                  ...(excise > 0
                    ? ([["Акциз", excise]] as Array<[string, number]>)
                    : []),
                  ...(vat > 0
                    ? ([["НДС", vat]] as Array<[string, number]>)
                    : []),
                  ["Таможенный сбор", number(calc?.fees_rub)],
                  ["Утилизационный сбор", number(calc?.util_rub)],
                ]}
              />
              <div className="rounded bg-[#07152d] p-4 text-white">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">Под ключ до Владивостока</span>
                  <span className="text-xl font-semibold">{money(total)}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#cdd5e2]">
                  Предварительный расчёт. Итог зависит от курса, даты оформления
                  и фактических расходов по сделке.
                </p>
              </div>
              {hasCalculationResult && (
                <p className="text-xs text-[#647084]">Курс и цена обновляются кнопкой выше. Сохранённый расчёт используется как исходное значение до обновления.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function resultObject(result: unknown, key: string): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = (result as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function RateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-[#eadfca] pb-2">
      <span className="truncate text-[#647084]">{label}</span>
      <strong className="whitespace-nowrap text-right tabular-nums text-[#121722]">{value}</strong>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-7 items-start justify-between gap-3 border-b border-dashed border-[#cbd3df] pb-2">
      <span className="text-[#647084]">{label}</span>
      <span className="shrink-0 whitespace-nowrap text-right font-semibold text-[#121722] tabular-nums">{value}</span>
    </div>
  );
}

function CalculationSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, number]>;
}) {
  return (
    <section className="rounded bg-white p-4 ring-1 ring-[#e1e5eb]">
      <h3 className="font-semibold text-[#121722]">{title}</h3>
      <div className="mt-3 grid gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div
            className="flex justify-between gap-4 border-b border-dashed border-[#cbd3df] pb-3 last:border-0 last:pb-0"
            key={label}
          >
            <span className="text-[#647084]">{label}</span>
            <span className="shrink-0 whitespace-nowrap text-right font-semibold text-[#121722] tabular-nums">
              {money(value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
