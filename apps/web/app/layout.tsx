import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "오토농장", description: "위탁판매 한 바퀴 자동화" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
