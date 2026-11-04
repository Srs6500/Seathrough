import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

export const alt = `${SITE_NAME} – ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/SeeThrough_logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

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
          background: "#faf8f3",
          backgroundImage: "radial-gradient(#d9d4c7 1.5px, transparent 1.5px)",
          backgroundSize: "28px 28px",
          color: "#16161a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={logoSrc} width={72} height={72} style={{ borderRadius: 16 }} alt="" />
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {SITE_NAME}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              maxWidth: 980,
            }}
          >
            The AI tutor that draws while it explains.
          </div>
          <div style={{ fontSize: 32, color: "#5b5b63", maxWidth: 960 }}>
            Ask anything by voice. Watch diagrams, physics figures and system maps appear as
            you learn.
          </div>
        </div>
        <div style={{ fontSize: 26, color: "#2f5bd3" }}>seethroughus.com</div>
      </div>
    ),
    { ...size },
  );
}
