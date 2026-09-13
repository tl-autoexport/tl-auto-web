"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Copy, Heart, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const rub = new Intl.NumberFormat("ru-RU");

type CarDetailToolbarProps = {
  brand: string | null;
  model: string | null;
  priceRub: number | null;
  title: string;
};

function catalogLink(brand?: string | null, model?: string | null) {
  const search = new URLSearchParams();
  if (brand) search.set("brand", brand);
  if (model) search.set("model", model);
  const query = search.toString();
  return query ? `/catalog?${query}` : "/catalog";
}

export function CarDetailToolbar({ brand, model, priceRub, title }: CarDetailToolbarProps) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const fallbackCatalogHref = catalogLink(brand, model);

  useEffect(() => {
    if (!shareOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!shareRef.current?.contains(event.target as Node)) setShareOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShareOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shareOpen]);

  function goBack() {
    const referrer = document.referrer;
    if (referrer.startsWith(window.location.origin) && new URL(referrer).pathname.startsWith("/catalog")) {
      router.back();
      return;
    }
    router.push(fallbackCatalogHref);
  }

  function shareUrl() {
    return window.location.href;
  }

  function openShare(service: "telegram" | "vk" | "ok") {
    const url = encodeURIComponent(shareUrl());
    const text = encodeURIComponent(title);
    const href = service === "telegram"
      ? `https://t.me/share/url?url=${url}&text=${text}`
      : service === "vk"
        ? `https://vk.com/share.php?url=${url}&title=${text}`
        : `https://connect.ok.ru/offer?url=${url}&title=${text}`;
    window.open(href, "_blank", "noopener,noreferrer");
    setShareOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access may be unavailable in an embedded browser.
    }
  }

  async function nativeShare() {
    if (!("share" in navigator)) return;
    try {
      await navigator.share({ title, text: `Автомобиль ${title} в каталоге TL Auto`, url: shareUrl() });
      setShareOpen(false);
    } catch {
      // Closing a native sharing dialog is not an application error.
    }
  }

  return (
    <section className="border-b border-[#dde3eb] bg-white">
      <div className="mx-auto max-w-7xl px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="Вернуться к выборке"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#d9e0e9] text-[#172235] transition hover:border-[#a98239] hover:bg-[#fbf7ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a98239]"
            onClick={goBack}
            type="button"
          >
            <ArrowLeft size={21} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#172235]">{title}</p>
            {priceRub ? <p className="mt-0.5 text-xs font-medium tabular-nums text-[#68758a]">{rub.format(priceRub)} ₽</p> : null}
          </div>

          <div className="relative ml-auto flex items-center gap-1.5" ref={shareRef}>
            <button
              aria-label="Добавить в избранное"
              className="hidden size-10 place-items-center rounded-xl border border-[#d9e0e9] text-[#172235] transition hover:border-[#a98239] hover:bg-[#fbf7ed] sm:grid"
              type="button"
            >
              <Heart size={20} />
            </button>
            <button
              aria-expanded={shareOpen}
              aria-haspopup="menu"
              aria-label="Поделиться автомобилем"
              className={`grid size-10 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a98239] ${shareOpen ? "border-[#a98239] bg-[#fbf7ed] text-[#8b682b]" : "border-[#d9e0e9] text-[#172235] hover:border-[#a98239] hover:bg-[#fbf7ed]"}`}
              onClick={() => setShareOpen((open) => !open)}
              type="button"
            >
              <Share2 size={20} />
            </button>

            {shareOpen ? (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-2xl border border-[#dce2ea] bg-white p-2 shadow-[0_18px_45px_rgba(16,24,39,0.18)]" role="menu">
                <p className="px-2.5 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.1em] text-[#8b682b]">Поделиться</p>
                <ShareOption label="Telegram" onClick={() => openShare("telegram")} tone="bg-[#229ed9]">↗</ShareOption>
                <ShareOption label="ВКонтакте" onClick={() => openShare("vk")} tone="bg-[#2787f5]">VK</ShareOption>
                <ShareOption label="Одноклассники" onClick={() => openShare("ok")} tone="bg-[#f58220]">OK</ShareOption>
                <ShareOption label={copied ? "Ссылка скопирована" : "Скопировать ссылку"} onClick={() => void copyLink()} tone="bg-[#e9edf3] text-[#354156]">{copied ? <Check size={16} /> : <Copy size={16} />}</ShareOption>
                {typeof navigator !== "undefined" && "share" in navigator ? <button className="mt-1 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-[#354156] transition hover:bg-[#f4f6f8]" onClick={() => void nativeShare()} role="menuitem" type="button">Ещё варианты <ChevronRight size={16} /></button> : null}
              </div>
            ) : null}
          </div>
        </div>

        <nav aria-label="Навигация по каталогу" className="scrollbar-none -mx-3 mt-3 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-3 text-sm text-[#718096] sm:mx-0 sm:px-0">
          <Link className="transition hover:text-[#8b682b]" href="/">TL Auto</Link>
          <ChevronRight size={15} />
          <Link className="transition hover:text-[#8b682b]" href="/catalog">Авто из Кореи</Link>
          {brand ? <><ChevronRight size={15} /><Link className="transition hover:text-[#8b682b]" href={catalogLink(brand)}>{brand}</Link></> : null}
          {model ? <><ChevronRight size={15} /><Link className="transition hover:text-[#8b682b]" href={catalogLink(brand, model)}>{model}</Link></> : null}
        </nav>
      </div>
    </section>
  );
}

function ShareOption({ children, label, onClick, tone }: { children: ReactNode; label: string; onClick: () => void; tone: string }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-[#354156] transition hover:bg-[#f4f6f8]" onClick={onClick} role="menuitem" type="button">
      <span className={`grid size-7 place-items-center rounded-full text-[10px] font-bold text-white ${tone}`}>{children}</span>
      {label}
    </button>
  );
}
