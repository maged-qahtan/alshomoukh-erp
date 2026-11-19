import type { Metadata } from "next";
import AutoFinanceDashboard from "../auto-finance-dashboard";

export const metadata: Metadata = {
  title: "AUTO-FINANCE | النظام المالي",
  description: "مساحة محاسبية مستقلة لإدارة القيود والحسابات المالية",
};

export default function AutoFinancePage() {
  return <AutoFinanceDashboard />;
}
