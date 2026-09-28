import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MessageCircle, MoveRight } from "lucide-react";
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
  handle?: string;
  tone: string;
  featured?: boolean;
}> = [
  {
    name: "Telegram",
    kind: "telegram",
    href: telegramContactUrl(),
    description: "Новости, автомобили и связь с командой TL Auto.",
    handle: `@${CLIENT_CONTACT.telegramUsername}`,
    tone: "bg-[#229ed9]",
    featured: true,
  },
  {
    name: "MAX",
    kind: "max",
    href: CLIENT_CONTACT.maxUrl,
    description: "Подписывайтесь на TL Auto и задавайте вопросы.",
    tone: "bg-[linear-gradient(135deg,#5367f5,#8d37d8)]",
    featured: true,
  },
  {
    name: "WhatsApp · автомобили",
    kind: "whatsapp",
    href: whatsappContactUrl(),
    description: "Консультации и подбор автомобилей из Кореи.",
    handle: "+82 10 7626 0741",
    tone: "bg-[#25d366]",
  },
  {
    name: "WhatsApp · мототехника",
    kind: "whatsapp",
    href: whatsappPowersportsContactUrl(),
    description: "Вопросы по мотоциклам и гидроциклам.",
    handle: "+82 10 6798 6644",
    tone: "bg-[#25d366]",
  },
  {
    name: "YouTube",
    kind: "youtube",
    href: CLIENT_CONTACT.youtubeUrl,
    description: "Видеообзоры, автомобили и жизнь в Корее.",
    handle: "@tl_auto_export",
    tone: "bg-[#ff0000]",
  },
  {
    name: "Instagram",
    kind: "instagram",
    href: CLIENT_CONTACT.instagramUrl,
    description: "Новые поступления и новости TL Auto.",
    handle: "@tl_auto_export",
    tone: "bg-[linear-gradient(135deg,#f9ce34,#ee2a7b_55%,#6228d7)]",
  },
  {
    name: "TikTok",
    kind: "tiktok",
    href: CLIENT_CONTACT.tiktokUrl,
    description: "Короткие видео об автомобилях из Кореи.",
    handle: "@tl_auto",
    tone: "bg-[#111827]",
  },
];

export const metadata = {
  title: "TL Auto в социальных сетях",
  description: "Официальные каналы TL Auto: Telegram, MAX, WhatsApp, YouTube, Instagram и TikTok.",
};

export default function SocialPage() {
  return (
    <main className="min-h-[calc(100vh-160px)] bg-[#f5f6f8] text-[#101827]">
      <section className="relative isolate overflow-hidden border-b border-[#dce2eb] bg-white">
        <div aria-hidden="true" className="absolute -right-24 -top-32 -z-10 size-96 rounded-full bg-[#f4ead3] blur-3xl" />
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
          <Link className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#68758a] transition hover:text-[#956f2c]" href="/">
            <ArrowLeft aria-hidden="true" size={17} /> На главную
          </Link>
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#a98239]">TL Auto · На связи</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Мы в соцсетях</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#68758a] sm:text-lg">
              Следите за новыми автомобилями из Кореи, смотрите обзоры и выбирайте удобный способ связаться с нашей командой.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#111827] px-5 text-sm font-semibold text-white transition hover:bg-[#263247]" href="/catalog">
              Смотреть каталог <MoveRight aria-hidden="true" size={17} />
            </Link>
            <a className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#dce2eb] bg-white px-5 text-sm font-semibold text-[#263247] transition hover:border-[#a98239]" href={whatsappContactUrl()} rel="noreferrer" target="_blank">
              <MessageCircle aria-hidden="true" size={17} /> Задать вопрос
            </a>
          </div>
        </div>
      </section>

      <section aria-label="Официальные каналы TL Auto" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold sm:text-2xl">Выберите удобную площадку</h2>
            <p className="mt-1 text-sm text-[#68758a]">Официальные каналы и контакты TL Auto</p>
          </div>
          <span className="hidden rounded-full border border-[#e1e5eb] bg-white px-3 py-1.5 text-xs font-medium text-[#68758a] sm:inline-flex">7 каналов</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <a
              className={`group relative flex min-h-52 flex-col rounded-2xl border bg-white p-5 shadow-[0_4px_16px_rgba(15,31,49,0.04)] transition duration-200 hover:-translate-y-1 hover:border-[#c9b27d] hover:shadow-[0_14px_30px_rgba(15,31,49,0.1)] ${channel.featured ? "border-[#e2d6bb]" : "border-[#dce2eb]"}`}
              href={channel.href}
              key={channel.name}
              rel="noreferrer"
              target="_blank"
            >
              <div className="flex items-start justify-between">
                <span className={`grid size-14 place-items-center rounded-2xl text-white shadow-sm ${channel.tone}`}>
                  <SocialIcon kind={channel.kind} size={26} />
                </span>
                <ArrowUpRight aria-hidden="true" className="text-[#a4adba] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#956f2c]" size={20} />
              </div>
              <div className="mt-5">
                <h3 className="font-semibold text-[#101827]">{channel.name}</h3>
                <p className="mt-1 text-sm leading-6 text-[#68758a]">{channel.description}</p>
              </div>
              {channel.handle ? <span className="mt-auto pt-4 text-xs font-semibold text-[#956f2c]">{channel.handle}</span> : null}
            </a>
          ))}
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-[#8792a2]">Открывая канал, вы переходите на внешний сайт или в приложение соответствующей соцсети.</p>
      </section>
    </main>
  );
}
