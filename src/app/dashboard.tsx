"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatSAR } from "@/lib/accounting/validate-journal";

type Account = { id: string; code: string; name_ar: string; type: string; is_posting: boolean; is_active: boolean };
type Line = { account_id: string; debit: string; credit: string; description: string };
type Entry = { id: string; entry_number: number; entry_date: string; description: string; status: string };

const navItems = ["لوحة التحكم", "القيود اليومية", "دليل الحسابات", "الأستاذ العام", "ميزان المراجعة"];
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
    const [companyResult, accountResult, periodResult, entryResult, balanceResult] = await Promise.all([
      supabase.from("companies").select("display_name,legal_name").eq("id", cid).single(),
      supabase.from("accounts").select("id,code,name_ar,type,is_posting,is_active").eq("company_id", cid).eq("is_active", true).order("code"),
      supabase.from("fiscal_periods").select("id,name,starts_on,ends_on,status").eq("company_id", cid).eq("status", "open").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("journal_entries").select("id,entry_number,entry_date,description,status").eq("company_id", cid).order("entry_date", { ascending: false }).limit(30),
      supabase.from("trial_balance").select("*").eq("company_id", cid).order("account_code"),
    ]);
    if (companyResult.data) setCompanyName(companyResult.data.display_name || companyResult.data.legal_name);
    if (accountResult.error) setNotice(accountResult.error.message); else setAccounts((accountResult.data ?? []) as Account[]);
    if (periodResult.error) setNotice(periodResult.error.message); else setPeriodId(periodResult.data?.id ?? null);
    if (entryResult.error) setNotice(entryResult.error.message); else setEntries((entryResult.data ?? []) as Entry[]);
    if (balanceResult.error) setNotice(balanceResult.error.message); else setTrialBalance(balanceResult.data ?? []);
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
      <nav>{navItems.map((item, index) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}><span>{["▦", "⇄", "☷", "▤", "⚖"][index]}</span>{item}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> متصل بقاعدة البيانات</div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="breadcrumb">الرئيسية</span><span className="crumb-sep">/</span><b>{active}</b></div><div className="top-actions"><span className="currency-pill">SAR · ريال سعودي</span><button className="text-btn" onClick={signOut}>خروج</button></div></header>
      <div className="page-content">
        <section className="welcome-row"><div><div className="eyebrow">نظام الشموخ المحاسبي</div><h1>{active}</h1><p>إدارة دقيقة للحسابات والعمليات المالية من مكان واحد.</p></div>{active === "القيود اليومية" && <button className="primary-btn" onClick={() => setShowForm(true)}>＋ قيد يومي جديد</button>}</section>
        {notice && <p className="notice">{notice}</p>}
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
        {active === "الأستاذ العام" && <section className="panel"><h2>الأستاذ العام</h2><p>عرض الأستاذ العام التفصيلي قيد التجهيز؛ البيانات المحاسبية محفوظة ومحمية في قاعدة البيانات.</p></section>}
        <footer className="page-footer"><span>© نظام الشموخ ERP</span><span>أساس الاستحقاق · القيد المزدوج · SAR</span></footer>
      </div>
    </main>
  </div>;
}
