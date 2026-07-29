import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon.
 *
 * Generated rather than committed, for the same reason as the OG card — no
 * binary in git — and it keeps the mark in one place: change app/icon.svg and
 * this should change with it.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#13151c",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path
            d="M5 23 L11 17 L16 20 L27 8"
            fill="none"
            stroke="#6366f1"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="27" cy="8" r="3.2" fill="#6366f1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
