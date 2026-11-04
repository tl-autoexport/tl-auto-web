import type { Metadata } from "next";
import { PartnerInquiryForm } from "@/components/partners/PartnerInquiryForm";

export const metadata: Metadata = {
  title: "Станьте нашим партнёром — TL Auto",
  alternates: { canonical: "/partners" },
};

export default function PartnersPage() {
  return (
    <main className="min-h-[calc(100vh-160px)] bg-[#f5f6f8] px-4 py-8 text-[#101827] sm:px-6 sm:py-14">
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#dce2eb] bg-white p-5 shadow-[0_8px_30px_rgba(15,31,49,0.05)] sm:p-9 lg:p-12">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Станьте нашим партнёром
          </h1>
          <div className="mt-6 space-y-4 text-base leading-7 text-[#344054] sm:text-lg sm:leading-8">
            <p>
              TL AUTO — надёжный поставщик автомобилей с опытом работы более 3 лет.
            </p>
            <p>
              Наш офис находится в Южной Корее в городе Инчхон, также у нас есть офис в Волгограде.
            </p>
            <p>
              Мы лично подбираем и проверяем автомобили в Южной Корее. В Китае, Японии, Европе, Канаде и ОАЭ работаем с проверенными партнёрами.
            </p>
            <p>
              Готовы к сотрудничеству с автосалонами, дилерами и компаниями, заинтересованными в надёжных поставках автомобилей. Условия сотрудничества обсуждаем индивидуально.
            </p>
          </div>
        </div>

        <PartnerInquiryForm />
      </div>
    </main>
  );
}
