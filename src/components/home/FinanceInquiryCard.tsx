"use client";

import Image from "next/image";
import { useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogAccessibility } from "@/components/site/useDialogAccessibility";
import { whatsappContactUrl } from "@/lib/contact";

export function FinanceInquiryCard() {
  const [open, setOpen] = useState(false);
  const [whatsAppUrl, setWhatsAppUrl] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: () => setOpen(false),
    open,
  });

  function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = [
      "Здравствуйте! Хочу узнать об автомобиле в кредит.",
      `ФИО: ${String(data.get("name") ?? "").trim()}`,
      `Телефон: ${String(data.get("phone") ?? "").trim()}`,
      `E-mail: ${String(data.get("email") ?? "").trim()}`,
      `Интересующий автомобиль: ${String(data.get("vehicle") ?? "").trim()}`,
      `Желаемая сумма кредита: ${String(data.get("amount") ?? "").trim()}`,
    ].join("\n");
    setWhatsAppUrl(whatsappContactUrl(message));
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="group relative aspect-[0.78] w-[166px] shrink-0 snap-start overflow-hidden rounded-[24px] bg-[#edf0f4] text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7a55a] sm:w-[200px] sm:rounded-[30px] lg:w-[230px]"
        onClick={() => {
          setWhatsAppUrl("");
          setOpen(true);
        }}
        type="button"
      >
        <Image
          alt=""
          className="object-cover object-center transition duration-500 group-hover:scale-105"
          fill
          sizes="(min-width: 1024px) 230px, (min-width: 640px) 200px, 166px"
          src="/assets/stories/financing.webp"
        />
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <span className="absolute inset-x-3 bottom-3 max-w-[calc(100%-24px)] break-words text-[13px] font-bold leading-tight text-white drop-shadow-sm sm:inset-x-4 sm:bottom-4 sm:max-w-none sm:text-lg">Кредитование</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-end justify-center bg-[#07111f]/65 p-0 backdrop-blur-sm sm:items-center sm:p-5"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <section
                ref={dialogRef}
                aria-describedby={descriptionId}
                aria-labelledby={titleId}
                aria-modal="true"
                className="relative max-h-[94dvh] w-full overflow-y-auto rounded-t-[24px] bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7 shadow-[0_30px_90px_rgba(2,8,23,0.38)] sm:max-w-[560px] sm:rounded-[24px] sm:p-8"
                role="dialog"
                tabIndex={-1}
              >
                <button
                  ref={closeButtonRef}
                  aria-label="Закрыть форму"
                  className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-[#dce2eb] text-[#465368] transition hover:bg-[#f5f6f8] sm:right-6 sm:top-6"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <X size={19} />
                </button>

                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#956f2c]">Автомобиль в кредит</p>
                <h2 id={titleId} className="mt-2 pr-10 text-2xl font-semibold leading-tight text-[#101827] sm:text-[28px]">Подберём финансирование</h2>
                <p id={descriptionId} className="mt-3 max-w-[460px] text-sm leading-6 text-[#647084]">
                  Оставьте контакты и расскажите, какой автомобиль ищете. Менеджер свяжется с вами, обсудит условия и объяснит дальнейшие шаги.
                </p>

                <form className="mt-6 grid gap-4" onSubmit={submitInquiry}>
                  <FormField autoComplete="name" label="ФИО" name="name" placeholder="Как к вам обращаться" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField autoComplete="tel" label="Номер телефона" name="phone" placeholder="+7" type="tel" />
                    <FormField autoComplete="email" label="E-mail" name="email" placeholder="name@example.com" type="email" />
                  </div>
                  <FormField label="Какой автомобиль интересует?" name="vehicle" placeholder="Марка и модель или ссылка на объявление" />
                  <FormField label="Какая сумма нужна в кредит?" name="amount" placeholder="Например, 1 500 000 ₽" />

                  {whatsAppUrl ? (
                    <div className="mt-1 rounded-2xl border border-[#cde9d8] bg-[#f1faf4] p-4">
                      <p className="text-sm font-semibold text-[#185b36]">Заявка подготовлена</p>
                      <p className="mt-1 text-xs leading-5 text-[#52705e]">Нажмите ниже, чтобы открыть WhatsApp и отправить её менеджеру.</p>
                      <a
                        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#207a45] px-5 text-sm font-semibold text-white transition hover:bg-[#176136]"
                        href={whatsAppUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Перейти в WhatsApp
                      </a>
                    </div>
                  ) : (
                    <button className="mt-1 min-h-12 rounded-xl bg-[#101827] px-5 text-sm font-semibold text-white transition hover:bg-[#202c3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7a55a] focus-visible:ring-offset-2" type="submit">
                      Оставить заявку
                    </button>
                  )}
                </form>
                <p className="mt-4 text-[11px] leading-5 text-[#8792a2]">Нажимая «Оставить заявку», вы подготовите сообщение в WhatsApp. Оно будет отправлено только после подтверждения в WhatsApp.</p>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function FormField({
  autoComplete,
  label,
  name,
  placeholder,
  type = "text",
}: {
  autoComplete?: string;
  label: string;
  name: string;
  placeholder: string;
  type?: "email" | "tel" | "text";
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-[#344054]">
      {label}
      <input
        autoComplete={autoComplete}
        className="min-h-12 w-full rounded-xl border border-[#dce2eb] bg-white px-3.5 text-base font-normal text-[#101827] outline-none transition placeholder:text-[#9aa4b2] focus:border-[#956f2c] focus:ring-2 focus:ring-[#956f2c]/15"
        name={name}
        placeholder={placeholder}
        required
        type={type}
      />
    </label>
  );
}
