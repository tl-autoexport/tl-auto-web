import {
  siAudi,
  siBmw,
  siFord,
  siHyundai,
  siKia,
  siPorsche,
  siVolkswagen,
} from "simple-icons";

type BrandIcon = { path: string };

const ICONS: Record<string, BrandIcon> = {
  Audi: siAudi,
  BMW: siBmw,
  Ford: siFord,
  Hyundai: siHyundai,
  Kia: siKia,
  Porsche: siPorsche,
  Volkswagen: siVolkswagen,
};

export function BrandLogo({ brand }: { brand: string }) {
  const icon = ICONS[brand];

  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d7d9dd] bg-[#f6f7f8] text-[#13171d]">
      {icon ? (
        <svg aria-label={`${brand} logo`} className="size-6" role="img" viewBox="0 0 24 24">
          <path d={icon.path} fill="currentColor" />
        </svg>
      ) : (
        <span aria-label={`${brand} logo`} className="max-w-7 overflow-hidden text-[8px] font-black leading-none tracking-[-0.08em]">
          {brand.replace(/[^A-Za-zА-Яа-я0-9]/g, "").slice(0, 4).toUpperCase()}
        </span>
      )}
    </span>
  );
}
