"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Calculator,
  Camera,
  CarFront,
  ChevronDown,
  Globe2,
  Menu,
  MessageCircle,
  Play,
  Send,
  X,
} from "lucide-react";
import { ContactModal } from "@/components/site/ContactModal";

const utilityLinks = [
  { label: "О сервисе", href: "/#about", pending: false },
  { label: "Калькуляторы", href: "/#how-it-works", pending: false },
  { label: "Как купить", href: "/#how-it-works", pending: false },
  { label: "Доставка", href: "/#delivery", pending: false },
  { label: "Отзывы", href: "/#reviews", pending: false },
  { label: "Контакты", href: "/#contacts", pending: false, contact: true },
] as const;

const countryLinks = [
  { label: "Авто из Кореи", href: "/catalog", active: true },
  { label: "Авто из Китая", active: false },
  { label: "Авто из Японии", active: false },
  { label: "Авто из ОАЭ", active: false },
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
      className={`sticky top-0 z-50 border-b border-[#dce2eb] bg-white/95 text-[#111927] shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl transition-transform duration-200 lg:translate-y-0 ${
        mobileHeaderHidden ? "max-lg:-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="hidden bg-[#10243e] text-white lg:block">
        <div className="mx-auto flex h-9 max-w-[1440px] items-center justify-between px-6 xl:px-8">
          <div className="flex items-center gap-2 text-[12px] font-medium text-white/78">
            <Globe2 size={14} aria-hidden="true" />
            <span>Русский</span>
            <ChevronDown size={13} aria-hidden="true" />
          </div>

          <nav aria-label="Сервисная навигация" className="flex items-center gap-6 text-[12px] font-medium text-white/76">
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

          <div className="flex items-center gap-1.5">
            <SocialIcon label="Telegram" icon={Send} onClick={openContact} />
            <SocialIcon label="YouTube" icon={Play} onClick={openContact} />
            <SocialIcon label="Instagram" icon={Camera} onClick={openContact} />
          </div>
        </div>
      </div>

      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 lg:h-[72px] lg:gap-6 lg:px-5 xl:px-8">
        <Brand />

        <nav aria-label="Основная навигация" className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex">
          {countryLinks.map((item) => (
            item.active ? (
              <Link
                key={item.label}
                className={`relative px-4 py-6 text-sm font-semibold transition hover:text-[#e51d2a] ${pathname.startsWith("/catalog") || pathname.startsWith("/cars/") ? "text-[#e51d2a]" : "text-[#263247]"}`}
                href={item.href}
              >
                {item.label}
                {(pathname.startsWith("/catalog") || pathname.startsWith("/cars/")) && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-[#e51d2a]" />}
              </Link>
            ) : (
              <span key={item.label} className="flex cursor-default items-center gap-2 px-4 py-6 text-sm font-semibold text-[#68758a]" title="Каталог в процессе наполнения">
                {item.label}
                <span className="rounded-sm bg-[#eef1f5] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#8792a3]">Скоро</span>
              </span>
            )
          ))}
          <Link className="px-4 py-6 text-sm font-semibold text-[#263247] transition hover:text-[#e51d2a]" href="/catalog">
            В наличии
          </Link>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <button
            className="flex size-10 items-center justify-center text-[#10243e] transition hover:text-[#e51d2a]"
            onClick={openContact}
            title="Связаться с нами"
            type="button"
          >
            <MessageCircle size={20} aria-hidden="true" />
            <span className="sr-only">Связаться с нами</span>
          </button>
          <Link className="inline-flex h-11 items-center gap-2 rounded-md bg-[#10243e] px-5 text-sm font-semibold text-white transition hover:bg-[#1d3553]" href="/catalog">
            <Calculator size={17} aria-hidden="true" />
            Подобрать авто
          </Link>
        </div>

        <button
          ref={mobileMenuButtonRef}
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
          className="flex size-11 items-center justify-center rounded-md border border-[#d7dee8] bg-white text-[#10243e] lg:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          type="button"
        >
          {mobileOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          aria-label="Мобильная навигация"
          className="absolute inset-x-0 top-full z-50 h-[calc(100dvh-64px)] overflow-y-auto border-t border-[#dce2eb] bg-[#f4f6f9] pb-[env(safe-area-inset-bottom)] lg:hidden"
          id="mobile-navigation"
          role="navigation"
        >
          <div className="border-t border-[#dce2eb] bg-white px-5 pb-5 pt-3">
            <p className="py-3 text-[11px] font-semibold uppercase text-[#8a96a8]">Каталоги автомобилей</p>
            <Link className="flex items-center justify-between border-b border-[#edf0f4] py-4 text-base font-semibold text-[#e51d2a]" href="/catalog" onClick={() => setMobileOpen(false)}>
              Авто из Кореи <CarFront size={19} />
            </Link>
            {countryLinks.filter((item) => !item.active).map((item) => (
              <div key={item.label} className="flex items-center justify-between border-b border-[#edf0f4] py-4 text-base font-semibold text-[#68758a]">
                {item.label}
                <span className="rounded-sm bg-[#eef1f5] px-2 py-1 text-[10px] font-bold uppercase text-[#8792a3]">Скоро</span>
              </div>
            ))}
            <Link className="flex items-center justify-between py-4 text-base font-semibold text-[#263247]" href="/catalog" onClick={() => setMobileOpen(false)}>
              Авто в наличии <CarFront size={19} />
            </Link>
          </div>

          <div className="mt-2 bg-white px-5 py-5">
            <p className="text-[11px] font-semibold uppercase text-[#8a96a8]">Информация</p>
            <div className="mt-2 grid grid-cols-2 gap-x-5">
              {utilityLinks.map((item) => (
                "contact" in item && item.contact ? (
                  <button
                    key={item.label}
                    className="border-b border-[#edf0f4] py-3 text-left text-sm font-medium text-[#263247]"
                    onClick={() => {
                      setMobileOpen(false);
                      openContact();
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ) : item.pending ? (
                  <div key={item.label} className="flex items-center justify-between border-b border-[#edf0f4] py-3 text-sm font-medium text-[#68758a]">
                    {item.label}<span className="text-[9px] font-bold uppercase text-[#a0a9b6]">Скоро</span>
                  </div>
                ) : (
                  <Link key={item.label} className="border-b border-[#edf0f4] py-3 text-sm font-medium text-[#263247]" href={item.href} onClick={() => setMobileOpen(false)}>
                    {item.label}
                  </Link>
                )
              ))}
            </div>
          </div>

          <div className="mt-2 bg-[#10243e] px-5 py-6 text-white">
            <p className="text-xs font-medium text-white/65">Подбор автомобиля из Кореи</p>
            <p className="mt-1 text-lg font-semibold">Получите расчёт до Владивостока</p>
            <Link className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#ed1c2b] px-5 text-sm font-semibold" href="/catalog" onClick={() => setMobileOpen(false)}>
              <Calculator size={17} /> Подобрать авто
            </Link>
          </div>
        </div>
      )}
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </header>
  );
}

function Brand() {
  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2.5 lg:gap-3">
      <span className="relative flex size-9 items-center justify-center overflow-hidden bg-[#ed1c2b] text-white lg:size-10" aria-hidden="true">
        <CarFront className="size-5 lg:size-[22px]" strokeWidth={2.1} />
        <span className="absolute bottom-0 right-0 size-2 bg-[#10243e]" />
      </span>
      <span>
        <strong className="block text-[15px] font-bold uppercase text-[#111927] lg:text-[16px]">TL Auto</strong>
        <small className="block pt-0.5 text-[9px] font-semibold uppercase text-[#5f6c80] lg:text-[10px]">Авто из Кореи</small>
      </span>
    </Link>
  );
}

function SocialIcon({ icon: Icon, label, onClick }: { icon: typeof Send; label: string; onClick: () => void }) {
  return (
    <button className="flex size-7 items-center justify-center text-white/70 transition hover:text-white" onClick={onClick} title={`${label} — открыть варианты связи`} type="button">
      <Icon size={15} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </button>
  );
}
