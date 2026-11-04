import Link from "next/link";
import {
  ChevronUp,
  Handshake,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
} from "lucide-react";
import { TlAutoLogo } from "@/components/brand/TlAutoLogo";
import { SocialIcon, type SocialKind } from "@/components/site/SiteHeader";
import { CLIENT_CONTACT, telegramContactUrl } from "@/lib/contact";

const companyLinks = [
  { label: "О нас", href: "/" },
  { label: "Преимущества", href: "/partners" },
  { label: "Отзывы", href: "/#reviews" },
  { label: "Контакты", href: "/#contacts" },
];

const serviceLinks = [
  { label: "Автомобили", href: "/catalog" },
  { label: "Мотоциклы", href: "/catalog?category=motorcycle" },
  { label: "Водная техника", href: "/catalog?category=jetski" },
  { label: "Оформление", href: "/#contacts" },
  { label: "Доставка", href: "/#contacts" },
];

const socialLinks: Array<{ label: string; kind: SocialKind; href: string }> = [
  { label: "Instagram", kind: "instagram", href: CLIENT_CONTACT.instagramUrl },
  { label: "Telegram", kind: "telegram", href: telegramContactUrl() },
  { label: "MAX", kind: "max", href: CLIENT_CONTACT.maxUrl },
  { label: "YouTube", kind: "youtube", href: CLIENT_CONTACT.youtubeUrl },
  { label: "TikTok", kind: "tiktok", href: CLIENT_CONTACT.tiktokUrl },
];

