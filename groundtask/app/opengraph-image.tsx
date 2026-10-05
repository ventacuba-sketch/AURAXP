import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const symbol = await readFile(join(process.cwd(), "public/brand/groundtask-symbol.png"));
  const src = `data:image/png;base64,${symbol.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0b1620 0%, #070e15 60%, #1e2a36 100%)",
          color: "#f8f5ee",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={src} width={68} height={60} alt="" />
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>GroundTask</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Real-world workflows.</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: "#f2994a" }}>
            Verifiable AI tasks.
          </div>
          <div style={{ marginTop: 28, fontSize: 28, color: "#94a3b8", maxWidth: 900 }}>
            Expert-verified training and evaluation assets from real business workflows in Chile/LatAm.
          </div>
        </div>
        <div style={{ fontSize: 24, color: "#94a3b8" }}>{site.domain}</div>
      </div>
    ),
    size,
  );
}
