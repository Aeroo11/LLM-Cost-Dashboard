import { ImageResponse } from "next/og";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { MODELS } from "@/lib/models";

export const alt = "TokenWatch — LLM Cost Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Generated at build time rather than committed, so no binary lives in git.
 *
 * Deliberately passes no custom `fonts`: Satori ships no system fonts, so
 * naming Geist here would silently fall back, and fetching a TTF during the
 * build is a CI failure waiting to happen. The layout and the palette carry
 * the brand instead of the typeface.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f4f6fa",
          padding: 72,
          color: "#17243c",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                background: "#3053c4",
                display: "flex",
              }}
            />
            <div style={{ fontSize: 26, color: "#3053c4", letterSpacing: 2 }}>
              TOKENWATCH
            </div>
          </div>
          <div style={{ fontSize: 82, fontWeight: 700, marginTop: 28, lineHeight: 1.05 }}>
            LLM Cost Intelligence
          </div>
          <div style={{ fontSize: 32, color: "#4f607a", marginTop: 24, maxWidth: 900 }}>
            Live cost, usage and optimisation opportunities over a DuckDB
            analytics store — with anomaly detection and a what-if simulator.
          </div>
        </div>

        {/* The four series colours, so the card carries the same identity the
            charts do. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", gap: 28 }}>
            {MODEL_ORDER.map((m) => (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: MODEL_COLORS[m],
                    display: "flex",
                  }}
                />
                <div style={{ fontSize: 24, color: "#4f607a" }}>{MODELS[m].label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 24, color: "#5b6d88", display: "flex" }}>
            Next.js · DuckDB · Server-Sent Events
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
