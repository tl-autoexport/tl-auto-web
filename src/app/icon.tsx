import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#090c12",
          border: "2px solid #d8bd75",
          color: "#e5c97f",
          display: "flex",
          fontSize: 25,
          fontWeight: 800,
          height: "100%",
          justifyContent: "center",
          letterSpacing: "-2px",
          position: "relative",
          width: "100%",
        }}
      >
        TL
        <div
          style={{
            background: "#d8bd75",
            bottom: 0,
            display: "flex",
            height: 14,
            position: "absolute",
            right: 0,
            width: 14,
          }}
        />
      </div>
    ),
    size,
  );
}
