import { ImageResponse } from "next/og";

export const alt = "Loucells Core — AI Architecture Built to Scale Your Business";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0F172A",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Aurora glow blobs */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -140,
            width: 540,
            height: 540,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(6,182,212,0.35) 0%, rgba(6,182,212,0) 65%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -160,
            width: 580,
            height: 580,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(139,92,246,0.30) 0%, rgba(139,92,246,0) 65%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 60,
            right: 80,
            width: 320,
            height: 320,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(124,58,237,0.20) 0%, rgba(124,58,237,0) 65%)",
          }}
        />

        {/* Top row — logo + eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background:
                "radial-gradient(circle at 30% 30%, #06B6D4 0%, #8B5CF6 55%, #7C3AED 100%)",
              boxShadow: "0 0 24px 4px rgba(6,182,212,0.4)",
            }}
          />
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#F8FAFC",
              letterSpacing: -0.5,
            }}
          >
            Loucells Core
          </span>
        </div>

        {/* Main message */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            zIndex: 10,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontFamily: "ui-monospace, monospace",
              color: "#06B6D4",
              textTransform: "uppercase",
              letterSpacing: 4,
            }}
          >
            // Automation Studio · EN / ES
          </span>
          <div
            style={{
              fontSize: 70,
              fontWeight: 600,
              color: "#F8FAFC",
              letterSpacing: -2.5,
              lineHeight: 1.02,
              maxWidth: 980,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>AI Architecture</span>
            <span>Built to Scale</span>
            <span style={{ color: "#06B6D4" }}>Your Business.</span>
          </div>
          <span
            style={{
              fontSize: 22,
              color: "rgba(248,250,252,0.6)",
              maxWidth: 800,
            }}
          >
            Specialized AI agents and the conversion infrastructure that
            feeds them. Bilingual EN/ES. Built on Anthropic Claude.
          </span>
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            zIndex: 10,
            color: "rgba(248,250,252,0.5)",
            fontSize: 16,
            fontFamily: "ui-monospace, monospace",
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          <span>loucellscore.com</span>
          <span>Built on Anthropic Claude</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
