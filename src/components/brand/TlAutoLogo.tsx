import Image from "next/image";

type TlAutoLogoProps = {
  className?: string;
  priority?: boolean;
  variant?: "header" | "footer" | "hero";
};

const widthByVariant = {
  header: "w-[112px] sm:w-[126px] lg:w-[150px]",
  footer: "w-[190px] sm:w-[220px]",
  hero: "w-[180px] sm:w-[224px]",
} as const;

export function TlAutoLogo({
  className = "",
  priority = false,
  variant = "header",
}: TlAutoLogoProps) {
  return (
    <span
      className={`inline-flex items-center overflow-hidden rounded-[3px] border border-[#d8bd75]/35 bg-[#090c12] shadow-[0_10px_30px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
    >
      <Image
        alt="TL Auto Export"
        className={`h-auto object-contain ${widthByVariant[variant]}`}
        height={724}
        loading={priority ? "eager" : "lazy"}
        sizes={
          variant === "header"
            ? "(min-width: 1024px) 150px, 126px"
            : variant === "hero"
              ? "(min-width: 640px) 224px, 180px"
              : "(min-width: 640px) 220px, 190px"
        }
        src="/branding/tl-auto-wordmark.png"
        width={2172}
      />
    </span>
  );
}
