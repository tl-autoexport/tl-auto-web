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
          background: "#ed1c2b",
          color: "white",
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
        AE
        <div
          style={{
            background: "#10243e",
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
