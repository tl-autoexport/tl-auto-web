import { SiteHeader } from "@/components/site/SiteHeader";

const cards = Array.from({ length: 6 }, (_, index) => index);

export default function CatalogLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Загрузка каталога автомобилей"
      className="min-h-screen bg-[#f5f6f8] text-[#101827]"
    >
      <SiteHeader />

      <section className="border-b border-[#dce2eb] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-8 md:py-10">
          <div className="h-4 w-20 rounded bg-[#ffd7da] motion-safe:animate-pulse" />
          <div className="mt-4 h-10 w-full max-w-md rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
          <div className="mt-4 h-4 w-full max-w-2xl rounded bg-[#edf0f4] motion-safe:animate-pulse" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-7">
        <div className="border border-[#dce2eb] bg-white p-5 md:p-6">
          <div className="h-6 w-52 rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index}>
                <div className="h-4 w-24 rounded bg-[#edf0f4] motion-safe:animate-pulse" />
                <div className="mt-2 h-11 rounded-md bg-[#e7ebf0] motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-12">
        <p className="sr-only" role="status">
          Загружаем актуальные автомобили
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <div
              className="overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-[#d8dde6]"
              key={card}
            >
              <div className="aspect-[4/3] bg-[#dfe4ec] motion-safe:animate-pulse" />
              <div className="p-4">
                <div className="h-6 w-3/4 rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
                <div className="mt-3 h-4 w-1/2 rounded bg-[#edf0f4] motion-safe:animate-pulse" />
                <div className="mt-6 h-7 w-2/3 rounded bg-[#e7ebf0] motion-safe:animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
