import Link from "next/link";
import { MessageCircle, Music2, Send } from "lucide-react";
import { TlAutoLogo } from "@/components/brand/TlAutoLogo";
import {
  CLIENT_CONTACT,
  telegramContactUrl,
  whatsappContactUrl,
  whatsappPowersportsContactUrl,
} from "@/lib/contact";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[#dce2eb] bg-[#090c12] text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-9 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:py-11">
        <div>
          <Link className="inline-flex" href="/" aria-label="TL Auto — на главную">
            <TlAutoLogo className="px-3 py-1.5" variant="footer" />
          </Link>
          <p className="mt-4 max-w-lg text-xs leading-5 text-white/58">
            Актуальные каталоги автомобилей, мототехники и гидроциклов из
            Южной Кореи.
          </p>
        </div>

        <nav aria-label="Юридическая информация">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
            Информация
          </p>
          <div className="mt-3 flex flex-col gap-2.5 text-sm text-white/72">
            <Link className="transition hover:text-white" href="/privacy">
              Конфиденциальность
            </Link>
            <Link className="transition hover:text-white" href="/terms">
              Условия использования
            </Link>
            <Link className="transition hover:text-white" href="/catalog">
              Каталог автомобилей
            </Link>
          </div>
        </nav>

        <div id="contacts">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
            Связаться с TL Auto
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a aria-label={`Telegram @${CLIENT_CONTACT.telegramUsername}`} title={`Telegram @${CLIENT_CONTACT.telegramUsername}`} className="grid size-11 place-items-center rounded-full bg-[#229ed9] text-white transition hover:scale-105" href={telegramContactUrl()} rel="noreferrer" target="_blank"><Send size={20} aria-hidden="true" /></a>
            <a aria-label="MAX" title="MAX" className="grid size-11 place-items-center rounded-full bg-[linear-gradient(135deg,#5367f5,#8d37d8)] text-[11px] font-black tracking-[-0.08em] text-white transition hover:scale-105" href={CLIENT_CONTACT.maxUrl} rel="noreferrer" target="_blank">MAX</a>
            <a aria-label={`WhatsApp — ${CLIENT_CONTACT.whatsappCarLabel}`} title={CLIENT_CONTACT.whatsappCarLabel} className="grid size-11 place-items-center rounded-full bg-[#25d366] text-white transition hover:scale-105" href={whatsappContactUrl()} rel="noreferrer" target="_blank"><MessageCircle size={21} aria-hidden="true" /></a>
            <a aria-label={`WhatsApp — ${CLIENT_CONTACT.whatsappPowersportsLabel}`} title={CLIENT_CONTACT.whatsappPowersportsLabel} className="grid size-11 place-items-center rounded-full bg-[#25d366] text-white transition hover:scale-105" href={whatsappPowersportsContactUrl()} rel="noreferrer" target="_blank"><MessageCircle size={21} aria-hidden="true" /></a>
            <a aria-label="Instagram TL Auto" title="Instagram TL Auto" className="grid size-11 place-items-center rounded-full bg-[linear-gradient(135deg,#f9ce34,#ee2a7b_55%,#6228d7)] text-white transition hover:scale-105" href={CLIENT_CONTACT.instagramUrl} rel="noreferrer" target="_blank"><svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
            <a aria-label="YouTube TL Auto" title="YouTube TL Auto" className="grid size-11 place-items-center rounded-full bg-[#ff0000] text-white transition hover:scale-105" href={CLIENT_CONTACT.youtubeUrl} rel="noreferrer" target="_blank"><svg aria-hidden="true" className="size-5 fill-current" viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg></a>
            <a aria-label="TikTok TL Auto" title="TikTok TL Auto" className="grid size-11 place-items-center rounded-full bg-[#111827] text-white transition hover:scale-105" href={CLIENT_CONTACT.tiktokUrl} rel="noreferrer" target="_blank"><Music2 size={21} aria-hidden="true" /></a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-4 text-[11px] leading-5 text-white/42 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} TL Auto</span>
          <span>
            Цены предварительные и не являются публичной офертой.
          </span>
        </div>
      </div>
    </footer>
  );
}
