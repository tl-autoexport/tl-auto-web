"use client";

import { useState, type FormEvent } from "react";
import { whatsappContactUrl } from "@/lib/contact";

export function PartnerInquiryForm() {
  const [submitting, setSubmitting] = useState(false);

  function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = [
      "Здравствуйте! Хочу обсудить сотрудничество с TL Auto.",
      `Имя: ${String(data.get("name") ?? "").trim()}`,
      `Компания: ${String(data.get("company") ?? "").trim()}`,
      `Номер телефона: ${String(data.get("phone") ?? "").trim()}`,
      `E-mail: ${String(data.get("email") ?? "").trim()}`,
      `Комментарий: ${String(data.get("comment") ?? "").trim()}`,
    ].join("\n");

    setSubmitting(true);
    window.location.assign(whatsappContactUrl(message));
  }

  return (
    <section
      aria-labelledby="partner-form-title"
      className="mt-8 border-t border-[#e5e9ef] pt-7 sm:mt-10 sm:pt-9"
      id="application"
    >
      <h2 id="partner-form-title" className="text-xl font-semibold sm:text-2xl">
        Форма обратной связи:
      </h2>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submitInquiry}>
        <PartnerField autoComplete="name" label="Имя" name="name" placeholder="" />
        <PartnerField autoComplete="organization" label="Компания" name="company" placeholder="" />
        <PartnerField autoComplete="tel" label="Номер телефона" name="phone" placeholder="" type="tel" />
        <PartnerField autoComplete="email" label="E-mail" name="email" placeholder="" type="email" />
        <label className="grid gap-1.5 text-sm font-medium text-[#344054] sm:col-span-2">
          Комментарий (необязательно)
          <textarea
            className="min-h-24 w-full resize-y rounded-xl border border-[#dce2eb] bg-white px-3.5 py-3 text-base font-normal text-[#101827] outline-none transition focus:border-[#956f2c] focus:ring-2 focus:ring-[#956f2c]/15"
            name="comment"
            rows={3}
          />
        </label>

        <button
          className="mt-1 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#101827] px-5 text-sm font-semibold text-white transition hover:bg-[#202c3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7a55a] focus-visible:ring-offset-2 disabled:opacity-70 sm:col-span-2"
          disabled={submitting}
          type="submit"
        >
          Обсудить сотрудничество
        </button>
      </form>
    </section>
  );
}

function PartnerField({
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
