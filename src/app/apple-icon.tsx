import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0F172A",
          borderRadius: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 999,
            background:
              "radial-gradient(circle at 30% 30%, #06B6D4 0%, #8B5CF6 55%, #7C3AED 100%)",
            boxShadow: "0 0 50px 4px rgba(6, 182, 212, 0.45)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
