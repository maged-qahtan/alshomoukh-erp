import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "نظام الشموخ ERP",
  description: "نظام محاسبي متكامل لإدارة الحسابات والعمليات المالية",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
