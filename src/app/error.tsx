"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[ui] Route rendering failed", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#121722]">
      <title>Не удалось загрузить страницу | TL Auto</title>
      <SiteHeader />

      <section className="mx-auto flex min-h-[calc(100vh-108px)] max-w-4xl items-center px-5 py-12">
        <div className="w-full rounded-md bg-white p-7 shadow-sm ring-1 ring-[#d8dde6] sm:p-10">
          <span className="flex size-12 items-center justify-center rounded-md bg-[#fff0f1] text-[#956f2c]">
            <AlertTriangle size={24} aria-hidden="true" />
          </span>
          <p className="mt-7 text-xs font-bold uppercase tracking-wide text-[#956f2c]">
            Временная ошибка
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
            Не удалось загрузить данные
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#647084] sm:text-base sm:leading-7">
            Возможно, источник данных временно недоступен. Повторите загрузку —
            выбранные параметры и адрес страницы сохранятся.
          </p>

          {error.digest ? (
            <p className="mt-4 text-xs text-[#8a96a8]">
              Код обращения: {error.digest}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#c7a55a] px-6 text-sm font-semibold text-[#15130f] transition hover:bg-[#aa873e]"
              onClick={() => unstable_retry()}
              type="button"
            >
              <RefreshCw size={17} aria-hidden="true" />
              Повторить загрузку
            </button>
            <Link
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#cfd6e0] bg-white px-6 text-sm font-semibold text-[#263247] transition hover:border-[#9ba8ba]"
              href="/"
            >
              <Home size={17} aria-hidden="true" />
              На главную
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
