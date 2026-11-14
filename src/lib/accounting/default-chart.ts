import type { Account } from "./types";

/** Starter chart of accounts. Review and adapt it before production use. */
export const defaultChartOfAccounts: Account[] = [
  { id: "1000", code: "1", nameAr: "الأصول", nameEn: "Assets", type: "asset", parentId: null, isPosting: false, isActive: true },
  { id: "1100", code: "11", nameAr: "الأصول المتداولة", nameEn: "Current assets", type: "asset", parentId: "1000", isPosting: false, isActive: true },
  { id: "1110", code: "1101", nameAr: "الصندوق", nameEn: "Cash", type: "asset", parentId: "1100", isPosting: true, isActive: true },
  { id: "1120", code: "1102", nameAr: "البنك", nameEn: "Bank", type: "asset", parentId: "1100", isPosting: true, isActive: true },
  { id: "1130", code: "1103", nameAr: "العملاء", nameEn: "Accounts receivable", type: "asset", parentId: "1100", isPosting: true, isActive: true },
  { id: "1200", code: "12", nameAr: "المخزون", nameEn: "Inventory", type: "asset", parentId: "1000", isPosting: true, isActive: true },
  { id: "2000", code: "2", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", parentId: null, isPosting: false, isActive: true },
  { id: "2100", code: "21", nameAr: "الموردون", nameEn: "Accounts payable", type: "liability", parentId: "2000", isPosting: true, isActive: true },
  { id: "2200", code: "22", nameAr: "ضريبة القيمة المضافة المستحقة", nameEn: "VAT payable", type: "liability", parentId: "2000", isPosting: true, isActive: true },
  { id: "3000", code: "3", nameAr: "حقوق الملكية", nameEn: "Equity", type: "equity", parentId: null, isPosting: false, isActive: true },
  { id: "3100", code: "31", nameAr: "رأس المال", nameEn: "Share capital", type: "equity", parentId: "3000", isPosting: true, isActive: true },
  { id: "4000", code: "4", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", parentId: null, isPosting: false, isActive: true },
  { id: "4100", code: "41", nameAr: "إيرادات المبيعات", nameEn: "Sales revenue", type: "revenue", parentId: "4000", isPosting: true, isActive: true },
  { id: "5000", code: "5", nameAr: "المصروفات", nameEn: "Expenses", type: "expense", parentId: null, isPosting: false, isActive: true },
  { id: "5100", code: "51", nameAr: "مصروفات التشغيل", nameEn: "Operating expenses", type: "expense", parentId: "5000", isPosting: true, isActive: true },
];
