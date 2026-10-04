import { CatalogCardSkeleton, CatalogLoadingVisual } from "@/components/catalog/CatalogLoadingVisual";

export default function CatalogLoading() {
  return (
    <main aria-busy="true" aria-label="Загрузка каталога автомобилей" className="min-h-screen bg-[#fafaf9] text-[#101827]">
      <section className="border-b border-[#ece9e2] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-8 md:py-10">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Каталог автомобилей</h1>
          <p className="mt-3 text-sm text-[#7a8798]">Подбор по реальным данным источника с расчётом цены до Владивостока.</p>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-12">
        <div className="py-8"><CatalogLoadingVisual label="Загружаем каталог" /></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <CatalogCardSkeleton key={index} />)}
        </div>
      </section>
    </main>
  );
}
