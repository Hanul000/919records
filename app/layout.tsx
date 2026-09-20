import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "919 기록물 업로드",
  description: "919 기록물 원본 업로드 페이지",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
