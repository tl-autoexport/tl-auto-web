"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CarFront,
  ChevronDown,
  Globe2,
  Menu,
  MessageCircle,
  ShipWheel,
  Bike,
  X,
} from "lucide-react";
import { ContactModal } from "@/components/site/ContactModal";
import { TlAutoLogo } from "@/components/brand/TlAutoLogo";

const utilityLinks = [
  { label: "О сервисе", href: "/#about", pending: false },
  { label: "Калькуляторы", href: "/#how-it-works", pending: false },
  { label: "Как купить", href: "/#how-it-works", pending: false },
  { label: "Доставка", href: "/#delivery", pending: false },
  { label: "Отзывы", href: "/#reviews", pending: false },
  { label: "Контакты", href: "/#contacts", pending: false, contact: true },
] as const;

const catalogLinks = [
  { label: "Автомобили", href: "/catalog", icon: CarFront },
  { label: "Мототехника", href: "/catalog?category=motorcycle", icon: Bike },
  { label: "Гидроциклы", href: "/catalog?category=jetski", icon: ShipWheel },
] as const;

const CONTACT_PROMPT_SESSION_KEY = "tl-auto-contact-prompt-v1-shown";
const CONTACT_PROMPT_DELAY_MS = 45_000;

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

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
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
    let lastScrollY = window.scrollY;
    let ticking = false;

    const updateHeader = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY;
      const movedEnough = Math.abs(currentScrollY - lastScrollY) > 6;

      if (window.innerWidth < 1024 && !mobileOpen && movedEnough) {
        setMobileHeaderHidden(scrollingDown && currentScrollY > 96);
      } else if (window.innerWidth >= 1024 || currentScrollY <= 24) {
        setMobileHeaderHidden(false);
      }

      lastScrollY = currentScrollY;
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
  }, [mobileOpen]);

  return (
    <header
      className={`sticky top-0 z-50 border-b border-[#c9a24e]/20 bg-[#090c12]/95 text-white shadow-[0_14px_38px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-transform duration-200 lg:translate-y-0 ${
        mobileHeaderHidden ? "max-lg:-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:h-[60px] sm:px-6 xl:px-8">
        <div className="flex shrink-0 items-center gap-3 sm:gap-5">
          <Brand />
          <div className="hidden items-center gap-1.5 border-l border-white/10 pl-4 text-[12px] font-medium text-white/68 sm:flex">
            <Globe2 size={14} aria-hidden="true" />
            <span>Русский</span>
            <ChevronDown size={13} aria-hidden="true" />
          </div>
        </div>

        <nav aria-label="Сервисная навигация" className="hidden items-center gap-5 text-[12px] font-medium text-white/72 xl:flex">
            {utilityLinks.map((item) => (
              "contact" in item && item.contact ? (
                <button key={item.label} className="transition hover:text-white" onClick={openContact} type="button">
                  {item.label}
                </button>
              ) : item.pending ? (
                <span key={item.label} className="cursor-default transition hover:text-white" title="Раздел готовится">
                  {item.label}
                </span>
              ) : (
                <Link key={item.label} className="transition hover:text-white" href={item.href}>
                  {item.label}
                </Link>
              )
            ))}
        </nav>

        <div className="hidden items-center gap-1 sm:flex">
          <button
            className="flex size-9 items-center justify-center text-white/75 transition hover:text-[#f1d58d]"
            onClick={openContact}
            title="Связаться с нами"
            type="button"
          >
            <MessageCircle size={19} aria-hidden="true" />
            <span className="sr-only">Связаться с нами</span>
          </button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#c9a24e] px-4 text-[13px] font-semibold text-[#15130f] transition hover:bg-[#e5c979]" onClick={openContact} type="button">
            Оставить заявку
          </button>
        </div>
        <button
          ref={mobileMenuButtonRef}
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
          className="flex size-9 items-center justify-center rounded-md border border-white/18 bg-white/5 text-white sm:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          type="button"
        >
          {mobileOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          aria-label="Мобильная навигация"
          className="absolute inset-x-0 top-full z-50 h-[calc(100dvh-56px)] overflow-y-auto border-t border-white/10 bg-[#090c12] pb-[env(safe-area-inset-bottom)] sm:hidden"
          id="mobile-navigation"
          role="navigation"
        >
          <div className="border-t border-white/10 px-5 pb-5 pt-3">
            <p className="py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e5c979]">Каталоги TL Auto</p>
            {catalogLinks.map(({ href, icon: Icon, label }) => (
              <Link key={label} className="flex items-center justify-between border-b border-white/10 py-4 text-base font-semibold text-white" href={href} onClick={() => setMobileOpen(false)}>
                {label} <Icon size={19} className="text-[#e5c979]" />
              </Link>
            ))}
          </div>

          <div className="border-t border-white/10 px-5 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Информация</p>
            <div className="mt-2 grid grid-cols-2 gap-x-5">
              {utilityLinks.map((item) => (
                "contact" in item && item.contact ? (
                  <button
                    key={item.label}
                    className="border-b border-white/10 py-3 text-left text-sm font-medium text-white/80"
                    onClick={() => {
                      setMobileOpen(false);
                      openContact();
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ) : item.pending ? (
                  <div key={item.label} className="flex items-center justify-between border-b border-white/10 py-3 text-sm font-medium text-white/50">
                    {item.label}<span className="text-[9px] font-bold uppercase text-[#a0a9b6]">Скоро</span>
                  </div>
                ) : (
                  <Link key={item.label} className="border-b border-white/10 py-3 text-sm font-medium text-white/80" href={item.href} onClick={() => setMobileOpen(false)}>
                    {item.label}
                  </Link>
                )
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 bg-[#111821] px-5 py-6 text-white">
            <p className="text-xs font-medium text-white/65">Автомобили, мотоциклы и гидроциклы</p>
            <p className="mt-1 text-lg font-semibold">Оставьте заявку на подбор</p>
            <button className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#c9a24e] px-5 text-sm font-semibold text-[#15130f]" onClick={() => { setMobileOpen(false); openContact(); }} type="button">
              <MessageCircle size={17} /> Оставить заявку
            </button>
          </div>
        </div>
      )}
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </header>
  );
}

function Brand() {
  return (
    <Link href="/" className="group flex shrink-0" aria-label="TL Auto — на главную">
      <TlAutoLogo className="px-1 py-0.5 transition duration-200 group-hover:border-[#d8bd75]/70 group-hover:shadow-[0_12px_34px_rgba(0,0,0,0.36)]" priority />
    </Link>
  );
}
