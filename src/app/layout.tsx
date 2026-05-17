import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "习惯之镜",
  description: "记录并审计每日习惯",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