const assurances = [
  { icon: ShieldCheck, text: <>Проверенные<br />авто</> },
  { icon: Handshake, text: <>Прозрачные<br />условия</> },
  { icon: Star, text: <>Личный подход<br />к каждому клиенту</> },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/[0.08] bg-[#090b0f] text-white">
      <div className="mx-auto max-w-[1280px] px-4 py-4 sm:px-8 sm:py-11 lg:px-10 lg:py-12">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-6 sm:gap-y-8 md:grid-cols-[minmax(0,1.8fr)_minmax(130px,0.55fr)_minmax(150px,0.55fr)] md:gap-10 lg:gap-14">
          <div className="col-span-2 md:col-span-1">
            <Link className="inline-flex" href="/" aria-label="TL Auto — на главную">
              <TlAutoLogo className="border-0 shadow-none [&_img]:w-[160px] sm:[&_img]:w-[300px]" variant="footer" />
            </Link>
            <p className="mt-3 max-w-[430px] text-xs leading-5 text-white/70 sm:mt-5 sm:text-base sm:leading-[1.9]">
              Автомобили, мотоциклы, гидроциклы и водная техника из Южной Кореи и других стран.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-x-1.5 gap-y-1 text-[9px] text-white/75 sm:mt-7 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 md:gap-x-2 lg:gap-x-5">
              {assurances.map(({ icon: Icon, text }, index) => (
                <div className="flex items-center gap-1.5 sm:gap-3 md:gap-2 lg:gap-3" key={index}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-[#e5bd4e] sm:size-[29px] md:size-6 lg:size-[29px]" size={29} strokeWidth={1.8} />
                  <span className="leading-[1.45] md:text-[10px] lg:text-xs">{text}</span>
                  {index < assurances.length - 1 ? <span aria-hidden="true" className="ml-1 hidden h-8 w-px bg-white/25 sm:block md:hidden lg:block" /> : null}
                </div>
              ))}
            </div>
          </div>

          <FooterNav ariaLabel="Компания" title="Компания" links={companyLinks} />
          <FooterNav ariaLabel="Услуги" title="Услуги" links={serviceLinks} />
        </div>

        <div className="my-3 border-t border-white/[0.16] sm:my-8" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-8 md:gap-10">
          <section aria-labelledby="footer-contact-title">
            <FooterHeading id="footer-contact-title">Связаться с нами</FooterHeading>
            <div className="mt-3 grid gap-2 text-[11px] leading-4 text-white/85 sm:mt-5 sm:gap-5 sm:text-base sm:leading-5">
              <a className="inline-flex min-h-8 items-center gap-2 transition hover:text-white sm:gap-3" href="https://maps.google.com/?q=Vladivostok" rel="noreferrer" target="_blank">
                <MapPin aria-hidden="true" className="size-4 shrink-0 text-[#e5bd4e] sm:size-[23px]" size={23} fill="currentColor" stroke="#090b0f" />
                Владивосток
              </a>
              <a className="inline-flex min-h-8 items-center gap-2 transition hover:text-white sm:gap-3" href={`tel:${CLIENT_CONTACT.russiaPhone}`}>
                <Phone aria-hidden="true" className="size-4 shrink-0 text-[#e5bd4e] sm:size-[22px]" size={22} fill="currentColor" stroke="#090b0f" />
                {CLIENT_CONTACT.russiaPhoneLabel}
              </a>
              <a className="inline-flex min-h-8 items-center gap-2 transition hover:text-white sm:gap-3" href="mailto:info@tl-auto.ru">
                <Mail aria-hidden="true" className="size-4 shrink-0 text-[#e5bd4e] sm:size-[23px]" size={23} />
                info@tl-auto.ru
              </a>
            </div>
          </section>

          <section aria-labelledby="footer-social-title" className="md:border-l md:border-white/25 md:pl-10">
            <FooterHeading id="footer-social-title">Мы в соцсетях</FooterHeading>
            <nav aria-label="Социальные сети TL Auto" className="mt-3 grid max-w-[390px] grid-cols-3 gap-1.5 sm:mt-5 sm:grid-cols-5 sm:gap-4">
              {socialLinks.map((social) => (
                <a
                  aria-label={social.label}
                  className="grid size-10 place-items-center rounded-[9px] border border-white/40 text-white transition hover:border-[#e5bd4e] hover:text-[#f2d05a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5bd4e] sm:size-[66px] sm:rounded-[17px]"
                  href={social.href}
                  key={social.label}
                  rel="noreferrer"
                  target="_blank"
                  title={social.label}
                >
                  <SocialIcon kind={social.kind} size={19} />
                </a>
              ))}
            </nav>
          </section>
        </div>

        <div className="my-3 border-t border-white/[0.16] sm:my-8" />

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[9px] leading-3.5 text-white/60 sm:grid-cols-[1.1fr_1fr_auto] sm:items-center sm:gap-6 sm:text-xs sm:leading-5">
          <p className="col-span-2 sm:col-span-1">© {new Date().getFullYear()} TL Auto Export. Все права защищены.</p>
          <nav aria-label="Юридическая информация" className="grid gap-1 sm:border-l sm:border-white/25 sm:pl-7">
            <Link className="transition hover:text-white" href="/privacy">Политика конфиденциальности</Link>
            <Link className="transition hover:text-white" href="/terms">Пользовательское соглашение</Link>
          </nav>
          <a
            aria-label="Наверх страницы"
            className="col-span-2 grid size-[44px] place-items-center justify-self-start rounded-full border-2 border-[#e5bd4e] text-[#f2d05a] transition hover:bg-[#e5bd4e] hover:text-[#090b0f] sm:col-span-1 sm:size-[70px]"
            href="#"
          >
            <ChevronUp aria-hidden="true" className="size-[18px] sm:size-6" strokeWidth={2.4} />
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterNav({
  ariaLabel,
  links,
  title,
}: {
  ariaLabel: string;
  links: Array<{ label: string; href: string }>;
  title: string;
}) {
  return (
    <nav aria-label={ariaLabel}>
      <FooterHeading>{title}</FooterHeading>
      <ul className="mt-2.5 grid gap-1 text-[11px] leading-4 text-white/75 sm:mt-5 sm:gap-3 sm:text-base sm:leading-normal">
        {links.map(({ href, label }) => (
          <li key={label}>
            <Link className="transition hover:text-white" href={href}>{label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function FooterHeading({
  children,
  id,
}: {
  children: string;
  id?: string;
}) {
  return (
    <h2 className="text-[13px] font-semibold text-white sm:text-lg" id={id}>
      {children}
      <span aria-hidden="true" className="mt-1.5 block h-[2px] w-8 bg-[#e5bd4e] sm:mt-3 sm:w-10" />
    </h2>
  );
}
