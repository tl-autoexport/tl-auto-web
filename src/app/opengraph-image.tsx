import { ImageResponse } from "next/og";

export const alt =
  "TL Auto — каталог автомобилей из Кореи с расчётом для России";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#07111f",
          color: "white",
          display: "flex",
          height: "100%",
          overflow: "hidden",
          padding: "68px 76px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background:
              "radial-gradient(circle at center, rgba(46,211,164,0.24), rgba(7,17,31,0) 68%)",
            display: "flex",
            height: 700,
            position: "absolute",
            right: -140,
            top: -220,
            width: 700,
          }}
        />
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            height: 520,
            position: "absolute",
            right: 72,
            top: 55,
            transform: "rotate(12deg)",
            width: 340,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 870,
          }}
        >
          <div style={{ alignItems: "center", display: "flex" }}>
            <div
              style={{
                alignItems: "center",
                background: "#090c12",
                border: "2px solid #d8bd75",
                color: "#e5c97f",
                display: "flex",
                fontSize: 28,
                fontWeight: 800,
                height: 58,
                justifyContent: "center",
                letterSpacing: "-2px",
                marginRight: 18,
                width: 58,
              }}
            >
              TL
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                  textTransform: "uppercase",
                }}
              >
                TL Auto
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 14,
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                }}
              >
                Автомобили из Южной Кореи
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                  color: "#e5c97f",
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: "1px",
                marginBottom: 18,
                textTransform: "uppercase",
              }}
            >
              Каталог · расчёт · диагностика
            </div>
            <div
              style={{
                fontSize: 62,
                fontWeight: 750,
                letterSpacing: "-3px",
                lineHeight: 1.05,
                maxWidth: 850,
              }}
            >
              Автомобили из Кореи с расчётом для РФ
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.62)",
                fontSize: 24,
                lineHeight: 1.4,
                marginTop: 24,
              }}
            >
              Реальные объявления Encar в одном премиальном интерфейсе
            </div>
          </div>

          <div style={{ display: "flex", gap: 14 }}>
            {["Цена до Владивостока", "Источник Encar", "Расчёт под ключ"].map(
              (label) => (
                <div
                  key={label}
                  style={{
                    border: "1px solid rgba(255,255,255,0.16)",
                    color: "rgba(255,255,255,0.78)",
                    display: "flex",
                    fontSize: 16,
                    padding: "11px 16px",
                  }}
                >
                  {label}
                </div>
              ),
            )}
          </div>
        </div>
        <div
          style={{
            background: "#d8bd75",
            bottom: 0,
            display: "flex",
            height: 12,
            left: 0,
            position: "absolute",
            width: "42%",
          }}
        />
      </div>
    ),
    size,
  );
}
