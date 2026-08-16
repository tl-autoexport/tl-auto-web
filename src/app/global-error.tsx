"use client";

import Link from "next/link";
import { useEffect } from "react";

const pageStyle = {
  minHeight: "100vh",
  margin: 0,
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "#f4f5f7",
  color: "#121722",
  fontFamily: "Arial, Helvetica, sans-serif",
} as const;

const cardStyle = {
  width: "min(100%, 680px)",
  boxSizing: "border-box",
  padding: "40px",
  border: "1px solid #d8dde6",
  borderRadius: "8px",
  background: "#ffffff",
  boxShadow: "0 18px 55px rgba(15, 23, 42, 0.1)",
} as const;

const actionStyle = {
  display: "inline-flex",
  minHeight: "48px",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  borderRadius: "6px",
  padding: "0 22px",
  fontSize: "14px",
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
} as const;

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[ui] Root rendering failed", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <html lang="ru">
      <body style={pageStyle}>
        <title>Ошибка приложения | TL Auto</title>
        <main style={cardStyle}>
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              background: "#c7a55a",
              color: "white",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            TL
          </div>
          <p
            style={{
              margin: "28px 0 0",
              color: "#956f2c",
              fontSize: 12,
              fontWeight: 800,
              textTransform: "uppercase",
            }}
          >
            TL Auto
          </p>
          <h1 style={{ margin: "10px 0 0", fontSize: 34, lineHeight: 1.18 }}>
            Сервис временно недоступен
          </h1>
          <p style={{ margin: "16px 0 0", color: "#647084", lineHeight: 1.7 }}>
            Не удалось открыть приложение. Попробуйте загрузить его ещё раз или
            вернитесь на главную страницу.
          </p>
          {error.digest ? (
            <p style={{ margin: "14px 0 0", color: "#8a96a8", fontSize: 12 }}>
              Код обращения: {error.digest}
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 30 }}>
            <button
              onClick={() => unstable_retry()}
              style={{
                ...actionStyle,
                border: 0,
                background: "#c7a55a",
                color: "white",
              }}
              type="button"
            >
              Повторить загрузку
            </button>
            <Link
              href="/"
              style={{
                ...actionStyle,
                border: "1px solid #cfd6e0",
                background: "white",
                color: "#263247",
              }}
            >
              На главную
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
