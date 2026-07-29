import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokenWatch — LLM Cost Intelligence",
  description:
    "Monitoring dashboard for LLM cost, usage, and optimization opportunities in production.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
