import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AUTO-FINANCE | النظام المالي",
  description: "نظام محاسبي احترافي لإدارة الحسابات والقيود والتقارير المالية",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
