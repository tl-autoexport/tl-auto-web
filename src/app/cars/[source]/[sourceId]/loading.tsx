import { SiteHeader } from "@/components/site/SiteHeader";

export default function CarDetailLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Загрузка карточки автомобиля"
      className="min-h-screen bg-[#f4f5f7] text-[#121722]"
    >
      <SiteHeader />
      <section className="mx-auto grid max-w-7xl gap-6 px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded bg-white shadow-sm ring-1 ring-[#d8dde6]">
          <div className="aspect-[16/10] bg-[#dfe4ec] motion-safe:animate-pulse" />
          <div className="flex gap-2 border-t border-[#edf0f5] p-3">
            {Array.from({ length: 5 }, (_, index) => <div className="h-16 w-24 rounded bg-[#e7ebf0] motion-safe:animate-pulse" key={index} />)}
          </div>
        </div>
        <div className="rounded bg-white p-5 shadow-sm ring-1 ring-[#d8dde6]">
          <p className="sr-only" role="status">Загружаем данные автомобиля</p>
          <div className="h-8 w-3/4 rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
          <div className="mt-4 h-5 w-1/2 rounded bg-[#edf0f4] motion-safe:animate-pulse" />
          <div className="mt-8 h-12 rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
          <div className="mt-4 h-28 rounded bg-[#edf0f4] motion-safe:animate-pulse" />
        </div>
      </section>
    </main>
  );
}
