import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Social card in the "Night shift" system: the 9:47 PM counter still from the
 * home hero, the brand line in Instrument Serif over Geist, one dawn accent. Assets live
 * in src/app/_og (private folder, not a route); paths resolve from the
 * project root as the Next.js metadata docs require.
 */

export const alt = "Loucells Core: AI agents for service businesses in South Florida. Answered. Booked. Logged.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NIGHT = "#0b0d11";
const BONE = "#eee8dd";
const BONE_2 = "#b9b2a6";
const DAWN = "#e4773a";

export default async function OG() {
  const [serif, sans, photo] = await Promise.all([
    readFile(join(process.cwd(), "src/app/_og/InstrumentSerif-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/_og/Geist-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/_og/og-dusk.jpg"), "base64"),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: NIGHT }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/jpeg;base64,${photo}`}
          alt=""
          width={1200}
          height={630}
          style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }}
        />
        {/* Left-side night wash so the type reads over the photo. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "linear-gradient(90deg, rgba(11,13,17,0.94) 0%, rgba(11,13,17,0.86) 38%, rgba(11,13,17,0.35) 64%, rgba(11,13,17,0) 82%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "56px 64px",
            fontFamily: "Geist",
            color: BONE,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, background: DAWN, display: "flex" }} />
            <span style={{ fontSize: 26, letterSpacing: 0.5 }}>Loucells Core</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <span style={{ fontSize: 22, color: BONE_2, letterSpacing: 2.5, textTransform: "uppercase" }}>
              AI agents for South Florida service businesses
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontFamily: "Instrument Serif",
                fontSize: 104,
                lineHeight: 0.98,
                letterSpacing: -1.5,
              }}
            >
              <span>Answered.</span>
              <span>Booked.</span>
              <span style={{ color: DAWN }}>Logged.</span>
            </div>
          </div>

          <span style={{ fontSize: 22, color: BONE_2 }}>loucellscore.com · English · Español</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: sans, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serif, style: "normal", weight: 400 },
      ],
    },
  );
}
