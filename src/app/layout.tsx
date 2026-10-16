import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "住宅ローン診断ツール | 住まいの資金計画",
  description: "住宅展示場での相談に使える、住宅ローン返済額のかんたん診断ツールです。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
