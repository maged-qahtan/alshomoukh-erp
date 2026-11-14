"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatSAR } from "@/lib/accounting/validate-journal";
import Operations from "./operations";

type Account = { id: string; code: string; name_ar: string; type: string; is_posting: boolean; is_active: boolean };
type Line = { account_id: string; debit: string; credit: string; description: string; party_id?: string | null; cost_center_id?: string | null };
type Entry = { id: string; entry_number: number; entry_date: string; description: string; status: string; source_type?: string };

const navItems = ["لوحة التحكم", "القيود اليومية", "دليل الحسابات", "العملاء والموردون", "مراكز التكلفة", "الأستاذ العام", "ميزان المراجعة", "قائمة الدخل", "العمليات", "الميزانية العمومية", "التدفقات النقدية", "ملخص الضريبة"];
const today = new Date().toISOString().slice(0, 10);
const csvCell = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}


export default function Dashboard() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabase = useMemo(() => configured ? createClient() : null, [configured]);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Array<{id:string;display_name:string;legal_name:string}>>([]);
  const [companyName, setCompanyName] = useState("الشركة");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [fiscalStart, setFiscalStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [fiscalEnd, setFiscalEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [yearEndPreview, setYearEndPreview] = useState<any>(null);
  const [retainedEarningsAccountId, setRetainedEarningsAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [generalLedger, setGeneralLedger] = useState<any[]>([]);
  const [incomeAccounts, setIncomeAccounts] = useState<any[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<any[]>([]);
  const [cashFlow, setCashFlow] = useState<any[]>([]);
  const [vatSummary, setVatSummary] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [centerCode, setCenterCode] = useState("");
  const [centerName, setCenterName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyType, setPartyType] = useState("customer");
  const [partyPhone, setPartyPhone] = useState("");
  const [partyTax, setPartyTax] = useState("");
  const [active, setActive] = useState("لوحة التحكم");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalStatus, setJournalStatus] = useState("all");
  const [journalFrom, setJournalFrom] = useState("");
  const [journalTo, setJournalTo] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [isOpeningBalance, setIsOpeningBalance] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) { setUser(data.user); setAuthLoading(false); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setNotice("");
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [supabase]);

  const refreshWorkspace = useCallback(async () => {
    if (!supabase || !user) return;
    setLoadingData(true);
    setNotice("");
    const { data: appId, error: appError } = await supabase.rpc("current_app_user_id");
    if (appError) { setNotice(appError.message); setLoadingData(false); return; }
    if (!appId) { setAppUserId(null); setCompanyId(null); setLoadingData(false); return; }
    setAppUserId(appId);
    const { data: memberships, error: membershipError } = await supabase
      .from("company_users").select("company_id").eq("user_id", appId).eq("is_active", true);
    if (membershipError) { setNotice(membershipError.message); setLoadingData(false); return; }
    const companyIds = (memberships ?? []).map((m: any) => m.company_id as string);
    if (!companyIds.length) { setCompanies([]); setCompanyId(null); setLoadingData(false); return; }
    const { data: availableCompanies, error: companiesError } = await supabase
      .from("companies").select("id,display_name,legal_name").in("id", companyIds).order("display_name");
    if (companiesError) { setNotice(companiesError.message); setLoadingData(false); return; }
    const companyList = (availableCompanies ?? []) as Array<{id:string;display_name:string;legal_name:string}>;
    setCompanies(companyList);
    const cid = companyList.some((company) => company.id === companyId) ? companyId! : companyList[0].id;
    setCompanyId(cid);
    const [companyResult, accountResult, periodResult, entryResult, balanceResult, ledgerResult, incomeResult, partyResult, centerResult, sheetResult, cashFlowResult, vatResult] = await Promise.all([
      supabase.from("companies").select("display_name,legal_name").eq("id", cid).single(),
      supabase.from("accounts").select("id,code,name_ar,type,is_posting,is_active").eq("company_id", cid).eq("is_active", true).order("code"),
      supabase.from("fiscal_periods").select("id,name,starts_on,ends_on,status").eq("company_id", cid).eq("status", "open").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("journal_entries").select("id,entry_number,entry_date,description,status,source_type").eq("company_id", cid).order("entry_date", { ascending: false }).limit(30),
      supabase.from("trial_balance").select("*").eq("company_id", cid).order("account_code"),
      supabase.from("general_ledger").select("*").eq("company_id", cid).order("entry_date", { ascending: false }).limit(500),
      supabase.from("income_statement_accounts").select("*").eq("company_id", cid).order("account_code"),
      supabase.from("parties").select("id,code,name,party_type,phone,tax_number,is_active").eq("company_id", cid).order("name"),
      supabase.from("cost_centers").select("id,code,name_ar,is_active").eq("company_id", cid).order("code"),
      supabase.from("balance_sheet_accounts").select("*").eq("company_id", cid).order("account_code"),
      supabase.from("cash_flow_summary").select("*").eq("company_id", cid).order("code"),
      supabase.from("vat_summary").select("*").eq("company_id", cid).order("source_type"),
    ]);
    if (companyResult.data) setCompanyName(companyResult.data.display_name || companyResult.data.legal_name);
    if (accountResult.error) setNotice(accountResult.error.message); else setAccounts((accountResult.data ?? []) as Account[]);
    if (periodResult.error) setNotice(periodResult.error.message); else setPeriodId(periodResult.data?.id ?? null);
    if (entryResult.error) setNotice(entryResult.error.message); else setEntries((entryResult.data ?? []) as Entry[]);
    if (balanceResult.error) setNotice(balanceResult.error.message); else setTrialBalance(balanceResult.data ?? []);
    if (ledgerResult.error) setNotice(ledgerResult.error.message); else setGeneralLedger(ledgerResult.data ?? []);
    if (incomeResult.error) setNotice(incomeResult.error.message); else setIncomeAccounts(incomeResult.data ?? []);
    if (partyResult.error) setNotice(partyResult.error.message); else setParties(partyResult.data ?? []);
    if (centerResult.error) setNotice(centerResult.error.message); else setCostCenters(centerResult.data ?? []);
    if (sheetResult.error) setNotice(sheetResult.error.message); else setBalanceSheet(sheetResult.data ?? []);
    if (cashFlowResult.error) setNotice(cashFlowResult.error.message); else setCashFlow(cashFlowResult.data ?? []);
    if (vatResult.error) setNotice(vatResult.error.message); else setVatSummary(vatResult.data ?? []);
    setLoadingData(false);
  }, [supabase, user, companyId]);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);

  useEffect(() => {
    const posting = accounts.filter((a) => a.is_posting);
    if (posting.length >= 2 && lines.length === 0) {
      const cash = posting.find((a) => a.code === "1101") ?? posting[0];
      const revenue = posting.find((a) => a.type === "revenue") ?? posting[1];
      setLines([
        { account_id: cash.id, debit: "0", credit: "0", description: "" },
        { account_id: revenue.id, debit: "0", credit: "0", description: "" },
      ]);
    }
  }, [accounts, lines.length]);

  const totals = useMemo(() => lines.reduce((sum, line) => ({
    debit: sum.debit + Math.round((Number(line.debit) || 0) * 100),
    credit: sum.credit + Math.round((Number(line.credit) || 0) * 100),
  }), { debit: 0, credit: 0 }), [lines]);
  const balanced = totals.debit > 0 && totals.debit === totals.credit;
  const filteredLedger = generalLedger.filter((row:any) => (!reportFrom || row.entry_date >= reportFrom) && (!reportTo || row.entry_date <= reportTo));
  const filteredEntries = entries.filter((entry) => {
    const term = journalSearch.trim().toLowerCase();
    return (!term || String(entry.entry_number).includes(term) || entry.description.toLowerCase().includes(term))
      && (journalStatus === "all" || entry.status === journalStatus)
      && (!journalFrom || entry.entry_date >= journalFrom)
      && (!journalTo || entry.entry_date <= journalTo);
  });

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setNotice("");
    const result = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (result.error) { setNotice(result.error.message); return; }
    if (authMode === "signup" && !result.data.session) {
      setNotice("تم إنشاء الحساب. افتح بريدك الإلكتروني لتأكيد الحساب، ثم ارجع وسجّل الدخول.");
    } else if (result.data.user) {
      setUser(result.data.user);
      setNotice("تم تسجيل الدخول بنجاح.");
    }
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("bootstrap_company", {
      p_legal_name: companyLegalName.trim(),
      p_display_name: companyLegalName.trim(),
      p_fiscal_year_start: fiscalStart,
      p_fiscal_year_end: fiscalEnd,
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setCompanyId(data);
    await refreshWorkspace();
  }

  function updateLine(index: number, field: keyof Line, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [field]: value };
      // A journal line must carry an amount on one side only.
      if (field === "debit" && Number(value) > 0) next.credit = "0";
      if (field === "credit" && Number(value) > 0) next.debit = "0";
      return next;
    }));
  }

  async function openJournalEntry(entryId: string, edit = false) {
    if (!supabase || !companyId) return;
    setBusy(true); setNotice("");
    const { data: header, error: headerError } = await supabase.from("journal_entries")
      .select("id,entry_number,entry_date,description,status,reference,created_at,posted_at")
      .eq("id", entryId).eq("company_id", companyId).single();
    if (headerError || !header) { setBusy(false); setNotice(headerError?.message || "تعذر تحميل القيد."); return; }
    const { data: detailLines, error: linesError } = await supabase.from("journal_lines")
      .select("id,line_number,account_id,description,debit,credit,party_id,cost_center_id")
      .eq("journal_entry_id", entryId).eq("company_id", companyId).order("line_number");
    setBusy(false);
    if (linesError) { setNotice(linesError.message); return; }
    setSelectedEntry({ ...header, lines: detailLines ?? [] });
    if (edit) {
      if (header.status !== "draft") { setNotice("لا يمكن تعديل قيد مرحّل أو معكوس."); return; }
      setEditingEntryId(entryId);
      setEntryDate(header.entry_date);
      setDescription(header.description);
      setLines((detailLines ?? []).map((line:any) => ({
        account_id: line.account_id, debit: String(line.debit), credit: String(line.credit),
        description: line.description ?? "",
        party_id: line.party_id ?? null,
        cost_center_id: line.cost_center_id ?? null,
      })));
      setShowForm(true);
      setSelectedEntry(null);
    }
  }

  function resetJournalForm() {
    setShowForm(false); setEditingEntryId(null); setIsOpeningBalance(false); setDescription(""); setEntryDate(today); setLines([]);
  }

  async function saveJournal() {
    if (!supabase || !companyId || !periodId || !appUserId) {
      setNotice("لا توجد شركة أو فترة مالية مفتوحة. أكمل إعداد الشركة أولاً."); return;
    }
    if ((!isOpeningBalance && !description.trim()) || lines.length < 2 || !balanced) {
      setNotice("أدخل بيان القيد وسطرين على الأقل، وتأكد من تساوي المدين والدائن."); return;
    }
    const parsed = lines.map((line) => ({
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      description: line.description,
      party_id: line.party_id ?? null,
      cost_center_id: line.cost_center_id ?? null,
    }));
    if (parsed.some((line) => !line.account_id || line.debit < 0 || line.credit < 0 || (line.debit > 0) === (line.credit > 0))) {
      setNotice("راجع الحسابات والمبالغ: يجب إدخال مبلغ في جهة واحدة فقط لكل سطر."); return;
    }
    setBusy(true); setNotice("");
    const result = isOpeningBalance
      ? await supabase.rpc("save_opening_balance_draft", { p_company_id: companyId, p_fiscal_period_id: periodId, p_lines: parsed })
      : editingEntryId
        ? await supabase.rpc("update_draft_journal_entry", { p_entry_id: editingEntryId, p_entry_date: entryDate, p_description: description.trim(), p_lines: parsed })
        : await supabase.rpc("save_draft_journal_entry", { p_company_id: companyId, p_fiscal_period_id: periodId, p_entry_date: entryDate, p_description: description.trim(), p_lines: parsed });
    if (result.error) { setBusy(false); setNotice(result.error.message); return; }
    setBusy(false);
    setNotice(isOpeningBalance ? "تم إنشاء مسودة الأرصدة الافتتاحية. راجعها ثم رحّلها." : editingEntryId ? "تم تحديث المسودة بنجاح." : "تم حفظ القيد كمسودة بنجاح.");
    resetJournalForm();
    await refreshWorkspace();
  }

  async function addParty(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !companyId) return;
    if (!partyCode.trim() || !partyName.trim()) { setNotice("رمز واسم العميل أو المورد مطلوبان."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.from("parties").insert({
      company_id: companyId, code: partyCode.trim(), name: partyName.trim(),
      party_type: partyType, phone: partyPhone.trim() || null, tax_number: partyTax.trim() || null,
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setPartyCode(""); setPartyName(""); setPartyPhone(""); setPartyTax("");
    setNotice("تم حفظ بيانات الطرف بنجاح.");
    await refreshWorkspace();
  }

  async function addCostCenter(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !companyId) return;
    if (!centerCode.trim() || !centerName.trim()) { setNotice("رمز واسم مركز التكلفة مطلوبان."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.from("cost_centers").insert({
      company_id: companyId, code: centerCode.trim(), name_ar: centerName.trim(), name_en: centerName.trim(),
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setCenterCode(""); setCenterName("");
    setNotice("تم حفظ مركز التكلفة بنجاح.");
    await refreshWorkspace();
  }

  async function postJournal(entryId: string) {
    if (!supabase || !appUserId) return;
    setBusy(true); setNotice("");
    const { error } = await supabase.rpc("post_journal_entry", { p_entry_id: entryId, p_user_id: appUserId });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setNotice("تم ترحيل القيد بنجاح.");
    await refreshWorkspace();
  }

  async function reverseJournal(entryId: string) {
    if (!supabase || !appUserId || !periodId) return;
    if (!window.confirm("سيتم إنشاء قيد عكسي مرتبط بالقيد الأصلي. هل تريد المتابعة؟")) return;
    setBusy(true); setNotice("");
    const { error } = await supabase.rpc("reverse_journal_entry", {
      p_entry_id: entryId,
      p_reversal_date: today,
      p_fiscal_period_id: periodId,
      p_user_id: appUserId,
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setNotice("تم إنشاء القيد العكسي بنجاح.");
    await refreshWorkspace();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null); setCompanyId(null); setAppUserId(null);
  }

  if (!configured) return <div className="auth-screen"><section className="auth-card"><h1>نظام الشموخ ERP</h1><h2>يلزم ربط قاعدة البيانات</h2><p>أضف متغيري البيئة في إعدادات Vercel ثم أعد النشر:</p><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></section></div>;
  if (authLoading) return <div className="auth-screen"><section className="auth-card">جارٍ التحقق من جلسة الدخول…</section></div>;
  if (!user) return <div className="auth-screen"><form className="auth-card" onSubmit={handleAuth}>
    <div className="brand-mark">ش</div><h1>الشموخ ERP</h1><h2>{authMode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h2>
    {authMode === "signup" && <label>الاسم الكامل<input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>}
    <label>البريد الإلكتروني<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>كلمة المرور<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {notice && <p className="notice">{notice}</p>}
    <button className="primary-btn" disabled={busy}>{busy ? "يرجى الانتظار…" : authMode === "login" ? "دخول" : "إنشاء الحساب"}</button>
    <button type="button" className="text-btn" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setNotice(""); }}>{authMode === "login" ? "ليس لديك حساب؟ أنشئ حساباً" : "لديك حساب؟ سجّل الدخول"}</button>
  </form></div>;
  if (!companyId && !loadingData) return <div className="auth-screen"><form className="auth-card" onSubmit={createCompany}>
    <div className="brand-mark">ش</div><h1>إعداد شركة الشموخ</h1><p>أدخل الاسم القانوني وبيانات السنة المالية لتهيئة الشركة ودليل الحسابات تلقائياً.</p>
    <label>اسم الشركة<input required value={companyLegalName} onChange={(e) => setCompanyLegalName(e.target.value)} placeholder="مثال: صيدلية الشموخ" /></label>
    <label>بداية السنة المالية<input required type="date" value={fiscalStart} onChange={(e) => setFiscalStart(e.target.value)} /></label>
    <label>نهاية السنة المالية<input required type="date" value={fiscalEnd} onChange={(e) => setFiscalEnd(e.target.value)} /></label>
    {notice && <p className="notice">{notice}</p>}
    <button className="primary-btn" disabled={busy || fiscalEnd < fiscalStart}>{busy ? "جارٍ إعداد الشركة…" : "إنشاء الشركة ودليل الحسابات"}</button>
    <button type="button" className="text-btn" onClick={signOut}>تسجيل الخروج</button>
  </form></div>;

  return <div className="app-shell">
    {mobileMenuOpen && <button type="button" aria-label="إغلاق القائمة" className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />}
    <aside className={mobileMenuOpen ? "sidebar sidebar-open" : "sidebar"}>
      <button type="button" className="mobile-sidebar-close" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)}>×</button>
      <div className="brand"><span className="brand-mark">ش</span><div><b>الشموخ ERP</b><small>النظام المحاسبي</small></div></div>
      <div className="company-switch"><small>الشركة الحالية</small>{companies.length > 1 ? <select aria-label="اختيار الشركة" value={companyId ?? ""} onChange={(e) => { setCompanyId(e.target.value); setActive("لوحة التحكم"); setNotice(""); setLines([]); setShowForm(false); }}><option value="" disabled>اختر الشركة</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.display_name || company.legal_name}</option>)}</select> : <strong>{companyName}</strong>}</div>
      <div className="nav-caption">القائمة الرئيسية</div>
      <nav>{navItems.map((item, index) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => { setActive(item); setMobileMenuOpen(false); }}><span>{["▦", "⇄", "☷", "♙", "⌖", "▤", "⚖", "↗", "▣", "▤", "↕", "%"][index]}</span>{item}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> متصل بقاعدة البيانات</div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-title"><button type="button" className="menu-toggle" aria-label="فتح القائمة" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}>☰</button><div><span className="breadcrumb">{companyName || "الشركة"}</span><span className="crumb-sep">/</span><b>{active}</b></div></div><div className="top-actions"><span className="currency-pill">SAR · ريال سعودي</span><span className="user-chip">{user?.email || "المستخدم"}</span><button className="text-btn logout-btn" onClick={signOut}>تسجيل الخروج</button></div></header>
      <div className="page-content">
        <section className="welcome-row"><div><div className="eyebrow">نظام الشموخ المحاسبي</div><h1>{active}</h1><p>إدارة دقيقة للحسابات والعمليات المالية من مكان واحد.</p></div>{active === "القيود اليومية" && <button className="primary-btn" onClick={() => setShowForm(true)}>＋ قيد يومي جديد</button>}</section>
        {notice && <p className="notice">{notice}</p>}
        {active === "العمليات" && <Operations supabase={supabase!} companyId={companyId!} appUserId={appUserId} />}
        {active === "الميزانية العمومية" && <section className="panel"><h2>الميزانية العمومية — أرصدة الحسابات</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>التصنيف</th><th>الرصيد</th></tr></thead><tbody>{balanceSheet.map((r) => <tr key={r.account_id}><td>{r.account_code}</td><td>{r.account_name}</td><td>{r.account_type === "asset" ? "أصول" : r.account_type === "liability" ? "التزامات" : "حقوق ملكية"}</td><td>{formatSAR(Math.round(Number(r.balance) * 100))}</td></tr>)}</tbody></table></div></section>}
        {active === "التدفقات النقدية" && <section className="panel"><h2>ملخص الصناديق والبنوك</h2><div className="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد الافتتاحي</th><th>المقبوضات</th><th>المدفوعات</th><th>الرصيد الختامي</th></tr></thead><tbody>{cashFlow.map((r) => <tr key={r.cash_account_id}><td>{r.code} — {r.name_ar}</td><td>{r.account_type === "cash" ? "صندوق" : "بنك"}</td><td>{formatSAR(Math.round(Number(r.opening_balance) * 100))}</td><td>{formatSAR(Math.round(Number(r.receipts) * 100))}</td><td>{formatSAR(Math.round(Number(r.payments) * 100))}</td><td>{formatSAR(Math.round(Number(r.closing_balance) * 100))}</td></tr>)}</tbody></table></div><p className="notice">يعرض هذا الملخص حركات الصندوق والبنوك المرحلة فقط، وليس قائمة التدفقات النقدية المحاسبية الكاملة.</p></section>}
        {active === "ملخص الضريبة" && <section className="panel"><h2>ملخص ضريبة القيمة المضافة</h2><div className="table-wrap"><table><thead><tr><th>المصدر</th><th>عدد الفواتير المرحلة</th><th>الإجمالي شامل الضريبة</th><th>الضريبة</th></tr></thead><tbody>{vatSummary.map((r,i) => <tr key={i}><td>{r.source_type === "sales" ? "المبيعات" : "المشتريات"}</td><td>{r.document_count}</td><td>{formatSAR(Math.round(Number(r.gross_amount) * 100))}</td><td>{formatSAR(Math.round(Number(r.vat_amount) * 100))}</td></tr>)}</tbody></table></div><p className="notice">هذا ملخص داخلي مبني على الفواتير المرحلة، ولا يمثل إقراراً ضريبياً أو اعتماداً من هيئة الزكاة والضريبة والجمارك.</p></section>}
        {loadingData && <p>جارٍ تحميل بيانات الشركة…</p>}
        {active === "لوحة التحكم" && (() => {
          const debitTotal = trialBalance.reduce((sum:any,row:any)=>sum+Number(row.debit_total||0),0);
          const creditTotal = trialBalance.reduce((sum:any,row:any)=>sum+Number(row.credit_total||0),0);
          const revenueTotal = incomeAccounts.filter((row:any)=>row.account_type==="revenue").reduce((sum:number,row:any)=>sum+Number(row.period_amount||0),0);
          const expenseTotal = incomeAccounts.filter((row:any)=>row.account_type==="expense").reduce((sum:number,row:any)=>sum+Number(row.period_amount||0),0);
          const netResult = revenueTotal-expenseTotal;
          const postedCount = entries.filter((entry)=>entry.status==="posted").length;
          const draftCount = entries.filter((entry)=>entry.status==="draft").length;
          const reversedCount = entries.filter((entry)=>entry.status==="reversed").length;
          const maxMovement = Math.max(revenueTotal,expenseTotal,1);
          const balancedLedger = Math.round(debitTotal*100)===Math.round(creditTotal*100);
          return <div className="dashboard-home">
            <section className="dashboard-welcome">
              <div><span className="dashboard-eyebrow">لوحة القيادة المالية</span><h1>مرحباً بك في {companyName}</h1><p>نظرة سريعة على الوضع المحاسبي وأهم المهام التي تحتاج انتباهك.</p></div>
              <button className="primary-btn dashboard-create" onClick={()=>{setActive("القيود اليومية");setShowForm(true);}}>＋ إنشاء قيد يومي</button>
            </section>
            <section className="dashboard-kpis">
              <article className="dashboard-kpi"><div className="kpi-top"><span>إجمالي المدين</span><i className="kpi-icon green">↙</i></div><strong>{formatSAR(Math.round(debitTotal*100))}</strong><small>من القيود المرحلة والمعكوسة</small></article>
              <article className="dashboard-kpi"><div className="kpi-top"><span>إجمالي الدائن</span><i className="kpi-icon blue">↗</i></div><strong>{formatSAR(Math.round(creditTotal*100))}</strong><small>من القيود المرحلة والمعكوسة</small></article>
              <article className="dashboard-kpi"><div className="kpi-top"><span>نتيجة النشاط</span><i className={netResult>=0?"kpi-icon green":"kpi-icon red"}>◈</i></div><strong className={netResult<0?"negative-value":""}>{formatSAR(Math.round(netResult*100))}</strong><small>الإيرادات ناقص المصروفات المسجلة</small></article>
              <article className="dashboard-kpi"><div className="kpi-top"><span>الحسابات النشطة</span><i className="kpi-icon gold">▤</i></div><strong>{accounts.length.toLocaleString("ar")}</strong><small>حساباً في دليل الحسابات</small></article>
            </section>
            <section className="dashboard-main-grid">
              <article className="panel dashboard-activity">
                <div className="panel-heading"><div><h2>آخر القيود اليومية</h2><p>تابع أحدث الحركات المسجلة في الشركة</p></div><button className="text-btn" onClick={()=>setActive("القيود اليومية")}>دفتر القيود ←</button></div>
                {entries.length ? <div className="table-wrap"><table><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحالة</th></tr></thead><tbody>{entries.slice(0,7).map((e)=><tr key={e.id}><td><b>#{e.entry_number}</b></td><td>{e.entry_date}</td><td>{e.description}</td><td><span className={`entry-status ${e.status}`}>{e.status==="posted"?"مرحّل":e.status==="reversed"?"معكوس":"مسودة"}</span></td></tr>)}</tbody></table></div>:<div className="empty-state"><b>لا توجد قيود حتى الآن</b><p>ابدأ بتسجيل أول عملية مالية لتظهر هنا.</p><button className="primary-btn" onClick={()=>{setActive("القيود اليومية");setShowForm(true);}}>إنشاء أول قيد</button></div>}
              </article>
              <article className="panel dashboard-status">
                <div className="panel-heading"><div><h2>حالة دفتر اليومية</h2><p>ضمن آخر {entries.length} قيد محمّل</p></div></div>
                <div className="journal-status-total"><strong>{entries.length.toLocaleString("ar")}</strong><span>قيداً</span></div>
                <div className="status-track"><span className="posted-segment" style={{width:`${entries.length?postedCount/entries.length*100:0}%`}}/><span className="draft-segment" style={{width:`${entries.length?draftCount/entries.length*100:0}%`}}/><span className="reversed-segment" style={{width:`${entries.length?reversedCount/entries.length*100:0}%`}}/></div>
                <div className="status-legend"><div><i className="posted-dot"/>مرحّلة <b>{postedCount}</b></div><div><i className="draft-dot"/>مسودات <b>{draftCount}</b></div><div><i className="reversed-dot"/>معكوسة <b>{reversedCount}</b></div></div>
                <div className={`ledger-check ${balancedLedger?"is-balanced":"is-unbalanced"}`}><span>{balancedLedger?"✓":"!"}</span><div><b>{balancedLedger?"ميزان المراجعة متوازن":"يوجد فرق في ميزان المراجعة"}</b><small>{balancedLedger?"إجمالي المدين يساوي إجمالي الدائن":"راجع أرصدة الحسابات قبل اعتماد التقارير"}</small></div></div>
              </article>
            </section>
            <section className="dashboard-bottom-grid">
              <article className="panel dashboard-performance"><div className="panel-heading"><div><h2>الإيرادات والمصروفات</h2><p>إجمالي الحسابات المسجلة في قائمة الدخل</p></div><button className="text-btn" onClick={()=>setActive("قائمة الدخل")}>عرض التقرير ←</button></div>
                <div className="movement-row"><div><span>الإيرادات</span><b>{formatSAR(Math.round(revenueTotal*100))}</b></div><div className="movement-bar"><i className="revenue-bar" style={{width:`${revenueTotal>0?Math.max(2,revenueTotal/maxMovement*100):0}%`}}/></div></div>
                <div className="movement-row"><div><span>المصروفات</span><b>{formatSAR(Math.round(expenseTotal*100))}</b></div><div className="movement-bar"><i className="expense-bar" style={{width:`${expenseTotal>0?Math.max(2,expenseTotal/maxMovement*100):0}%`}}/></div></div>
                <div className="net-result-row"><span>صافي النتيجة</span><strong className={netResult<0?"negative-value":""}>{formatSAR(Math.round(netResult*100))}</strong></div>
              </article>
              <article className="panel dashboard-shortcuts"><div className="panel-heading"><div><h2>الوصول السريع</h2><p>المهام المحاسبية الأكثر استخداماً</p></div></div>
                <button onClick={()=>{setActive("القيود اليومية");setShowForm(true);}}><i>＋</i><span><b>قيد يومي جديد</b><small>تسجيل عملية مالية</small></span><em>←</em></button>
                <button onClick={()=>setActive("ميزان المراجعة")}><i>≋</i><span><b>ميزان المراجعة</b><small>مراجعة توازن الحسابات</small></span><em>←</em></button>
                <button onClick={()=>setActive("الأستاذ العام")}><i>☷</i><span><b>الأستاذ العام</b><small>تتبع حركة كل حساب</small></span><em>←</em></button>
                <button onClick={()=>setActive("دليل الحسابات")}><i>▤</i><span><b>دليل الحسابات</b><small>إدارة الحسابات وتصنيفاتها</small></span><em>←</em></button>
              </article>
            </section>
            <p className="dashboard-footnote">الأرصدة أعلاه مبنية على بيانات القيود والتقارير المتاحة للمستخدم الحالي. حالة دفتر اليومية تعرض أحدث القيود المحمّلة فقط.</p>
          </div>;
        })()}
        {active === "القيود اليومية" && <section className="panel">
          <>{yearEndPreview && <section className="panel"><div className="panel-heading"><div><h3>مراجعة نتيجة السنة المالية — {yearEndPreview.period?.name}</h3><p>تقرير مراجعة فقط؛ لا ينشئ قيود إقفال أو أرصدة افتتاحية.</p></div><button className="secondary-btn" onClick={()=>setYearEndPreview(null)}>إغلاق</button></div><div className="stats-grid"><div className="stat-card"><span>الإيرادات</span><strong>{formatSAR(Math.round(Number(yearEndPreview.revenue_total||0)*100))}</strong></div><div className="stat-card"><span>المصروفات</span><strong>{formatSAR(Math.round(Number(yearEndPreview.expense_total||0)*100))}</strong></div><div className="stat-card"><span>صافي الربح / الخسارة</span><strong>{formatSAR(Math.round(Number(yearEndPreview.net_income||0)*100))}</strong></div></div><h4>حسابات الأرباح والخسائر</h4><div className="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد</th></tr></thead><tbody>{(yearEndPreview.income_accounts||[]).map((x:any)=><tr key={x.account_id}><td>{x.code} — {x.name}</td><td>{x.type==="revenue"?"إيرادات":"مصروفات"}</td><td>{formatSAR(Math.round(Number(x.balance)*100))}</td></tr>)}</tbody></table></div><h4>الأرصدة التي تنتقل إلى السنة التالية</h4><div className="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد</th></tr></thead><tbody>{(yearEndPreview.balance_sheet_accounts||[]).map((x:any)=><tr key={x.account_id}><td>{x.code} — {x.name}</td><td>{x.type}</td><td>{formatSAR(Math.round(Number(x.balance)*100))}</td></tr>)}</tbody></table></div><p>عدد القيود المرحلة: {yearEndPreview.posted_entry_count}</p></section>}</><div className="panel-heading"><div><h2>دفتر القيود اليومية</h2><p>المسودات والقيود المرحلة</p></div><button className="secondary-btn" disabled={busy || !companyId} onClick={async () => { if (!supabase || !companyId) return; setBusy(true); setYearEndPreview(null); const { data: closedPeriod, error: periodError } = await supabase.from("fiscal_periods").select("id,name,ends_on").eq("company_id",companyId).eq("status","closed").order("ends_on",{ascending:false}).limit(1).maybeSingle(); if (periodError || !closedPeriod) { setNotice(periodError?.message || "لا توجد فترة مالية مغلقة لهذه الشركة."); setBusy(false); return; } const { data, error } = await supabase.rpc("get_fiscal_year_close_preview",{p_fiscal_period_id:closedPeriod.id}); if (error) setNotice(error.message); else setYearEndPreview(data); setBusy(false); }}>معاينة إقفال السنة</button><label className="inline-field">حساب الأرباح المحتجزة<select value={retainedEarningsAccountId} onChange={(e)=>setRetainedEarningsAccountId(e.target.value)}><option value="">اختر حساب حقوق ملكية</option>{accounts.filter((a)=>a.type==="equity" && a.is_active && a.is_posting).map((a)=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></label><button className="secondary-btn" disabled={busy || !companyId || !retainedEarningsAccountId} onClick={async()=>{if(!supabase || !companyId || !retainedEarningsAccountId || !window.confirm("سيتم إنشاء الفترة المالية التالية ومسودة قيد أرصدة افتتاحية بناءً على أرصدة الفترة المغلقة. لن يتم ترحيل القيد تلقائياً. هل تريد المتابعة؟")) return; setBusy(true); const {data:previous,error:periodError}=await supabase.from("fiscal_periods").select("id").eq("company_id",companyId).eq("status","closed").order("ends_on",{ascending:false}).limit(1).maybeSingle(); if(periodError || !previous){setNotice(periodError?.message || "لا توجد فترة مالية مغلقة.");setBusy(false);return;} const {data,error}=await supabase.rpc("create_next_fiscal_year_opening_draft",{p_closed_period_id:previous.id,p_retained_earnings_account_id:retainedEarningsAccountId}); if(error){setNotice(error.message);} else {setNotice("تم إنشاء السنة المالية التالية ومسودة الأرصدة الافتتاحية. راجع القيد ثم رحّله بعد التأكد.");await refreshWorkspace();} setBusy(false);}}>إنشاء السنة التالية ومسودة افتتاحية</button><div className="report-actions"><button className="secondary-btn" disabled={busy || entries.some((e)=>e.source_type==="opening_balance" && e.status!=="reversed")} onClick={()=>{resetJournalForm();setIsOpeningBalance(true);setDescription("الأرصدة الافتتاحية");setEntryDate(today);setLines([]);setShowForm(true);}}>إدخال الأرصدة الافتتاحية</button><button className="secondary-btn" disabled={busy || !periodId || showForm} onClick={async () => { if (!supabase || !periodId || !window.confirm("سيتم إغلاق الفترة المالية الحالية نهائياً ومنع ترحيل قيود جديدة فيها. هل تريد المتابعة؟")) return; setBusy(true); const { error } = await supabase.rpc("close_fiscal_period", { p_fiscal_period_id: periodId }); if (error) setNotice(error.message); else { setNotice("تم إغلاق الفترة المالية بنجاح. لن يمكن ترحيل قيود جديدة فيها."); await refreshWorkspace(); } setBusy(false); }}>إقفال الفترة المالية</button><button className="primary-btn" onClick={() => { if (showForm) resetJournalForm(); else { setEditingEntryId(null); setIsOpeningBalance(false); setSelectedEntry(null); setShowForm(true); } }}>＋ إنشاء قيد</button></div></div>
          {showForm && <div className="journal-form"><div className="form-fields"><label>تاريخ القيد<input type="date" value={entryDate} disabled={isOpeningBalance} onChange={(e) => setEntryDate(e.target.value)} /></label><label className="description-field">البيان<input value={description} readOnly={isOpeningBalance} onChange={(e) => setDescription(e.target.value)} placeholder="اكتب وصف القيد المحاسبي" /></label></div>
            <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>الطرف</th><th>مركز التكلفة</th><th>البيان</th><th>مدين SAR</th><th>دائن SAR</th><th></th></tr></thead><tbody>{lines.map((line,index) => <tr key={index}><td><select value={line.account_id} onChange={(e) => updateLine(index,"account_id",e.target.value)}>{accounts.filter((a) => a.is_posting).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></td><td><select value={line.party_id ?? ""} onChange={(e) => updateLine(index,"party_id",e.target.value)}><option value="">بدون طرف</option>{parties.filter((p:any)=>p.is_active).map((p:any)=><option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></td><td><select value={line.cost_center_id ?? ""} onChange={(e) => updateLine(index,"cost_center_id",e.target.value)}><option value="">بدون مركز</option>{costCenters.filter((c:any)=>c.is_active).map((c:any)=><option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}</select></td><td><input value={line.description} onChange={(e) => updateLine(index,"description",e.target.value)} placeholder="بيان السطر" /></td><td><input type="number" min="0" step="0.01" value={line.debit} onChange={(e) => updateLine(index,"debit",e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={line.credit} onChange={(e) => updateLine(index,"credit",e.target.value)} /></td><td><button className="remove-line" onClick={() => setLines((v) => v.filter((_,i) => i !== index))}>×</button></td></tr>)}</tbody></table></div>
            <div className="journal-line-actions"><button type="button" className="add-line" onClick={() => setLines((v) => [...v,{account_id:accounts.find((a) => a.is_posting)?.id ?? "",debit:"0",credit:"0",description:"",party_id:null,cost_center_id:null}])}>＋ إضافة سطر جديد</button><span>{lines.length} سطر في القيد</span></div>
            <div className="journal-live-summary"><div><small>إجمالي المدين</small><b>{formatSAR(totals.debit)}</b></div><div><small>إجمالي الدائن</small><b>{formatSAR(totals.credit)}</b></div><div><small>الفرق</small><b>{formatSAR(Math.abs(totals.debit-totals.credit))}</b></div><div className={balanced ? "balance-ok" : "balance-warn"}><small>حالة القيد</small><b>{balanced ? "متوازن ✓" : totals.debit===0 && totals.credit===0 ? "بانتظار المبالغ" : "يحتاج إلى موازنة"}</b></div></div>
            <div className="form-actions"><button className="secondary-btn" onClick={resetJournalForm}>إلغاء</button><button className="primary-btn" disabled={busy || !balanced} onClick={saveJournal}>{busy ? "جارٍ الحفظ…" : isOpeningBalance ? "حفظ الأرصدة الافتتاحية كمسودة" : editingEntryId ? "حفظ تعديلات المسودة" : "حفظ المسودة"}</button></div>
          </div>}
          <div className="report-filters">
            <label>بحث برقم القيد أو البيان<input value={journalSearch} onChange={(e)=>setJournalSearch(e.target.value)} placeholder="ابحث في القيود..." /></label>
            <label>الحالة<select value={journalStatus} onChange={(e)=>setJournalStatus(e.target.value)}><option value="all">كل الحالات</option><option value="draft">مسودة</option><option value="posted">مرحّل</option><option value="reversed">معكوس</option></select></label>
            <label>من تاريخ<input type="date" value={journalFrom} onChange={(e)=>setJournalFrom(e.target.value)} /></label>
            <label>إلى تاريخ<input type="date" value={journalTo} onChange={(e)=>setJournalTo(e.target.value)} /></label>
            <button className="text-btn" onClick={()=>{setJournalSearch("");setJournalStatus("all");setJournalFrom("");setJournalTo("");}}>مسح الفلاتر</button>
          </div>
          <div className="table-wrap"><table><thead><tr><th>رقم</th><th>التاريخ</th><th>البيان</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{filteredEntries.map((e) => <tr key={e.id}><td>{e.entry_number}</td><td>{e.entry_date}</td><td>{e.description}</td><td>{e.status === "posted" ? "مرحّل" : e.status === "reversed" ? "معكوس" : "مسودة"}</td><td><button className="text-btn" disabled={busy} onClick={() => openJournalEntry(e.id)}>عرض</button>{e.status === "draft" && <button className="text-btn" disabled={busy} onClick={() => openJournalEntry(e.id,true)}>تعديل</button>}{e.status === "draft" && <button className="text-btn" disabled={busy} onClick={() => postJournal(e.id)}>ترحيل</button>}{e.status === "posted" && <button className="text-btn" disabled={busy} onClick={() => reverseJournal(e.id)}>عكس القيد</button>}</td></tr>)}</tbody></table></div>
          <p className="report-footnote">عدد القيود المعروضة: {filteredEntries.length} من {entries.length}</p>
          {selectedEntry && <section className="panel journal-detail"><div className="panel-heading"><div><h3>سند القيد رقم {selectedEntry.entry_number}</h3><p>{selectedEntry.entry_date} · {selectedEntry.status === "posted" ? "مرحّل" : selectedEntry.status === "reversed" ? "معكوس" : "مسودة"}</p></div><div className="report-actions"><button className="secondary-btn" onClick={()=>window.print()}>طباعة السند</button><button className="text-btn" onClick={()=>setSelectedEntry(null)}>إغلاق</button></div></div><p><b>البيان:</b> {selectedEntry.description}</p><div className="table-wrap"><table><thead><tr><th>الحساب</th><th>الطرف</th><th>مركز التكلفة</th><th>بيان السطر</th><th>مدين</th><th>دائن</th></tr></thead><tbody>{selectedEntry.lines.map((line:any)=><tr key={line.id}><td>{accounts.find(a=>a.id===line.account_id)?.code} — {accounts.find(a=>a.id===line.account_id)?.name_ar}</td><td>{parties.find((p:any)=>p.id===line.party_id)?.name || "—"}</td><td>{costCenters.find((c:any)=>c.id===line.cost_center_id)?.name_ar || "—"}</td><td>{line.description || "—"}</td><td>{formatSAR(Math.round(Number(line.debit)*100))}</td><td>{formatSAR(Math.round(Number(line.credit)*100))}</td></tr>)}</tbody></table></div></section>}
        </section>}
        {active === "دليل الحسابات" && <section className="panel"><h2>دليل الحسابات</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>اسم الحساب</th><th>النوع</th><th>طبيعة الحساب</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id}><td>{a.code}</td><td>{a.name_ar}</td><td>{a.type}</td><td>{a.is_posting ? "حساب حركة" : "حساب تجميعي"}</td></tr>)}</tbody></table></div></section>}
        {active === "ميزان المراجعة" && <section className="panel"><div className="panel-heading"><h2>ميزان المراجعة</h2><div className="report-actions"><button className="secondary-btn" onClick={() => downloadCsv("trial-balance.csv", [["رمز الحساب","الحساب","إجمالي مدين","إجمالي دائن","رصيد مدين","رصيد دائن"], ...trialBalance.map((a:any)=>[a.account_code,a.account_name,a.debit_total,a.credit_total,a.debit_balance,a.credit_balance])])}>تصدير Excel/CSV</button><button className="secondary-btn" onClick={() => window.print()}>طباعة</button></div></div><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>رصيد مدين</th><th>رصيد دائن</th></tr></thead><tbody>{trialBalance.map((a) => <tr key={a.account_id}><td>{a.account_code}</td><td>{a.account_name}</td><td>{formatSAR(Math.round(Number(a.debit_total) * 100))}</td><td>{formatSAR(Math.round(Number(a.credit_total) * 100))}</td><td>{formatSAR(Math.round(Number(a.debit_balance) * 100))}</td><td>{formatSAR(Math.round(Number(a.credit_balance) * 100))}</td></tr>)}</tbody></table></div><p className="report-footnote">إجمالي المدين: {formatSAR(Math.round(trialBalance.reduce((s:number,a:any)=>s+Number(a.debit_total||0),0)*100))} · إجمالي الدائن: {formatSAR(Math.round(trialBalance.reduce((s:number,a:any)=>s+Number(a.credit_total||0),0)*100))}</p></section>}
        {active === "مراكز التكلفة" && <section className="panel"><h2>مراكز التكلفة</h2><form className="journal-form" onSubmit={addCostCenter}><div className="form-fields"><label>الرمز<input required value={centerCode} onChange={(e) => setCenterCode(e.target.value)} placeholder="CC-001" /></label><label className="description-field">اسم مركز التكلفة<input required value={centerName} onChange={(e) => setCenterName(e.target.value)} placeholder="اسم الفرع أو القسم" /></label><button className="primary-btn" disabled={busy}>إضافة المركز</button></div></form><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>اسم مركز التكلفة</th><th>الحالة</th></tr></thead><tbody>{costCenters.map((cc) => <tr key={cc.id}><td>{cc.code}</td><td>{cc.name_ar}</td><td>{cc.is_active ? "نشط" : "موقوف"}</td></tr>)}</tbody></table></div></section>}
        {active === "العملاء والموردون" && <section className="panel"><div className="panel-heading"><div><h2>سجل العملاء والموردين</h2><p>إدارة بيانات الأطراف وربطها بالقيود المحاسبية</p></div></div><form className="journal-form" onSubmit={addParty}><div className="form-fields"><label>نوع الطرف<select value={partyType} onChange={(e) => setPartyType(e.target.value)}><option value="customer">عميل</option><option value="supplier">مورد</option><option value="both">عميل ومورد</option></select></label><label>الرمز<input required value={partyCode} onChange={(e) => setPartyCode(e.target.value)} placeholder="C-001" /></label><label className="description-field">الاسم<input required value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="اسم العميل أو المورد" /></label></div><div className="form-fields"><label>الهاتف<input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} /></label><label>الرقم الضريبي<input value={partyTax} onChange={(e) => setPartyTax(e.target.value)} /></label><button className="primary-btn" disabled={busy}>حفظ الطرف</button></div></form><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>الرقم الضريبي</th></tr></thead><tbody>{parties.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.party_type === "customer" ? "عميل" : p.party_type === "supplier" ? "مورد" : "عميل ومورد"}</td><td>{p.phone || "—"}</td><td>{p.tax_number || "—"}</td></tr>)}</tbody></table></div></section>}
        {active === "الأستاذ العام" && <section className="panel"><div className="panel-heading"><div><h2>الأستاذ العام</h2><p>حركات القيود المرحلة — آخر 500 حركة محملة</p></div><div className="report-actions"><button className="secondary-btn" onClick={() => downloadCsv("general-ledger.csv", [["التاريخ","رقم القيد","رمز الحساب","اسم الحساب","البيان","مدين","دائن","الرصيد الجاري"], ...filteredLedger.map((r:any)=>[r.entry_date,r.entry_number,r.account_code,r.account_name,r.line_description||r.entry_description,r.debit,r.credit,r.running_balance])])}>تصدير CSV لبرنامج Excel</button><button className="secondary-btn" onClick={() => window.print()}>طباعة</button></div></div><div className="report-filters"><label>من تاريخ<input type="date" value={reportFrom} onChange={(e)=>setReportFrom(e.target.value)}/></label><label>إلى تاريخ<input type="date" value={reportTo} onChange={(e)=>setReportTo(e.target.value)}/></label><button className="text-btn" onClick={()=>{setReportFrom("");setReportTo("");}}>مسح التصفية</button></div><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد الجاري</th></tr></thead><tbody>{filteredLedger.map((row:any, i:number) => <tr key={row.journal_entry_id + "-" + row.line_number + "-" + i}><td>{row.entry_date}</td><td>{row.entry_number}</td><td>{row.account_code} — {row.account_name}</td><td>{row.line_description || row.entry_description}</td><td>{formatSAR(Math.round(Number(row.debit) * 100))}</td><td>{formatSAR(Math.round(Number(row.credit) * 100))}</td><td>{formatSAR(Math.round(Number(row.running_balance) * 100))}</td></tr>)}</tbody></table></div><p className="report-footnote">عدد الحركات المعروضة: {filteredLedger.length}</p></section>}
        {active === "قائمة الدخل" && <section className="panel"><div className="panel-heading"><h2>قائمة الدخل حسب الحسابات</h2><div className="report-actions"><button className="secondary-btn" onClick={() => downloadCsv("income-statement.csv", [["رمز الحساب","الحساب","النوع","قيمة الفترة"], ...incomeAccounts.map((r:any)=>[r.account_code,r.account_name,r.account_type,r.period_amount])])}>تصدير Excel/CSV</button><button className="secondary-btn" onClick={() => window.print()}>طباعة</button></div></div><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>النوع</th><th>قيمة الفترة</th></tr></thead><tbody>{incomeAccounts.map((row) => <tr key={row.account_id}><td>{row.account_code}</td><td>{row.account_name}</td><td>{row.account_type === "revenue" ? "إيراد" : "مصروف"}</td><td>{formatSAR(Math.round(Number(row.period_amount) * 100))}</td></tr>)}</tbody></table></div></section>}
        <footer className="page-footer"><span>© نظام الشموخ ERP</span><span>أساس الاستحقاق · القيد المزدوج · SAR</span></footer>
      </div>
    </main>
  </div>;
}
