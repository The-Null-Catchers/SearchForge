import type { Metadata } from "next";
import { LocaleProvider } from "../components/locale-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "SearchForge | Self-hosted bilingual search",
  description: "A self-hosted search platform with Arabic and English analysis, BM25 ranking, safe crawling, and immutable index versions."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body><LocaleProvider>{children}</LocaleProvider></body>
    </html>
  );
}
