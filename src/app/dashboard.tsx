"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatSAR } from "@/lib/accounting/validate-journal";
import Operations from "./operations";

type Account = { id: string; code: string; name_ar: string; type: string; is_posting: boolean; is_active: boolean };
type Line = { account_id: string; debit: string; credit: string; description: string };
type Entry = { id: string; entry_number: number; entry_date: string; description: string; status: string };

const navItems = ["لوحة التحكم", "القيود اليومية", "دليل الحسابات", "العملاء والموردون", "مراكز التكلفة", "الأستاذ العام", "ميزان المراجعة", "قائمة الدخل", "العمليات", "الميزانية العمومية", "التدفقات النقدية", "ملخص الضريبة"];
const today = new Date().toISOString().slice(0, 10);

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
  const [companyName, setCompanyName] = useState("الشركة");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [fiscalStart, setFiscalStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [fiscalEnd, setFiscalEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [periodId, setPeriodId] = useState<string | null>(null);
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
  const [showForm, setShowForm] = useState(false);
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingData, setLoadingData] = useState(false);

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
    const { data: membership, error: membershipError } = await supabase
      .from("company_users").select("company_id").eq("user_id", appId).eq("is_active", true).limit(1).maybeSingle();
    if (membershipError) { setNotice(membershipError.message); setLoadingData(false); return; }
    if (!membership) { setCompanyId(null); setLoadingData(false); return; }
    const cid = membership.company_id as string;
    setCompanyId(cid);
    const [companyResult, accountResult, periodResult, entryResult, balanceResult, ledgerResult, incomeResult, partyResult, centerResult, sheetResult, cashFlowResult, vatResult] = await Promise.all([
      supabase.from("companies").select("display_name,legal_name").eq("id", cid).single(),
      supabase.from("accounts").select("id,code,name_ar,type,is_posting,is_active").eq("company_id", cid).eq("is_active", true).order("code"),
      supabase.from("fiscal_periods").select("id,name,starts_on,ends_on,status").eq("company_id", cid).eq("status", "open").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("journal_entries").select("id,entry_number,entry_date,description,status").eq("company_id", cid).order("entry_date", { ascending: false }).limit(30),
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
  }, [supabase, user]);

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
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  async function saveJournal() {
    if (!supabase || !companyId || !periodId || !appUserId) {
      setNotice("لا توجد شركة أو فترة مالية مفتوحة. أكمل إعداد الشركة أولاً."); return;
    }
    if (!description.trim() || lines.length < 2 || !balanced) {
      setNotice("أدخل بيان القيد وسطرين على الأقل، وتأكد من تساوي المدين والدائن."); return;
    }
    const parsed = lines.map((line) => ({
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      description: line.description,
    }));
    if (parsed.some((line) => !line.account_id || line.debit < 0 || line.credit < 0 || (line.debit > 0) === (line.credit > 0))) {
      setNotice("راجع الحسابات والمبالغ: يجب إدخال مبلغ في جهة واحدة فقط لكل سطر."); return;
    }
    setBusy(true); setNotice("");
    const { data: entryId, error } = await supabase.rpc("save_draft_journal_entry", {
      p_company_id: companyId,
      p_fiscal_period_id: periodId,
      p_entry_date: entryDate,
      p_description: description.trim(),
      p_lines: parsed,
    });
    if (error) { setBusy(false); setNotice(error.message); return; }
    setBusy(false);
    setNotice(`تم حفظ القيد رقم ${entryId} كمسودة بنجاح.`);
    setShowForm(false); setDescription("");
    setLines([]);
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
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">ش</span><div><b>الشموخ ERP</b><small>النظام المحاسبي</small></div></div>
      <div className="company-switch"><small>الشركة الحالية</small><strong>{companyName}</strong></div>
      <div className="nav-caption">القائمة الرئيسية</div>
      <nav>{navItems.map((item, index) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}><span>{["▦", "⇄", "☷", "♙", "⌖", "▤", "⚖", "↗", "▣", "▤", "↕", "%"][index]}</span>{item}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> متصل بقاعدة البيانات</div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="breadcrumb">الرئيسية</span><span className="crumb-sep">/</span><b>{active}</b></div><div className="top-actions"><span className="currency-pill">SAR · ريال سعودي</span><button className="text-btn" onClick={signOut}>خروج</button></div></header>
      <div className="page-content">
        <section className="welcome-row"><div><div className="eyebrow">نظام الشموخ المحاسبي</div><h1>{active}</h1><p>إدارة دقيقة للحسابات والعمليات المالية من مكان واحد.</p></div>{active === "القيود اليومية" && <button className="primary-btn" onClick={() => setShowForm(true)}>＋ قيد يومي جديد</button>}</section>
        {notice && <p className="notice">{notice}</p>}
        {active === "العمليات" && <Operations supabase={supabase!} companyId={companyId!} appUserId={appUserId} />}
        {active === "الميزانية العمومية" && <section className="panel"><h2>الميزانية العمومية — أرصدة الحسابات</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>التصنيف</th><th>الرصيد</th></tr></thead><tbody>{balanceSheet.map((r) => <tr key={r.account_id}><td>{r.account_code}</td><td>{r.account_name}</td><td>{r.account_type === "asset" ? "أصول" : r.account_type === "liability" ? "التزامات" : "حقوق ملكية"}</td><td>{formatSAR(Math.round(Number(r.balance) * 100))}</td></tr>)}</tbody></table></div></section>}
        {active === "التدفقات النقدية" && <section className="panel"><h2>ملخص الصناديق والبنوك</h2><div className="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد الافتتاحي</th><th>المقبوضات</th><th>المدفوعات</th><th>الرصيد الختامي</th></tr></thead><tbody>{cashFlow.map((r) => <tr key={r.cash_account_id}><td>{r.code} — {r.name_ar}</td><td>{r.account_type === "cash" ? "صندوق" : "بنك"}</td><td>{formatSAR(Math.round(Number(r.opening_balance) * 100))}</td><td>{formatSAR(Math.round(Number(r.receipts) * 100))}</td><td>{formatSAR(Math.round(Number(r.payments) * 100))}</td><td>{formatSAR(Math.round(Number(r.closing_balance) * 100))}</td></tr>)}</tbody></table></div><p className="notice">يعرض هذا الملخص حركات الصندوق والبنوك المرحلة فقط، وليس قائمة التدفقات النقدية المحاسبية الكاملة.</p></section>}
        {active === "ملخص الضريبة" && <section className="panel"><h2>ملخص ضريبة القيمة المضافة</h2><div className="table-wrap"><table><thead><tr><th>المصدر</th><th>عدد الفواتير المرحلة</th><th>الإجمالي شامل الضريبة</th><th>الضريبة</th></tr></thead><tbody>{vatSummary.map((r,i) => <tr key={i}><td>{r.source_type === "sales" ? "المبيعات" : "المشتريات"}</td><td>{r.document_count}</td><td>{formatSAR(Math.round(Number(r.gross_amount) * 100))}</td><td>{formatSAR(Math.round(Number(r.vat_amount) * 100))}</td></tr>)}</tbody></table></div><p className="notice">هذا ملخص داخلي مبني على الفواتير المرحلة، ولا يمثل إقراراً ضريبياً أو اعتماداً من هيئة الزكاة والضريبة والجمارك.</p></section>}
        {loadingData && <p>جارٍ تحميل بيانات الشركة…</p>}
        {active === "لوحة التحكم" && <section className="content-grid">
          <article className="panel"><div className="panel-heading"><div><h2>آخر القيود اليومية</h2><p>القيود المسجلة في قاعدة البيانات</p></div><button className="text-btn" onClick={() => setActive("القيود اليومية")}>عرض الكل ←</button></div>
            {entries.length ? <div className="table-wrap"><table><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحالة</th></tr></thead><tbody>{entries.slice(0,8).map((e) => <tr key={e.id}><td>{e.entry_number}</td><td>{e.entry_date}</td><td>{e.description}</td><td>{e.status === "posted" ? "مرحّل" : e.status === "reversed" ? "معكوس" : "مسودة"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>لا توجد قيود بعد</b><p>ابدأ بإنشاء أول قيد يومي.</p></div>}
          </article>
          <article className="panel quick-panel"><h2>ملخص الحسابات</h2><p>عدد الحسابات النشطة: <b>{accounts.length}</b></p><p>القيود الظاهرة: <b>{entries.length}</b></p><p>عملة الشركة: <b>ريال سعودي SAR</b></p><button className="primary-btn" onClick={() => { setActive("القيود اليومية"); setShowForm(true); }}>إنشاء قيد جديد</button></article>
        </section>}
        {active === "القيود اليومية" && <section className="panel">
          <div className="panel-heading"><div><h2>دفتر القيود اليومية</h2><p>المسودات والقيود المرحلة</p></div><button className="primary-btn" onClick={() => setShowForm((v) => !v)}>＋ إنشاء قيد</button></div>
          {showForm && <div className="journal-form"><div className="form-fields"><label>تاريخ القيد<input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label><label className="description-field">البيان<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="اكتب وصف القيد المحاسبي" /></label></div>
            <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>البيان</th><th>مدين SAR</th><th>دائن SAR</th><th></th></tr></thead><tbody>{lines.map((line,index) => <tr key={index}><td><select value={line.account_id} onChange={(e) => updateLine(index,"account_id",e.target.value)}>{accounts.filter((a) => a.is_posting).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></td><td><input value={line.description} onChange={(e) => updateLine(index,"description",e.target.value)} placeholder="بيان السطر" /></td><td><input type="number" min="0" step="0.01" value={line.debit} onChange={(e) => updateLine(index,"debit",e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={line.credit} onChange={(e) => updateLine(index,"credit",e.target.value)} /></td><td><button className="remove-line" onClick={() => setLines((v) => v.filter((_,i) => i !== index))}>×</button></td></tr>)}</tbody></table></div>
            <button className="add-line" onClick={() => setLines((v) => [...v,{account_id:accounts.find((a) => a.is_posting)?.id ?? "",debit:"0",credit:"0",description:""}])}>＋ إضافة سطر</button>
            <div className="totals-row"><div><small>إجمالي المدين</small><b>{formatSAR(totals.debit)}</b></div><div><small>إجمالي الدائن</small><b>{formatSAR(totals.credit)}</b></div><div className={balanced ? "balance-ok" : "balance-warn"}><small>حالة التوازن</small><b>{balanced ? "متوازن ✓" : "غير متوازن"}</b></div></div>
            <div className="form-actions"><button className="secondary-btn" onClick={() => setShowForm(false)}>إلغاء</button><button className="primary-btn" disabled={busy || !balanced} onClick={saveJournal}>{busy ? "جارٍ الحفظ…" : "حفظ المسودة"}</button></div>
          </div>}
          <div className="table-wrap"><table><thead><tr><th>رقم</th><th>التاريخ</th><th>البيان</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{entries.map((e) => <tr key={e.id}><td>{e.entry_number}</td><td>{e.entry_date}</td><td>{e.description}</td><td>{e.status === "posted" ? "مرحّل" : e.status === "reversed" ? "معكوس" : "مسودة"}</td><td>{e.status === "draft" && <button className="text-btn" disabled={busy} onClick={() => postJournal(e.id)}>ترحيل</button>}{e.status === "posted" && <button className="text-btn" disabled={busy} onClick={() => reverseJournal(e.id)}>عكس القيد</button>}</td></tr>)}</tbody></table></div>
        </section>}
        {active === "دليل الحسابات" && <section className="panel"><h2>دليل الحسابات</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>اسم الحساب</th><th>النوع</th><th>طبيعة الحساب</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id}><td>{a.code}</td><td>{a.name_ar}</td><td>{a.type}</td><td>{a.is_posting ? "حساب حركة" : "حساب تجميعي"}</td></tr>)}</tbody></table></div></section>}
        {active === "ميزان المراجعة" && <section className="panel"><h2>ميزان المراجعة</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>رصيد مدين</th><th>رصيد دائن</th></tr></thead><tbody>{trialBalance.map((a) => <tr key={a.account_id}><td>{a.account_code}</td><td>{a.account_name}</td><td>{formatSAR(Math.round(Number(a.debit_total) * 100))}</td><td>{formatSAR(Math.round(Number(a.credit_total) * 100))}</td><td>{formatSAR(Math.round(Number(a.debit_balance) * 100))}</td><td>{formatSAR(Math.round(Number(a.credit_balance) * 100))}</td></tr>)}</tbody></table></div></section>}
        {active === "مراكز التكلفة" && <section className="panel"><h2>مراكز التكلفة</h2><form className="journal-form" onSubmit={addCostCenter}><div className="form-fields"><label>الرمز<input required value={centerCode} onChange={(e) => setCenterCode(e.target.value)} placeholder="CC-001" /></label><label className="description-field">اسم مركز التكلفة<input required value={centerName} onChange={(e) => setCenterName(e.target.value)} placeholder="اسم الفرع أو القسم" /></label><button className="primary-btn" disabled={busy}>إضافة المركز</button></div></form><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>اسم مركز التكلفة</th><th>الحالة</th></tr></thead><tbody>{costCenters.map((cc) => <tr key={cc.id}><td>{cc.code}</td><td>{cc.name_ar}</td><td>{cc.is_active ? "نشط" : "موقوف"}</td></tr>)}</tbody></table></div></section>}
        {active === "العملاء والموردون" && <section className="panel"><div className="panel-heading"><div><h2>سجل العملاء والموردين</h2><p>إدارة بيانات الأطراف وربطها بالقيود المحاسبية</p></div></div><form className="journal-form" onSubmit={addParty}><div className="form-fields"><label>نوع الطرف<select value={partyType} onChange={(e) => setPartyType(e.target.value)}><option value="customer">عميل</option><option value="supplier">مورد</option><option value="both">عميل ومورد</option></select></label><label>الرمز<input required value={partyCode} onChange={(e) => setPartyCode(e.target.value)} placeholder="C-001" /></label><label className="description-field">الاسم<input required value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="اسم العميل أو المورد" /></label></div><div className="form-fields"><label>الهاتف<input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} /></label><label>الرقم الضريبي<input value={partyTax} onChange={(e) => setPartyTax(e.target.value)} /></label><button className="primary-btn" disabled={busy}>حفظ الطرف</button></div></form><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>الرقم الضريبي</th></tr></thead><tbody>{parties.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.party_type === "customer" ? "عميل" : p.party_type === "supplier" ? "مورد" : "عميل ومورد"}</td><td>{p.phone || "—"}</td><td>{p.tax_number || "—"}</td></tr>)}</tbody></table></div></section>}
        {active === "الأستاذ العام" && <section className="panel"><h2>الأستاذ العام</h2><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد الجاري</th></tr></thead><tbody>{generalLedger.map((row, i) => <tr key={row.journal_entry_id + "-" + row.line_number + "-" + i}><td>{row.entry_date}</td><td>{row.entry_number}</td><td>{row.account_code} — {row.account_name}</td><td>{row.line_description || row.entry_description}</td><td>{formatSAR(Math.round(Number(row.debit) * 100))}</td><td>{formatSAR(Math.round(Number(row.credit) * 100))}</td><td>{formatSAR(Math.round(Number(row.running_balance) * 100))}</td></tr>)}</tbody></table></div></section>}
        {active === "قائمة الدخل" && <section className="panel"><h2>قائمة الدخل حسب الحسابات</h2><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>النوع</th><th>قيمة الفترة</th></tr></thead><tbody>{incomeAccounts.map((row) => <tr key={row.account_id}><td>{row.account_code}</td><td>{row.account_name}</td><td>{row.account_type === "revenue" ? "إيراد" : "مصروف"}</td><td>{formatSAR(Math.round(Number(row.period_amount) * 100))}</td></tr>)}</tbody></table></div></section>}
        <footer className="page-footer"><span>© نظام الشموخ ERP</span><span>أساس الاستحقاق · القيد المزدوج · SAR</span></footer>
      </div>
    </main>
  </div>;
}
