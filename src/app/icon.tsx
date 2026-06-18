import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0F172A",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            background:
              "radial-gradient(circle at 30% 30%, #06B6D4 0%, #8B5CF6 55%, #7C3AED 100%)",
            boxShadow: "0 0 16px 2px rgba(6, 182, 212, 0.45)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
