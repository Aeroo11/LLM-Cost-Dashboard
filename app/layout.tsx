import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "TokenWatch — LLM Cost Intelligence",
  description:
    "Monitoring dashboard for LLM cost, usage, and optimization opportunities in production.",
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
