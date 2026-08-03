import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Walk Map | Last.fm validation",
  description: "Last.fm の最近の視聴履歴を検証する開発用アプリ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
