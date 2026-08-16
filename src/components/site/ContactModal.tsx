"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  MessageCircle,
  MessagesSquare,
  Send,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  DEVELOPER_CONTACT,
  telegramContactUrl,
  whatsappContactUrl,
} from "@/lib/contact";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";

type ContactModalProps = {
  open: boolean;
  onClose: () => void;
};

const channels = [
  {
    label: "Telegram",
    detail: `@${DEVELOPER_CONTACT.telegramUsername}`,
    href: telegramContactUrl(),
    icon: Send,
    tone: "bg-[#229ed9]",
  },
  {
    label: "WhatsApp",
    detail: DEVELOPER_CONTACT.whatsappLabel,
    href: whatsappContactUrl(),
    icon: MessageCircle,
    tone: "bg-[#25a766]",
  },
  {
    label: "MAX",
    detail: "Аккаунта пока нет",
    href: null,
    icon: MessagesSquare,
    tone: "bg-[#5267df]",
  },
];

export function ContactModal({ onClose, open }: ContactModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrHost, setQrHost] = useState("");

  useEffect(() => {
    if (!open) return;

    const targetUrl = new URL("/", window.location.origin).toString();
    const currentHost = window.location.host;

    QRCode.toDataURL(targetUrl, {
      color: {
        dark: "#07111fff",
        light: "#ffffffff",
      },
      errorCorrectionLevel: "H",
      margin: 2,
      width: 420,
    })
      .then((dataUrl) => {
        setQrDataUrl(dataUrl);
        setQrHost(currentHost);
      })
      .catch(() => setQrDataUrl(""));
  }, [open]);

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    open,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="contact-modal__backdrop fixed inset-0 z-[100] flex items-end justify-center bg-[#07111f]/78 p-0 backdrop-blur-md sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="contact-modal__panel relative max-h-[94dvh] w-full overflow-y-auto rounded-t-lg bg-white shadow-[0_30px_90px_rgba(2,8,23,0.38)] sm:max-w-[880px] sm:rounded-lg"
        role="dialog"
      >
        <button
          ref={closeButtonRef}
          aria-label="Закрыть окно"
          className="absolute right-4 top-4 z-20 flex size-10 items-center justify-center rounded-md border border-[#dce2eb] bg-white text-[#263247] transition hover:border-[#9ba8ba] hover:bg-[#f5f7fa] sm:right-5 sm:top-5"
          onClick={onClose}
          type="button"
        >
          <X size={20} />
        </button>

        <div className="grid sm:min-h-[570px] sm:grid-cols-[0.88fr_1.12fr]">
          <div className="relative order-2 flex flex-col justify-between overflow-hidden bg-[#0b1728] px-6 pb-7 pt-8 text-white sm:order-1 sm:px-8 sm:pb-8 sm:pt-9">
            <div aria-hidden="true" className="contact-modal__grid absolute inset-0 opacity-35" />
            <div className="relative">
              <p className="text-[11px] font-bold uppercase text-[#73dfc0]">TL Auto</p>
              <h3 className="mt-2 max-w-[270px] text-xl font-semibold leading-tight">Откройте демо с телефона</h3>
              <p className="mt-2 max-w-[300px] text-sm leading-6 text-white/62">
                QR-код ведёт на текущую версию проекта и автоматически обновится после публикации домена.
              </p>
            </div>

            <div className="relative mx-auto mt-6 w-full max-w-[286px] sm:mt-8">
              <div className="contact-modal__qr-shell relative bg-white p-3 shadow-[0_18px_46px_rgba(0,0,0,0.24)]">
                {qrDataUrl ? (
                  <Image
                    alt="QR-код для открытия TL Auto"
                    className="h-auto w-full"
                    height={420}
                    src={qrDataUrl}
                    unoptimized
                    width={420}
                  />
                ) : (
                  <div className="aspect-square animate-pulse bg-[#eef1f5]" />
                )}
              </div>
              <p className="mt-4 text-center text-xs font-semibold text-white/88">Наведите камеру телефона</p>
              <p className="mt-1 truncate text-center text-[11px] text-white/45">{qrHost || "Сайт TL Auto"}</p>
            </div>

            <div className="relative mt-6 flex items-center justify-center gap-2 text-[11px] text-white/52">
              <Check size={14} className="text-[#73dfc0]" />
              Сканируемый QR без внешнего сервиса
            </div>
          </div>

          <div className="order-1 flex flex-col justify-center px-6 pb-8 pt-16 sm:order-2 sm:px-9 sm:pb-9 sm:pt-12">
            <p className="text-[11px] font-bold uppercase text-[#e51d2a]">Связь с разработчиком</p>
            <h2 id={titleId} className="mt-2 max-w-[390px] text-[28px] font-semibold leading-[1.15] text-[#101827] sm:text-[34px]">
              Хотите такой инструмент для своего автобизнеса?
            </h2>
            <p id={descriptionId} className="mt-4 max-w-[410px] text-sm leading-6 text-[#647084]">
              Оставьте сообщение удобным способом, чтобы получить консультацию по автомобилю, расчёту и доставке.
            </p>

            <div className="mt-7 grid gap-3">
              {channels.map(({ detail, href, icon: Icon, label, tone }) =>
                href ? (
                  <a
                    key={label}
                    className="group flex min-h-[62px] items-center overflow-hidden rounded-md border border-[#dce2eb] bg-white pr-4 text-left shadow-[0_1px_0_rgba(15,23,42,0.02)] transition hover:-translate-y-0.5 hover:border-[#b9c3d1] hover:shadow-md"
                    href={href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <span className={`flex min-h-[62px] w-[62px] items-center justify-center self-stretch text-white ${tone}`}>
                      <Icon size={21} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1 px-4">
                      <span className="block text-[15px] font-semibold text-[#1e293b]">{label}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#758196]">{detail}</span>
                    </span>
                    <ArrowUpRight className="text-[#99a4b4] transition group-hover:text-[#e51d2a]" size={18} />
                  </a>
                ) : (
                  <div
                    key={label}
                    aria-disabled="true"
                    className="flex min-h-[62px] cursor-not-allowed items-center overflow-hidden rounded-md border border-[#e2e6ec] bg-[#f8f9fb] pr-4 text-left opacity-70"
                  >
                    <span className={`flex min-h-[62px] w-[62px] items-center justify-center self-stretch text-white ${tone}`}>
                      <Icon size={21} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1 px-4">
                      <span className="block text-[15px] font-semibold text-[#1e293b]">{label}</span>
                      <span className="mt-0.5 block text-xs text-[#758196]">{detail}</span>
                    </span>
                    <span className="rounded-sm bg-[#e9edf2] px-2 py-1 text-[9px] font-bold uppercase text-[#7f8998]">Позже</span>
                  </div>
                ),
              )}
            </div>

            <div className="mt-6 border-l-2 border-[#e51d2a] bg-[#fff6f6] px-4 py-3">
              <p className="text-xs font-semibold text-[#263247]">Прямой контакт без посредников</p>
              <p className="mt-1 text-xs leading-5 text-[#69768a]">
                Сейчас обращения поступают лично разработчику проекта. Для дилерской версии контакты и сценарий заявки можно заменить на каналы заказчика.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
