import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CarFront, Home, SearchX } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#121722]">
      <SiteHeader />

      <section className="mx-auto flex min-h-[calc(100vh-108px)] max-w-7xl items-center px-5 py-12">
        <div className="grid w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-[#d8dde6] lg:grid-cols-[0.8fr_1.2fr]">
          <div className="relative flex min-h-64 items-center justify-center overflow-hidden bg-[#10243e] p-10 text-white lg:min-h-[480px]">
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:32px_32px]" />
            <div className="relative text-center">
              <SearchX className="mx-auto text-[#73dfc0]" size={44} strokeWidth={1.7} aria-hidden="true" />
              <p className="mt-5 text-7xl font-semibold tracking-tight">404</p>
              <p className="mt-2 text-sm text-white/62">Маршрут не найден</p>
            </div>
          </div>

          <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
            <p className="text-xs font-bold uppercase tracking-wide text-[#e51d2a]">
              TL Auto
            </p>
            <h1 className="mt-3 max-w-xl text-3xl font-semibold leading-tight sm:text-4xl">
              Такой страницы или автомобиля уже нет
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#647084] sm:text-base sm:leading-7">
              Объявление могло быть снято с продажи, либо адрес был введён
              неверно. Вернитесь в актуальный каталог — там отображаются
              доступные автомобили из текущей витрины.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#ed1c2b] px-6 text-sm font-semibold text-white transition hover:bg-[#d91524]"
                href="/catalog"
              >
                <CarFront size={18} aria-hidden="true" />
                Открыть каталог
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#cfd6e0] bg-white px-6 text-sm font-semibold text-[#263247] transition hover:border-[#9ba8ba]"
                href="/"
              >
                <Home size={17} aria-hidden="true" />
                На главную
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
