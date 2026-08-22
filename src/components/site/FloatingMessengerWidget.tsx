"use client";

import { useEffect, useRef, useState } from "react";
import { CLIENT_CONTACT, GENERAL_CLIENT_MESSAGE, telegramContactUrl, whatsappContactUrl } from "@/lib/contact";

type Messenger = "telegram" | "max" | "whatsapp";

const messengers: Array<{ key: Messenger; label: string; href: string; className: string }> = [
  { key: "telegram", label: "Telegram", href: telegramContactUrl(GENERAL_CLIENT_MESSAGE), className: "bg-[#29a9ea]" },
  { key: "max", label: "MAX", href: CLIENT_CONTACT.maxUrl, className: "bg-[linear-gradient(135deg,#5367f5,#8d37d8)]" },
  { key: "whatsapp", label: "WhatsApp", href: whatsappContactUrl(GENERAL_CLIENT_MESSAGE), className: "bg-[#42c866]" },
];

function MessengerIcon({ messenger }: { messenger: Messenger }) {
  if (messenger === "max") return <span aria-hidden="true" className="text-[12px] font-black tracking-[-0.08em]">MAX</span>;
  if (messenger === "telegram") {
    return <svg aria-hidden="true" className="size-7 fill-current" viewBox="0 0 24 24"><path d="m21.5 4.2-3.4 15.2c-.25 1.08-.88 1.35-1.79.84l-5-3.69-2.41 2.32c-.27.27-.5.5-1.03.5l.36-5.1 9.28-8.39c.4-.36-.09-.56-.63-.2L5.4 12.9.47 11.35c-1.07-.34-1.08-1.08.22-1.6l19.29-7.44c.9-.33 1.68.21 1.52 1.89Z" /></svg>;
  }
  return <svg aria-hidden="true" className="size-7 fill-current" viewBox="0 0 24 24"><path d="M20.2 11.3a8.2 8.2 0 0 1-12 7.2L4 20l1.4-4.1a8.2 8.2 0 1 1 14.8-4.6Z" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M8.7 8.2c.17-.42.35-.43.64-.43h.48c.2 0 .4.08.5.35l.6 1.4c.1.24.07.43-.1.62l-.48.57c-.14.15-.2.3-.06.52.2.36.76 1.25 1.66 1.8.92.56 1.25.72 1.63.84.2.07.35.04.48-.12l.65-.8c.16-.2.34-.18.57-.1l1.35.64c.22.1.36.16.42.27.06.1.06.65-.25 1.26-.31.61-1.13.97-1.55 1-.4.04-.92.18-2.99-.68-2.5-1.04-4.1-3.62-4.22-3.8-.12-.17-1-1.34-1-2.55 0-1.2.63-1.79.87-2.1Z" /></svg>;
}

export function FloatingMessengerWidget() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const active = messengers[activeIndex];

  useEffect(() => {
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % messengers.length), 3200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Открыть мессенджеры"
        className={`fixed bottom-[max(18px,env(safe-area-inset-bottom))] right-4 z-[70] grid size-14 place-items-center rounded-full text-white shadow-[0_8px_24px_rgba(16,24,39,0.24)] ring-4 ring-white/90 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#101827]/30 motion-reduce:transition-none sm:right-6 md:hidden ${active.className}`}
        onClick={() => setOpen(true)}
      >
        <span className="animate-[messenger-pop_600ms_ease-out] motion-reduce:animate-none"><MessengerIcon messenger={active.key} /></span>
        <span className="sr-only">Связаться через {active.label}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end bg-[#101827]/45 p-3 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden" onClick={() => setOpen(false)}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="messenger-dialog-title" tabIndex={-1} className="w-full rounded-[28px] bg-white p-5 text-[#101827] shadow-2xl outline-none animate-[contact-panel-in_260ms_cubic-bezier(0.16,1,0.3,1)_both]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#dce2eb]" aria-hidden="true" />
            <h2 id="messenger-dialog-title" className="text-xl font-semibold">Связаться с TL Auto</h2>
            <p className="mt-1 text-sm text-[#68758b]">Выберите удобный мессенджер</p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {messengers.map((messenger) => (
                <a key={messenger.key} href={messenger.href} target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-sm font-medium text-[#29354a] transition hover:bg-[#f3f5f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9b7428]" onClick={() => setOpen(false)}>
                  <span className={`grid size-14 place-items-center rounded-2xl text-white shadow-sm transition group-hover:scale-105 ${messenger.className}`}><MessengerIcon messenger={messenger.key} /></span>
                  {messenger.label}
                </a>
              ))}
            </div>
            <button type="button" className="mt-4 w-full rounded-xl border border-[#dce2eb] py-3 text-sm font-medium text-[#68758b]" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
