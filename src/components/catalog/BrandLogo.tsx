import Image from "next/image";
import { catalogBrandLogos } from "@/lib/catalog-brand-logos";

export function BrandLogo({ brand, size = 28 }: { brand: string; size?: number }) {
  const src = catalogBrandLogos[brand];
  return src ? <Image alt="" aria-hidden="true" className="shrink-0 object-contain" height={size} src={src} width={size} /> : null;
}
