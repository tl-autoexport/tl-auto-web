"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bike,
  CarFront,
  ChevronDown,
  Globe2,
  MapPin,
  Menu,
  ShipWheel,
  X,
} from "lucide-react";
import { ContactModal } from "@/components/site/ContactModal";
import { FloatingMessengerWidget } from "@/components/site/FloatingMessengerWidget";
import { TlAutoLogo } from "@/components/brand/TlAutoLogo";
import { CLIENT_CONTACT } from "@/lib/contact";

const utilityLinks = [
  { label: "О сервисе", href: "/#about", pending: false },
  { label: "Калькуляторы", href: "/#how-it-works", pending: false },
  { label: "Как купить", href: "/#how-it-works", pending: false },
  { label: "Доставка", href: "/#delivery", pending: false },
  { label: "Отзывы", href: "/#reviews", pending: false },
  { label: "Контакты", href: "/#contacts", pending: false, contact: true },
] as const;

const catalogLinks = [
  { label: "Авто из Кореи", href: "/catalog", icon: CarFront, pending: false },
  { label: "Авто из Китая", href: "#", icon: CarFront, pending: true },
  { label: "Мотоциклы из Кореи", href: "/catalog?category=motorcycle", icon: Bike, pending: false },
  { label: "Гидроциклы из Кореи", href: "/catalog?category=jetski", icon: ShipWheel, pending: false },
] as const;

const topLinks = [
  { label: "О компании", href: "/#about" },
  { label: "Калькуляторы", href: "/#how-it-works" },
  { label: "Отзывы", href: "/#reviews" },
  { label: "Доставка", href: "/#delivery" },
  { label: "Оптовым покупателям", href: "/#contacts" },
  { label: "Контакты", href: "/#contacts" },
  { label: "Курсы валют", href: "/#how-it-works" },
] as const;

const clientWhatsAppPhone = "+82 10 7626 0741";

type SocialKind = "telegram" | "whatsapp" | "youtube" | "instagram" | "tiktok" | "vk";

const socialLinks = [
  { label: "Telegram", href: "https://t.me/TL_Auto_export", kind: "telegram" },
  { label: "WhatsApp", href: `https://wa.me/${CLIENT_CONTACT.whatsappCarPhone}`, kind: "whatsapp" },
  { label: "YouTube", href: CLIENT_CONTACT.youtubeUrl, kind: "youtube" },
  { label: "Instagram", href: CLIENT_CONTACT.instagramUrl, kind: "instagram" },
  { label: "TikTok", href: CLIENT_CONTACT.tiktokUrl, kind: "tiktok" },
  { label: "VK", href: null, kind: "vk" },
] as const;

const CONTACT_PROMPT_SESSION_KEY = "tl-auto-contact-prompt-v1-shown";
const CONTACT_PROMPT_DELAY_MS = 45_000;
const DESKTOP_UTILITY_HIDE_AFTER = 84;
const DESKTOP_UTILITY_SHOW_BEFORE = 24;

