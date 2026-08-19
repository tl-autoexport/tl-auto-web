import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CalendarDays, ExternalLink, Images, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { PassoMediaGallery } from "@/components/catalog/PassoMediaGallery";
import { getPassoStagingCar } from "@/server/cars/repository";
import { carDisplayTitle } from "@/server/normalization/display";

const number = new Intl.NumberFormat("ru-RU");
const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

type Props = { params: Promise<{ source: string; sourceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { source, sourceId } = await params;
  const car = await getPassoStagingCar(source, sourceId);
  return car
    ? { title: `${carDisplayTitle(car)} | TL Auto`, robots: { index: false, follow: false } }
    : { title: "Объявление не найдено", robots: { index: false, follow: false } };
}

export default async function PassoCatalogItemPage({ params }: Props) {
  const { source, sourceId } = await params;
  const car = await getPassoStagingCar(source, sourceId);
  if (!car) notFound();

  const title = carDisplayTitle(car);
  const media = (car.car_media ?? []).filter((item) => item.media_type === "image");
  const isJetski = car.vehicle_type === "jetski";
  const typeLabel = isJetski ? "Гидроцикл" : car.vehicle_type === "scooter" ? "Скутер" : "Мотоцикл";
  const sourceName = source === "passo_boat" ? "Passo Boat" : "Passo Bike";
  const detailRows = buildDetailRows(car.vehicle_specs ?? {});

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#101827]">
      <SiteHeader />
      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-5 sm:py-8">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-md bg-white p-3 shadow-sm ring-1 ring-[#d8dde6] sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={`rounded-sm px-2.5 py-1 text-xs font-semibold ${isJetski ? "bg-[#e4f4f5] text-[#16727a]" : "bg-[#eef0f7] text-[#445276]"}`}>{typeLabel}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#647084]"><ShieldCheck size={14} className="text-[#16727a]" /> Проверено Passo</span>
            </div>
            <PassoMediaGallery title={title} urls={media.map((item) => item.url)} />
          </section>
          <section className="rounded-md bg-white p-5 shadow-sm ring-1 ring-[#d8dde6] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#956f2c]">Источник {sourceName}</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-[#647084]">{car.year ?? "Год не указан"}{car.mileage_km != null ? ` · ${number.format(car.mileage_km)} км` : ""} · лот {car.source_id}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-[#55637a]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f3f5f8] px-2.5 py-1.5"><CalendarDays size={14} className="text-[#956f2c]" /> {formatSourceUpdate(car.source_updated_at)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f3f5f8] px-2.5 py-1.5"><Images size={14} className="text-[#956f2c]" /> {media.length} фото</span>
            </div>
            <div className="mt-7 border-t border-[#edf0f4] pt-5">
              <p className="text-sm text-[#647084]">Цена в Корее</p>
              <p className="mt-1 text-3xl font-semibold">{car.price_krw != null ? `${number.format(car.price_krw)} ₩` : "Цена не указана"}</p>
            </div>
            {detailRows.length ? <div className="mt-6 grid gap-3 border-t border-[#edf0f4] pt-5 text-sm">{detailRows.map((row) => <InfoRow key={row.label} {...row} />)}</div> : null}
            {car.source_url ? <a className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded bg-[#101827] px-4 text-sm font-semibold text-white transition hover:bg-[#28344a]" href={car.source_url} target="_blank" rel="noopener noreferrer">Открыть оригинал Passo <ExternalLink size={15} /></a> : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-dashed border-[#d8dde6] pb-2"><span className="text-[#647084]">{label}</span><span className="text-right font-semibold">{value}</span></div>;
}

function formatSourceUpdate(value: string | null): string {
  if (!value) return "Дата обновления не указана";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Дата обновления не указана" : `Обновлено ${date.format(parsed)}`;
}

function buildDetailRows(specs: Record<string, unknown>): Array<{ label: string; value: ReactNode }> {
  const fields: Array<[string, string, (value: unknown) => ReactNode]> = [
    ["category", "Категория", String],
    ["engine_cc", "Объём двигателя", (value) => `${number.format(Number(value))} см³`],
    ["power_hp", "Мощность", (value) => `${number.format(Number(value))} л.с.`],
    ["fuel", "Топливо", String],
    ["transmission", "КПП", String],
    ["passengers", "Количество мест", (value) => `${value}`],
    ["engines_count", "Количество двигателей", (value) => `${value}`],
    ["color", "Цвет", String],
    ["country", "Страна производства", String],
    ["accident_history", "ДТП", String],
    ["tuning", "Тюнинг", String],
    ["warranty", "Гарантия", String],
    ["negotiable", "Торг", String],
    ["delivery", "Доставка", String],
    ["engine_status", "Моточасы", String],
  ];
  return fields.flatMap(([key, label, format]) => {
    const value = specs[key];
    return value === null || value === undefined || value === "" ? [] : [{ label, value: format(value) }];
  });
}
