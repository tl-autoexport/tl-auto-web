import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";

export function LegalPage({
  children,
  eyebrow,
  lead,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  lead: string;
  title: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 bg-[#f5f6f8] text-[#101827]">
        <div className="mx-auto max-w-4xl px-5 py-12 md:py-16">
          <p className="text-sm font-semibold text-[#956f2c]">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-[#647084]">
            {lead}
          </p>
          <div className="mt-9 space-y-8 rounded-md border border-[#dce2eb] bg-white p-6 text-sm leading-7 text-[#4d596c] md:p-9">
            {children}
          </div>
        </div>
      </main>
    </>
  );
}

export function LegalSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[#101827]">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
