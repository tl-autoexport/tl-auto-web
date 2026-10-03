import Image from "next/image";
import { catalogBrandLogos } from "@/lib/catalog-brand-logos";

export function BrandLogo({ brand, size = 28 }: { brand: string; size?: number }) {
  const source = catalogBrandLogos[brand];
  if (!source) return null;
  const sources = typeof source === "string" ? [source] : source;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {sources.map((src) => (
        <Image alt="" className="shrink-0 object-contain" height={size} key={src} src={src} width={sources.length === 1 ? size : size / sources.length} />
      ))}
    </span>
  );
}
