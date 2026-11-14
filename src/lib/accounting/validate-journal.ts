import type { Account, JournalEntryInput, JournalValidationResult } from "./types";

/**
 * Amounts are represented as integer minor units (halalas for SAR).
 * This avoids floating-point rounding errors in accounting calculations.
 */
export function validateJournalEntry(
  entry: JournalEntryInput,
  accounts: Account[],
): JournalValidationResult {
  const errors: string[] = [];
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const debitTotalMinor = entry.lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const creditTotalMinor = entry.lines.reduce((sum, line) => sum + line.creditMinor, 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.entryDate)) {
    errors.push("تاريخ القيد غير صالح.");
  }
  if (!entry.description.trim()) errors.push("بيان القيد مطلوب.");
  if (entry.lines.length < 2) errors.push("يجب أن يحتوي القيد على سطرين على الأقل.");

  entry.lines.forEach((line, index) => {
    const label = `السطر ${index + 1}`;
    const account = accountMap.get(line.accountId);
    if (!account) errors.push(`${label}: الحساب غير موجود.`);
    else {
      if (!account.isActive) errors.push(`${label}: الحساب موقوف.`);
      if (!account.isPosting) errors.push(`${label}: لا يمكن الترحيل مباشرة إلى حساب تجميعي.`);
    }
    if (!Number.isSafeInteger(line.debitMinor) || line.debitMinor < 0) {
      errors.push(`${label}: مبلغ المدين غير صالح.`);
    }
    if (!Number.isSafeInteger(line.creditMinor) || line.creditMinor < 0) {
      errors.push(`${label}: مبلغ الدائن غير صالح.`);
    }
    if ((line.debitMinor > 0) === (line.creditMinor > 0)) {
      errors.push(`${label}: أدخل مبلغاً في المدين أو الدائن فقط.`);
    }
  });

  if (debitTotalMinor <= 0 || creditTotalMinor <= 0) {
    errors.push("يجب أن يحتوي القيد على إجمالي مدين وإجمالي دائن أكبر من صفر.");
  }
  if (debitTotalMinor !== creditTotalMinor) {
    errors.push("القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن.");
  }

  return { valid: errors.length === 0, errors, debitTotalMinor, creditTotalMinor };
}

export function formatSAR(minorUnits: number): string {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}
