export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type JournalStatus = "draft" | "posted" | "reversed";

export interface Account {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  parentId: string | null;
  isPosting: boolean;
  isActive: boolean;
}

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debitMinor: number;
  creditMinor: number;
  partyId?: string | null;
  costCenterId?: string | null;
}

export interface JournalEntryInput {
  entryDate: string;
  description: string;
  reference?: string;
  currencyCode?: string;
  lines: JournalLineInput[];
}

export interface JournalValidationResult {
  valid: boolean;
  errors: string[];
  debitTotalMinor: number;
  creditTotalMinor: number;
}
