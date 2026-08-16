import Link from "next/link";
import { CarFront, ExternalLink } from "lucide-react";
import {
  DEVELOPER_CONTACT,
  telegramContactUrl,
  whatsappContactUrl,
} from "@/lib/contact";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[#dce2eb] bg-[#0d1d31] text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-9 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:py-11">
        <div>
          <Link className="inline-flex items-center gap-3" href="/">
            <span className="flex size-9 items-center justify-center bg-[#ed1c2b]">
              <CarFront size={20} aria-hidden="true" />
            </span>
            <span>
              <strong className="block text-sm uppercase tracking-wide">
                TL Auto
              </strong>
              <small className="text-[10px] uppercase text-white/55">
                авто из Южной Кореи
              </small>
            </span>
          </Link>
          <p className="mt-4 max-w-lg text-xs leading-5 text-white/58">
            Каталог автомобилей из Южной Кореи с актуальными объявлениями
            Encar и предварительным расчётом стоимости доставки.
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
            Связь с разработчиком
          </p>
          <div className="mt-3 flex flex-col gap-2.5 text-sm">
            <a
              className="inline-flex items-center gap-1.5 text-white/72 transition hover:text-white"
              href={telegramContactUrl()}
              rel="noreferrer"
              target="_blank"
            >
              Telegram @{DEVELOPER_CONTACT.telegramUsername}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <a
              className="inline-flex items-center gap-1.5 text-white/72 transition hover:text-white"
              href={whatsappContactUrl()}
              rel="noreferrer"
              target="_blank"
            >
              WhatsApp {DEVELOPER_CONTACT.whatsappLabel}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
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
