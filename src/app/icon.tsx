import { ImageResponse } from "next/og";
import { brandMarkDataUri } from "@/lib/brand-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={64} height={64} src={brandMarkDataUri()} alt="" />
      </div>
    ),
    { ...size },
  );
}
