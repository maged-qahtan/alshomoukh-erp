import test from "node:test";
import assert from "node:assert/strict";
import { validateJournalEntry } from "../../src/lib/accounting/validate-journal.ts";

const accounts = [
  { id: "cash", code: "1101", nameAr: "الصندوق", nameEn: "Cash", type: "asset", parentId: null, isPosting: true, isActive: true },
  { id: "revenue", code: "4101", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", parentId: null, isPosting: true, isActive: true },
  { id: "inactive", code: "1102", nameAr: "حساب موقوف", nameEn: "Inactive", type: "asset", parentId: null, isPosting: true, isActive: false },
  { id: "group", code: "1000", nameAr: "حساب تجميعي", nameEn: "Group", type: "asset", parentId: null, isPosting: false, isActive: true },
];

const balancedEntry = {
  entryDate: "2026-11-15",
  description: "إثبات عملية بيع نقدية",
  lines: [
    { accountId: "cash", debitMinor: 12500, creditMinor: 0 },
    { accountId: "revenue", debitMinor: 0, creditMinor: 12500 },
  ],
};

test("accepts a balanced entry using integer minor units", () => {
  const result = validateJournalEntry(balancedEntry, accounts);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.debitTotalMinor, 12500);
  assert.equal(result.creditTotalMinor, 12500);
});

test("rejects an entry when debit and credit totals differ", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "cash", debitMinor: 12500, creditMinor: 0 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 12499 },
    ],
  }, accounts);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("القيد غير متوازن")));
});

test("rejects entries with fewer than two lines", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [{ accountId: "cash", debitMinor: 100, creditMinor: 0 }],
  }, accounts);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("سطرين على الأقل")));
});

test("rejects unknown accounts", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "missing", debitMinor: 100, creditMinor: 0 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 100 },
    ],
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("الحساب غير موجود")));
});

test("rejects inactive accounts", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "inactive", debitMinor: 100, creditMinor: 0 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 100 },
    ],
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("الحساب موقوف")));
});

test("rejects posting directly to a parent account", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "group", debitMinor: 100, creditMinor: 0 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 100 },
    ],
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("حساب تجميعي")));
});

test("rejects negative, fractional, and unsafe amounts", () => {
  for (const invalidAmount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = validateJournalEntry({
      ...balancedEntry,
      lines: [
        { accountId: "cash", debitMinor: invalidAmount, creditMinor: 0 },
        { accountId: "revenue", debitMinor: 0, creditMinor: invalidAmount },
      ],
    }, accounts);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("مبلغ المدين غير صالح")));
    assert.ok(result.errors.some((error) => error.includes("مبلغ الدائن غير صالح")));
  }
});

test("rejects a line that has both debit and credit amounts", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "cash", debitMinor: 100, creditMinor: 100 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 100 },
    ],
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("في المدين أو الدائن فقط")));
});

test("rejects an invalid date and an empty description", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    entryDate: "15/11/2026",
    description: "   ",
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("تاريخ القيد غير صالح")));
  assert.ok(result.errors.some((error) => error.includes("بيان القيد مطلوب")));
});

test("rejects entries with zero debit or zero credit totals", () => {
  const result = validateJournalEntry({
    ...balancedEntry,
    lines: [
      { accountId: "cash", debitMinor: 0, creditMinor: 100 },
      { accountId: "revenue", debitMinor: 0, creditMinor: 100 },
    ],
  }, accounts);
  assert.ok(result.errors.some((error) => error.includes("أكبر من صفر")));
});
