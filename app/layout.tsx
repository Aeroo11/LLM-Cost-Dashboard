import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// The stylesheet has always referenced --font-geist-sans/--font-geist-mono;
// nothing ever defined them. An undefined var with no fallback makes the whole
// font-family declaration invalid at computed-value time, so `html` fell back to
// the browser default — a serif — and `font-mono` did nothing at all.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const DESCRIPTION =
  "Monitoring dashboard for LLM cost, usage, and optimization opportunities in production.";

export const metadata: Metadata = {
  // Required, or Next warns at build and emits a relative og:image URL that no
  // crawler can resolve.
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
  ),
  title: {
    default: "TokenWatch — LLM Cost Intelligence",
    template: "%s · TokenWatch",
  },
  description: DESCRIPTION,
  applicationName: "TokenWatch",
  openGraph: {
    type: "website",
    siteName: "TokenWatch",
    locale: "en_US",
    title: "TokenWatch — LLM Cost Intelligence",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};

// themeColor and colorScheme belong here, not in `metadata` — they moved in
// Next 15 and silently do nothing if left behind.
export const viewport: Viewport = {
  themeColor: "#f4f6fa",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