function contactPromptWasShown() {
  try {
    return window.sessionStorage.getItem(CONTACT_PROMPT_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function markContactPromptShown() {
  try {
    window.sessionStorage.setItem(CONTACT_PROMPT_SESSION_KEY, "true");
  } catch {
    // The contact flow must keep working when storage is unavailable.
  }
}

function SocialIcon({ kind, size = 17 }: { kind: SocialKind; size?: number }) {
  const commonProps = {
    "aria-hidden": true,
    className: "block",
    fill: "none",
    height: size,
    viewBox: "0 0 24 24",
    width: size,
  } as const;

  if (kind === "telegram") {
    return (
      <svg {...commonProps} fill="currentColor">
        <path d="m21.5 4.2-3.4 15.2c-.25 1.08-.88 1.35-1.79.84l-5-3.69-2.41 2.32c-.27.27-.5.5-1.03.5l.36-5.1 9.28-8.39c.4-.36-.09-.56-.63-.2L5.4 12.9.47 11.35c-1.07-.34-1.08-1.08.22-1.6l19.29-7.44c.9-.33 1.68.21 1.52 1.89Z" />
      </svg>
    );
  }

  if (kind === "whatsapp") {
    return (
      <svg {...commonProps}>
        <path d="M20.2 11.3a8.2 8.2 0 0 1-12 7.2L4 20l1.4-4.1a8.2 8.2 0 1 1 14.8-4.6Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.7 8.2c.17-.42.35-.43.64-.43h.48c.2 0 .4.08.5.35l.6 1.4c.1.24.07.43-.1.62l-.48.57c-.14.15-.2.3-.06.52.2.36.76 1.25 1.66 1.8.92.56 1.25.72 1.63.84.2.07.35.04.48-.12l.65-.8c.16-.2.34-.18.57-.1l1.35.64c.22.1.36.16.42.27.06.1.06.65-.25 1.26-.31.61-1.13.97-1.55 1-.4.04-.92.18-2.99-.68-2.5-1.04-4.1-3.62-4.22-3.8-.12-.17-1-1.34-1-2.55 0-1.2.63-1.79.87-2.1Z" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "youtube") {
    return (
      <svg {...commonProps} fill="currentColor">
        <path d="M21.6 7.2a2.9 2.9 0 0 0-2.04-2.04C17.77 4.67 12 4.67 12 4.67s-5.77 0-7.56.49A2.9 2.9 0 0 0 2.4 7.2c-.49 1.79-.49 4.8-.49 4.8s0 3.01.49 4.8a2.9 2.9 0 0 0 2.04 2.04c1.79.49 7.56.49 7.56.49s5.77 0 7.56-.49a2.9 2.9 0 0 0 2.04-2.04c.49-1.79.49-4.8.49-4.8s0-3.01-.49-4.8ZM9.75 15.4V8.6L15.6 12l-5.85 3.4Z" />
      </svg>
    );
  }

  if (kind === "instagram") {
    return (
      <svg {...commonProps}>
        <rect height="16.5" rx="4.5" stroke="currentColor" strokeWidth="1.8" width="16.5" x="3.75" y="3.75" />
        <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17.7" cy="6.45" fill="currentColor" r="1.05" />
      </svg>
    );
  }

  if (kind === "tiktok") {
    return (
      <svg {...commonProps} fill="currentColor">
        <path d="M15.6 3.2h2.7c.3 2.1 1.5 3.6 3.7 4.2v2.8c-1.5 0-2.8-.4-3.9-1.1v5.6a5.1 5.1 0 1 1-5.1-5.1c.3 0 .7 0 1 .1v2.8a2.4 2.4 0 1 0 1.4 2.2V3.2h.2Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4.2 7.2c.18 5.75 3 9.2 7.9 9.2h.28v-3.29c1.8.18 3.17 1.5 3.72 3.29h2.58c-.71-2.6-2.58-4.02-3.74-4.46 1.16-.57 2.8-2.61 3.2-4.74H15.8c-.5 1.87-2.02 3.73-3.42 3.9V7.2H10v6.54C8.57 13.38 6.73 11.39 6.65 7.2H4.2Z" fill="currentColor" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [desktopUtilityHidden, setDesktopUtilityHidden] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  const openContact = () => {
    setContactOpen(true);
    markContactPromptShown();
  };

  useEffect(() => {
    if (pathname !== "/" || contactPromptWasShown()) return;

    let timer: number | undefined;
    const startTimer = () => {
      if (document.visibilityState !== "visible" || timer !== undefined) return;
      timer = window.setTimeout(() => {
        setContactOpen(true);
        markContactPromptShown();
      }, CONTACT_PROMPT_DELAY_MS);
    };
    const pauseTimer = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startTimer();
      else pauseTimer();
    };

    startTimer();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      pauseTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      mobileMenuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  useEffect(() => {
    let ticking = false;

    const updateHeader = () => {
      const currentScrollY = window.scrollY;

      if (window.innerWidth >= 1024) {
        // Do not toggle the utility row on every tiny change of scroll
        // direction. Trackpads naturally emit alternating scroll deltas,
        // which previously made both header rows jump between their heights.
        if (currentScrollY >= DESKTOP_UTILITY_HIDE_AFTER) {
          setDesktopUtilityHidden(true);
        } else if (currentScrollY <= DESKTOP_UTILITY_SHOW_BEFORE) {
          setDesktopUtilityHidden(false);
        }
      } else {
        // Keep the mobile header in the document flow. The quick catalog nav
        // is sticky below this row, so hiding the header with transform makes
        // Safari compose two different sticky layers and causes content to
        // flash through while scrolling.
        setDesktopUtilityHidden(false);
      }

      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateHeader);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateHeader);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateHeader);
    };
  }, []);

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#d9e5ef] bg-white text-[#111827] shadow-[0_4px_16px_rgba(15,53,84,0.08)]"
    >
      <div
        className={`hidden overflow-hidden border-b border-[#0a4778] bg-[#07528b] text-white transition-[max-height,opacity] duration-200 lg:block ${
          desktopUtilityHidden ? "lg:max-h-0 lg:border-b-0 lg:opacity-0" : "lg:max-h-[42px] lg:opacity-100"
        }`}
      >
        <div className="mx-auto flex min-h-[42px] max-w-[1440px] items-center justify-between gap-5 px-6 text-[12px] font-medium xl:px-8">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5"><Globe2 size={14} /> Русский <ChevronDown size={12} /></span>
            <span>Южная Корея</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={13} /> Владивосток</span>
          </div>
          <nav aria-label="Дополнительная навигация" className="flex items-center gap-4 text-white/95">
            {topLinks.map((item) => <Link key={item.label} href={item.href} className="whitespace-nowrap transition hover:text-[#f6d37a]">{item.label}</Link>)}
          </nav>
          <div className="flex items-center gap-3">
            {socialLinks.map(({ href, kind, label }) => href ? (
              <a key={label} href={href} aria-label={label} className="transition hover:text-[#f6d37a]" rel="noreferrer" target="_blank">
                <SocialIcon kind={kind} />
              </a>
            ) : (
              <span key={label} role="img" aria-label={`${label}: ссылка появится позже`} className="cursor-default opacity-80" title="Ссылка появится позже">
                <SocialIcon kind={kind} />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center justify-between gap-3 bg-white px-4 sm:min-h-[74px] sm:px-6 lg:min-h-[76px] xl:px-8">
        <Brand />

        <nav aria-label="Каталоги" className="hidden items-center gap-5 text-[14px] font-semibold text-[#171717] xl:flex 2xl:gap-7 2xl:text-[15px]">
          {catalogLinks.map((item) => item.pending ? (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-[#7d8791]" title="Раздел готовится">{item.label}<span className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[9px] uppercase tracking-wide">Скоро</span></span>
          ) : <Link key={item.label} href={item.href} className="whitespace-nowrap transition hover:text-[#07528b]">{item.label}</Link>)}
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          <a className="hidden items-center gap-2.5 xl:flex" href={`https://wa.me/${CLIENT_CONTACT.whatsappCarPhone}`} rel="noreferrer" target="_blank">
            <span className="flex size-10 items-center justify-center rounded-full bg-[#293448] text-white"><SocialIcon kind="whatsapp" size={19} /></span>
            <span className="leading-tight"><span className="block text-[16px] font-bold text-[#171717]">{clientWhatsAppPhone}</span><span className="block text-[12px] text-[#07528b]">Написать в WhatsApp</span></span>
          </a>
        </div>
        <button
          ref={mobileMenuButtonRef}
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
          className="flex size-9 items-center justify-center rounded-md border border-[#c8d7e4] bg-white text-[#293448] sm:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          type="button"
        >
          {mobileOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          aria-label="Мобильная навигация"
          className="absolute inset-x-0 top-full z-50 h-[calc(100dvh-68px)] overflow-y-auto border-t border-[#d9e5ef] bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
          id="mobile-navigation"
          role="navigation"
        >
          <div className="px-5 pb-5 pt-3">
            <p className="py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#956f2c]">Каталоги</p>
            {catalogLinks.map(({ href, icon: Icon, label, pending }) => pending ? (
              <div key={label} className="flex items-center justify-between border-b border-[#edf0f4] py-4 text-base font-semibold text-[#8a94a4]">{label}<span className="text-[10px] uppercase tracking-wide">Скоро</span></div>
            ) : <Link key={label} className="flex items-center justify-between border-b border-[#edf0f4] py-4 text-base font-semibold text-[#172033]" href={href} onClick={() => setMobileOpen(false)}>{label}<Icon size={19} className="text-[#956f2c]" /></Link>)}
          </div>

          <div className="border-t border-[#edf0f4] px-5 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b8798]">Информация</p>
            <div className="mt-2 grid grid-cols-2 gap-x-5">
              {utilityLinks.map((item) => (
                "contact" in item && item.contact ? (
                  <button
                    key={item.label}
                    className="border-b border-[#edf0f4] py-3 text-left text-sm font-medium text-[#293448]"
                    onClick={() => {
                      setMobileOpen(false);
                      openContact();
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ) : item.pending ? (
                  <div key={item.label} className="flex items-center justify-between border-b border-[#edf0f4] py-3 text-sm font-medium text-[#8a94a4]">
                    {item.label}<span className="text-[9px] font-bold uppercase text-[#a0a9b6]">Скоро</span>
                  </div>
                ) : (
                  <Link key={item.label} className="border-b border-[#edf0f4] py-3 text-sm font-medium text-[#293448]" href={item.href} onClick={() => setMobileOpen(false)}>
                    {item.label}
                  </Link>
                )
              ))}
            </div>
          </div>

        </div>
      )}
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
      <FloatingMessengerWidget />
    </header>
  );
}

function Brand() {
  return (
    <Link href="/" className="group flex shrink-0" aria-label="TL Auto — на главную">
      <TlAutoLogo className="bg-white px-1 py-0.5 transition duration-200 group-hover:border-[#07528b]/40 group-hover:shadow-[0_10px_26px_rgba(7,82,139,0.16)]" priority />
    </Link>
  );
}
