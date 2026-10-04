export function CatalogLoadingVisual({ label = "Подбираем автомобили", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`catalog-loader ${compact ? "catalog-loader--compact" : ""}`} role="status" aria-live="polite">
      <div className="catalog-loader__mark" aria-hidden="true">
        <svg className="catalog-loader__ring" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="36" stroke="#eadfc6" strokeWidth="1" />
          <circle className="catalog-loader__arc" cx="40" cy="40" r="36" stroke="#b58c40" strokeWidth="2" strokeLinecap="round" strokeDasharray="58 169" />
        </svg>
        <span className="catalog-loader__initials">TL</span>
      </div>
      <span className="catalog-loader__label">{label}</span>
    </div>
  );
}

export function CatalogCardSkeleton() {
  return (
    <div aria-hidden="true" className="catalog-card-skeleton overflow-hidden rounded-[20px] bg-white ring-1 ring-[#ece9e2] sm:rounded-[24px]">
      <div className="catalog-skeleton-surface aspect-[2.25/1] sm:aspect-[16/10]" />
      <div className="space-y-4 p-5">
        <div className="catalog-skeleton-surface h-6 w-2/3 rounded-md" />
        <div className="catalog-skeleton-surface h-3 w-4/5 rounded-md" />
        <div className="pt-3"><div className="catalog-skeleton-surface h-5 w-1/2 rounded-md" /></div>
        <div className="catalog-skeleton-surface h-3 w-3/4 rounded-md" />
        <div className="catalog-skeleton-surface h-3 w-2/3 rounded-md" />
        <div className="catalog-skeleton-surface mt-5 h-10 rounded-xl" />
      </div>
    </div>
  );
}
