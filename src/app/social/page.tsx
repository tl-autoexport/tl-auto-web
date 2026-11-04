import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { SocialIcon, type SocialKind } from "@/components/site/SiteHeader";
import {
  CLIENT_CONTACT,
  telegramContactUrl,
  whatsappContactUrl,
  whatsappPowersportsContactUrl,
} from "@/lib/contact";

const channels: Array<{
  name: string;
  kind: SocialKind;
  href: string;
  description: string;
  tone: string;
}> = [
  {
    name: "Instagram",
    kind: "instagram",
    href: CLIENT_CONTACT.instagramUrl,
    description: "Новые поступления и новости TL Auto.",
    tone: "bg-[linear-gradient(135deg,#f9ce34,#ee2a7b_55%,#6228d7)]",
  },
  {
    name: "Telegram",
    kind: "telegram",
    href: telegramContactUrl(),
    description: "Новости, автомобили и связь с командой TL Auto.",
    tone: "bg-[#229ed9]",
  },
  {
    name: "MAX",
    kind: "max",
    href: CLIENT_CONTACT.maxUrl,
    description: "Подписывайтесь на TL Auto и задавайте вопросы.",
    tone: "bg-[linear-gradient(135deg,#5367f5,#8d37d8)]",
  },
  {
    name: "YouTube",
    kind: "youtube",
    href: CLIENT_CONTACT.youtubeUrl,
    description: "Видеообзоры, автомобили и жизнь в Корее.",
    tone: "bg-[#ff0000]",
  },
  {
    name: "TikTok",
    kind: "tiktok",
    href: CLIENT_CONTACT.tiktokUrl,
    description: "Короткие видео об автомобилях из Кореи.",
    tone: "bg-[#08090c]",
  },
  {
    name: "WhatsApp · автомобили",
    kind: "whatsapp",
    href: whatsappContactUrl(),
    description: "Консультации и подбор автомобилей из Кореи.",
    tone: "bg-[#25d366]",
  },
  {
    name: "WhatsApp · мототехника",
    kind: "whatsapp",
    href: whatsappPowersportsContactUrl(),
    description: "Вопросы по мотоциклам и гидроциклам.",
    tone: "bg-[#25d366]",
  },
];

export const metadata: Metadata = {
  title: "TL Auto в социальных сетях",
  description:
    "Официальные каналы TL Auto: Telegram, MAX, WhatsApp, YouTube, Instagram и TikTok.",
};

export default function SocialPage() {
  return (
    <main className="relative isolate min-h-[calc(100vh-160px)] overflow-hidden bg-[#090a0c] text-white">
      <Image
        alt=""
        aria-hidden="true"
        className="-z-20 object-cover object-[62%_72%] opacity-35 grayscale"
        fill
        priority
        sizes="100vw"
        src="/assets/country-catalogs/korea.webp"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,9,11,0.99)_0%,rgba(8,9,11,0.91)_42%,rgba(8,9,11,0.55)_100%)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,9,11,0.12)_0%,rgba(8,9,11,0.54)_55%,#090a0c_100%)]" />

      <div className="mx-auto max-w-[1440px] px-5 pb-8 pt-12 sm:px-8 sm:pb-12 sm:pt-16 lg:px-12 lg:pt-20">
        <header className="max-w-3xl">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#e4c52c] sm:text-xs">
            TL Auto <span aria-hidden="true" className="h-px w-12 bg-[#e4c52c]" />
          </p>
          <h1 className="mt-6 text-4xl font-extrabold leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
            Мы в социальных
            <br />
            <span className="text-[#f2d22e]">сетях</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-xl sm:leading-8">
            Подписывайтесь, чтобы первыми узнавать о новых поступлениях, выгодных предложениях, реальных сделках и жизни нашей компании.
          </p>
        </header>

        <section aria-label="Социальные сети и мессенджеры TL Auto" className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {channels.map((channel) => (
            <a
              className="group relative flex min-h-[142px] items-center gap-4 rounded-[22px] border border-white/[0.09] bg-[#111316]/90 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:border-[#e4c52c]/45 hover:bg-[#17191d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e4c52c] sm:min-h-[164px] sm:gap-5 sm:p-5"
              href={channel.href}
              key={channel.name}
              rel="noreferrer"
              target="_blank"
            >
              <span className={`grid size-[58px] shrink-0 place-items-center rounded-[18px] text-white shadow-lg sm:size-[68px] sm:rounded-[21px] ${channel.tone}`}>
                <SocialIcon kind={channel.kind} size={34} />
              </span>
              <span className="min-w-0 self-center pb-3">
                <span className="block text-base font-semibold text-white sm:text-lg">{channel.name}</span>
                <span className="mt-2 block text-sm leading-5 text-white/60">{channel.description}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="absolute bottom-4 right-4 text-[#e4c52c] transition duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:bottom-5 sm:right-5" size={21} />
            </a>
          ))}
        </section>

        <div className="mt-10 flex items-center gap-4 text-sm font-medium text-white/75 sm:mt-14">
          <span aria-hidden="true" className="h-px w-12 bg-[#e4c52c]" />
          Будьте с нами!
        </div>
      </div>
    </main>
  );
}
