"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, type MouseEvent } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Calculator,
  CarFront,
  ChevronRight,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { RemoteImage } from "@/components/site/RemoteImage";

type PriceStep = {
  label: string;
  value: number | null;
};

type HeroShowroomProps = {
  carHref: string | null;
  carTitle: string;
  imageUrl: string | null;
  metrics: {
    calculated: number;
    under160: number;
    clean: number;
  };
  priceSteps: PriceStep[];
  sourceUpdatedAt: string | null;
  totalPriceRub: number | null;
};

const rub = new Intl.NumberFormat("ru-RU");

export function HeroShowroom({
  carHref,
  carTitle,
  imageUrl,
  metrics,
  priceSteps,
  sourceUpdatedAt,
  totalPriceRub,
}: HeroShowroomProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const knownSteps = priceSteps.filter((step) => step.value && step.value > 0);

  const moveImage = (event: MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    stage.style.setProperty("--hero-x", `${x * 8}px`);
    stage.style.setProperty("--hero-y", `${y * 5}px`);
  };

  const resetImage = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--hero-x", "0px");
    stage.style.setProperty("--hero-y", "0px");
  };

  return (
    <section className="hero-showroom" aria-labelledby="hero-title">
      <div
        ref={stageRef}
        className="hero-showroom__stage"
        onMouseMove={moveImage}
        onMouseLeave={resetImage}
      >
        {imageUrl ? (
          <div className="hero-showroom__media" aria-hidden="true">
            <RemoteImage
              src={imageUrl}
              alt=""
              fill
              fetchPriority="high"
              loading="eager"
              sizes="100vw"
              className="hero-showroom__image"
              fallback={<CarFront size={96} strokeWidth={1.25} />}
            />
          </div>
        ) : (
          <div className="hero-showroom__fallback" aria-hidden="true">
            <CarFront size={96} strokeWidth={1.25} />
          </div>
        )}

        <div className="hero-showroom__scrim" aria-hidden="true" />
        <div className="hero-showroom__scanline" aria-hidden="true" />

        <div className="hero-showroom__content">
          <div className="hero-showroom__copy">
            <div className="hero-showroom__brand" aria-label="TL Auto Export">
              <Image
                alt="TL Auto Export"
                height={724}
                loading="eager"
                sizes="(min-width: 640px) 224px, 180px"
                src="/branding/tl-auto-wordmark.png"
                width={2172}
              />
            </div>
            <p className="hero-showroom__eyebrow">
              <BadgeCheck size={16} aria-hidden="true" />
              Корея · расчёт для РФ · Владивосток
            </p>
            <h1 id="hero-title">
              Автомобили из Кореи{" "}
              <span>с расчётом под ключ</span>
            </h1>
            <p className="hero-showroom__lead">
              Итоговая цена до Владивостока, история и диагностика автомобиля до обращения к менеджеру.
            </p>

            <div className="hero-showroom__actions">
              <Link className="hero-showroom__primary" href="/catalog">
                Смотреть автомобили <ArrowRight size={18} />
              </Link>
              <a className="hero-showroom__secondary" href="#how-it-works">
                <Calculator size={17} /> Как формируется цена
              </a>
            </div>

            <div className="hero-showroom__proof">
              <span><ShieldCheck size={16} /> Расчёт в рублях</span>
              <span><ShieldCheck size={16} /> История и состояние</span>
              <span><Clock3 size={16} /> {formatFreshness(sourceUpdatedAt)}</span>
            </div>

            <div className="hero-showroom__metrics" aria-label="Показатели витрины">
              <Metric value={metrics.calculated} label="с расчётом" />
              <Metric value={metrics.under160} label="до 160 л.с." />
              <Metric value={metrics.clean} label="без ДТП" />
            </div>
          </div>

          <div className="hero-showroom__vehicle-status">
            <span><span className="hero-showroom__pulse" /> Автомобиль из актуальной витрины</span>
            <strong>Источник Encar</strong>
          </div>

          <div className="hero-showroom__price">
            <div className="hero-showroom__price-heading">
              <div>
                <p>Под ключ до Владивостока</p>
                <strong>{totalPriceRub ? `${rub.format(totalPriceRub)}\u00A0₽` : "Расчёт доступен"}</strong>
              </div>
              {carHref ? (
                <Link href={carHref}>
                  Открыть автомобиль <ChevronRight size={17} />
                </Link>
              ) : null}
            </div>

            {knownSteps.length > 1 ? (
              <ol className="hero-showroom__route" aria-label="Состав расчёта">
                {knownSteps.map((step, index) => (
                  <li key={step.label} style={{ "--step-index": index } as React.CSSProperties}>
                    <span>{step.label}</span>
                    <strong>{rub.format(step.value!)}{"\u00A0"}₽</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="hero-showroom__car-title">{carTitle}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="hero-showroom__metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatFreshness(value: string | null) {
  if (!value) return "Актуальная витрина";
  const updated = new Date(value);
  const today = new Date();
  const sameDay =
    updated.getFullYear() === today.getFullYear() &&
    updated.getMonth() === today.getMonth() &&
    updated.getDate() === today.getDate();

  return sameDay ? "Обновлено сегодня" : `Обновлено ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(updated)}`;
}
