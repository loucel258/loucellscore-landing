import { Instrument_Serif } from "next/font/google";

// Display serif for the home redesign. Self-hosted by next/font at build
// time; the browser never calls Google.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});
