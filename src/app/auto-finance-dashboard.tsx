"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import "./auto-finance.css";

type Company = { id: string; display_name: string | null; legal_name: string; currency_code: string; timezone: string };
type Account = { id: string; code: string; name_ar: string; account_class: string; normal_balance: string; is_posting: boolean; is_active: boolean };
type Entry = { id: string; entry_number: number | null; entry_date: string; description: string; status: string; posted_at: string | null };
type DraftLine = { account_id: string; debit: string; credit: string; description: string };

const EXPECTED_SUPABASE_URL = "https://fvmdatbwkmwbhoiuzbgn.supabase.co";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const money = (value: number) => new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", minimumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(value + "T12:00:00"));

export default function AutoFinanceDashboard() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") === EXPECTED_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabase = useMemo(() => configured ? createClient() : null, [configured]);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [company, setCompany] = useState<Company | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState({ debit: 0, credit: 0, posted: 0, drafts: 0 });
  const [active, setActive] = useState<"home" | "journal" | "accounts">("home");
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { account_id: "", debit: "", credit: "", description: "" },
    { account_id: "", debit: "", credit: "", description: "" },
  ]);
  const [showEntryForm, setShowEntryForm] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!alive) return;
      if (error) setNotice("تعذر التحقق من جلسة الدخول.");
      setUser(data.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setNotice("");
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    setBusy(true);
    setNotice("");
    const { data: memberships, error: membershipError } = await supabase
      .from("company_members")
      .select("company_id,role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(2);
    const membership = memberships?.length === 1 ? memberships[0] : null;
    if (membershipError) {
      setNotice("تعذر التحقق من ارتباط الحساب بالشركة. لا يمكن عرض البيانات.");
      setCompany(null); setBusy(false); return;
    }
    if (!membership) {
      setNotice("هذا الحساب غير مرتبط بشركة نشطة واحدة. لن يتم عرض أي بيانات حتى يتم ربطه بالشركة الصحيحة.");
      setCompany(null); setAccounts([]); setEntries([]); setTotals({ debit: 0, credit: 0, posted: 0, drafts: 0 }); setBusy(false); return;
    }
    const [companyResult, accountsResult, entriesResult] = await Promise.all([
      supabase.from("companies").select("id,display_name,legal_name,currency_code,timezone").eq("id", membership.company_id).single(),
      supabase.from("accounts").select("id,code,name_ar,account_class,normal_balance,is_posting,is_active").eq("company_id", membership.company_id).order("code"),
      supabase.from("journal_entries").select("id,entry_number,entry_date,description,status,posted_at").eq("company_id", membership.company_id).order("entry_date", { ascending: false }).limit(100),
    ]);
    if (companyResult.error || accountsResult.error || entriesResult.error) {
      setNotice("تعذر تحميل مساحة العمل. تحقق من سياسات الوصول ثم أعد المحاولة.");
      setBusy(false); return;
    }
    setCompany(companyResult.data as Company);
    setAccounts((accountsResult.data ?? []) as Account[]);
    const entryRows = (entriesResult.data ?? []) as Entry[];
    setEntries(entryRows);
    const { data: summaryRows, error: summaryError } = await supabase.rpc("company_dashboard_summary", { p_company_id: membership.company_id });
    if (summaryError) {
      setNotice("تم تحميل البيانات الأساسية، لكن تعذر احتساب ملخص الأرصدة.");
      setTotals({ debit: 0, credit: 0, posted: 0, drafts: entryRows.filter((entry) => entry.status === "draft").length });
    } else {
      const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
      setTotals({
        debit: Number(summary?.total_debit ?? 0),
        credit: Number(summary?.total_credit ?? 0),
        posted: Number(summary?.posted_entries ?? 0),
        drafts: Number(summary?.draft_entries ?? 0),
      });
    }
    setBusy(false);
  }, [supabase, user]);

  useEffect(() => { if (user) void refresh(); else { setCompany(null); setAccounts([]); setEntries([]); } }, [user, refresh]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setNotice("تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور."); return; }
    setUser(data.user);
    setPassword("");
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) setNotice("تعذر إنهاء الجلسة. حاول مرة أخرى.");
    else { setUser(null); setCompany(null); setActive("home"); }
  }

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [field]: value };
      if (field === "debit" && Number(value) > 0) next.credit = "";
      if (field === "credit" && Number(value) > 0) next.debit = "";
      return next;
    }));
  }

  const debitTotal = lines.reduce((sum, line) => sum + Math.round((Number(line.debit) || 0) * 100), 0);
  const creditTotal = lines.reduce((sum, line) => sum + Math.round((Number(line.credit) || 0) * 100), 0);
  const balanced = debitTotal > 0 && debitTotal === creditTotal;
  const postingAccounts = accounts.filter((account) => account.is_active && account.is_posting);

  async function saveJournal(post: boolean) {
    if (!supabase || !company || !user) return;
    if (!description.trim()) { setNotice("أدخل بيان القيد."); return; }
    if (lines.length < 2 || !balanced) { setNotice("القيد غير متوازن. يجب أن يتساوى إجمالي المدين والدائن."); return; }
    const validLines = lines.map((line) => ({
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      description: line.description.trim() || null,
    }));
    if (validLines.some((line) => !line.account_id || (line.debit > 0) === (line.credit > 0))) {
      setNotice("اختر حساباً لكل سطر وأدخل مبلغاً في جهة واحدة فقط."); return;
    }
    setBusy(true); setNotice("");
    const branchResult = await supabase.from("branches").select("id")
      .eq("company_id", company.id).eq("is_active", true).order("code").limit(1).maybeSingle();
    if (branchResult.error) { setBusy(false); setNotice("تعذر التحقق من الفرع."); return; }

    const { data: entryId, error: createError } = await supabase.rpc("create_journal_entry_draft", {
      p_company_id: company.id,
      p_branch_id: branchResult.data?.id ?? null,
      p_entry_date: entryDate,
      p_description: description.trim(),
      p_lines: validLines,
    });
    if (createError || !entryId) {
      setBusy(false);
      setNotice(createError?.message ?? "تعذر إنشاء القيد.");
      return;
    }

    if (post) {
      const { error: postError } = await supabase.rpc("post_journal_entry", {
        p_company_id: company.id,
        p_entry_id: entryId,
      });
      if (postError) {
        setBusy(false);
        setNotice("حُفظ القيد كاملاً كمسودة، لكن تعذر ترحيله: " + postError.message);
        await refresh();
        return;
      }
    }
    setDescription("");
    setLines([{ account_id: "", debit: "", credit: "", description: "" }, { account_id: "", debit: "", credit: "", description: "" }]);
    setShowEntryForm(false);
    setBusy(false);
    setNotice(post ? "تم حفظ القيد وترحيله بنجاح." : "تم حفظ القيد كمسودة.");
    await refresh();
  }

  if (authLoading) return <main className="af-loading"><div className="af-spinner" /><p>جارٍ التحقق من جلسة الدخول…</p></main>;

  if (!configured) return (
    <main className="af-auth-shell"><section className="af-auth-card">
      <div className="af-brand-mark">AF</div><span className="af-eyebrow">AUTO-FINANCE</span>
      <h1>إعداد الاتصال الآمن</h1><p>التطبيق جاهز لربط قاعدة البيانات. أضف متغيرات Supabase في إعدادات الاستضافة قبل تسجيل الدخول.</p>
      <code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
      <small>لا تضع مفتاح service_role في متغيرات الواجهة أو في المستودع.</small>
    </section></main>
  );

  if (!user) return (
    <main className="af-auth-shell"><section className="af-auth-card">
      <div className="af-brand-mark">AF</div><span className="af-eyebrow">AUTO-FINANCE</span>
      <h1>مرحباً بعودتك</h1><p>سجّل الدخول للوصول إلى مساحة شركتك المالية الآمنة.</p>
      <form onSubmit={signIn} className="af-auth-form">
        <label>البريد الإلكتروني<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
        <label>كلمة المرور<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></label>
        <button className="af-primary" disabled={busy}>{busy ? "جارٍ الدخول…" : "تسجيل الدخول"}</button>
      </form>
      {notice && <div className="af-notice">{notice}</div>}
      <div className="af-auth-foot">الوصول مخصص للحسابات المرتبطة بالشركة فقط.</div>
    </section></main>
  );

  if (!company) return (
    <main className="af-auth-shell"><section className="af-auth-card af-access-card">
      <div className="af-brand-mark">AF</div><span className="af-eyebrow">حماية الحساب</span>
      <h1>لم يتم ربط هذا الحساب بشركة</h1><p>{notice || "لا يمكن عرض أي بيانات قبل التحقق من عضوية الشركة."}</p>
      <button className="af-secondary" onClick={() => void signOut()} disabled={busy}>تسجيل الخروج</button>
    </section></main>
  );

  const companyLabel = company.display_name || company.legal_name;
  const accountClassLabel: Record<string, string> = { asset: "الأصول", liability: "الالتزامات", equity: "حقوق الملكية", revenue: "الإيرادات", expense: "المصروفات" };

  return (
    <main className="af-app" dir="rtl">
      <aside className="af-sidebar">
        <div className="af-brand"><div className="af-brand-mark">AF</div><div><strong>AUTO-FINANCE</strong><small>النظام المالي الذكي</small></div></div>
        <div className="af-company-switch"><span className="af-company-dot" /><div><small>الشركة الحالية</small><strong>{companyLabel}</strong></div><span className="af-chevron">⌄</span></div>
        <span className="af-nav-label">القائمة الرئيسية</span>
        <nav className="af-nav">
          <button className={active === "home" ? "active" : ""} onClick={() => setActive("home")}><span>▦</span> نظرة عامة</button>
          <button className={active === "journal" ? "active" : ""} onClick={() => setActive("journal")}><span>≡</span> القيود اليومية</button>
          <button className={active === "accounts" ? "active" : ""} onClick={() => setActive("accounts")}><span>⊞</span> دليل الحسابات</button>
        </nav>
        <div className="af-sidebar-bottom"><div className="af-secure"><span>✓</span><div><b>بياناتك محمية</b><small>عزل على مستوى قاعدة البيانات</small></div></div><button onClick={() => void signOut()} disabled={busy} className="af-logout">↪ تسجيل الخروج</button></div>
      </aside>

      <section className="af-main">
        <header className="af-topbar"><div><span className="af-breadcrumb">مساحة العمل</span><b>{active === "home" ? "نظرة عامة" : active === "journal" ? "القيود اليومية" : "دليل الحسابات"}</b></div><div className="af-top-user"><span className="af-live-dot" /> متصل بأمان <span className="af-avatar">{(user.email || "A").slice(0,1).toUpperCase()}</span></div></header>
        <div className="af-content">
          {notice && <div className="af-inline-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
          {active === "home" && <>
            <div className="af-page-heading"><div><span className="af-eyebrow">لوحة المعلومات</span><h1>مرحباً بك في {companyLabel}</h1><p>إليك ملخص الحركة المحاسبية المسجلة في شركتك.</p></div><button className="af-primary af-heading-action" onClick={() => { setActive("journal"); setShowEntryForm(true); }}>＋ قيد يومي جديد</button></div>
            <div className="af-kpis">
              <article><span className="af-kpi-icon green">↗</span><small>إجمالي المدين المرحّل</small><strong>{money(totals.debit)}</strong><em>من القيود المرحلة فقط</em></article>
              <article><span className="af-kpi-icon blue">↙</span><small>إجمالي الدائن المرحّل</small><strong>{money(totals.credit)}</strong><em>من القيود المرحلة فقط</em></article>
              <article><span className="af-kpi-icon violet">✓</span><small>القيود المرحلة</small><strong>{totals.posted.toLocaleString("ar-SA")}</strong><em>قيد محاسبي معتمد</em></article>
              <article><span className="af-kpi-icon amber">◷</span><small>مسودات القيود</small><strong>{totals.drafts.toLocaleString("ar-SA")}</strong><em>تحتاج إلى مراجعة أو ترحيل</em></article>
            </div>
            <div className="af-home-grid">
              <section className="af-panel af-recent"><div className="af-panel-head"><div><h2>أحدث القيود</h2><p>آخر الحركات المسجلة في دفتر اليومية</p></div><button className="af-text-button" onClick={() => setActive("journal")}>عرض الكل ←</button></div>
                {entries.length ? <div className="af-table-wrap"><table><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحالة</th></tr></thead><tbody>{entries.slice(0,8).map((entry) => <tr key={entry.id}><td className="af-code">{entry.entry_number ?? "—"}</td><td>{dateLabel(entry.entry_date)}</td><td>{entry.description}</td><td><span className={"af-status " + (entry.status === "posted" ? "posted" : entry.status === "draft" ? "draft" : "muted")}>{entry.status === "posted" ? "مرحّل" : entry.status === "draft" ? "مسودة" : entry.status}</span></td></tr>)}</tbody></table></div> : <div className="af-empty"><span>≡</span><b>لا توجد قيود بعد</b><p>ابدأ بتسجيل أول قيد محاسبي لشركتك.</p><button className="af-secondary" onClick={() => { setActive("journal"); setShowEntryForm(true); }}>إنشاء أول قيد</button></div>}
              </section>
              <section className="af-panel af-integrity"><div className="af-panel-head"><div><h2>سلامة الدفاتر</h2><p>مؤشرات التحقق المحاسبي</p></div><span className="af-shield">✓</span></div>
                <div className="af-integrity-row"><span>توازن إجمالي الحركة</span><b>{Math.abs(totals.debit - totals.credit) < 0.005 ? "متوازن" : "يحتاج مراجعة"}</b></div><div className="af-integrity-track"><i style={{ width: totals.debit || totals.credit ? (Math.min(totals.debit, totals.credit) / Math.max(totals.debit, totals.credit) * 100) + "%" : "100%" }} /></div>
                <div className="af-integrity-row"><span>دليل الحسابات</span><b>{accounts.length.toLocaleString("ar-SA")} حساب</b></div><div className="af-integrity-row"><span>حسابات الترحيل النشطة</span><b>{postingAccounts.length.toLocaleString("ar-SA")}</b></div>
                <div className="af-integrity-foot">تعتمد المؤشرات على البيانات الفعلية المتاحة في قاعدة بيانات الشركة.</div>
              </section>
            </div>
            <div className="af-footnote">جميع المبالغ بالريال السعودي · المنطقة الزمنية Asia/Riyadh · الأساس المحاسبي: الاستحقاق</div>
          </>}

          {active === "journal" && <>
            <div className="af-page-heading"><div><span className="af-eyebrow">المحاسبة العامة</span><h1>القيود اليومية</h1><p>إدارة القيود ومراجعة حالتها قبل الترحيل.</p></div><button className="af-primary" onClick={() => setShowEntryForm((value) => !value)}>＋ قيد جديد</button></div>
            {showEntryForm && <section className="af-panel af-entry-form"><div className="af-panel-head"><div><h2>إنشاء قيد يومية</h2><p>يجب أن يتساوى المدين والدائن قبل الحفظ أو الترحيل.</p></div><button className="af-icon-button" onClick={() => setShowEntryForm(false)}>×</button></div>
              <form onSubmit={(event) => { event.preventDefault(); void saveJournal(false); }}>
                <div className="af-form-grid"><label>تاريخ القيد<input type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label><label className="af-wide">البيان<input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف مختصر للعملية المالية" /></label></div>
                <div className="af-table-wrap"><table className="af-lines-table"><thead><tr><th>الحساب</th><th>البيان</th><th>مدين (ر.س)</th><th>دائن (ر.س)</th><th></th></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td><select required value={line.account_id} onChange={(e) => updateLine(index, "account_id", e.target.value)}><option value="">اختر الحساب</option>{postingAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name_ar}</option>)}</select></td><td><input value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} placeholder="اختياري" /></td><td><input type="number" min="0" step="0.01" value={line.debit} onChange={(e) => updateLine(index, "debit", e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={line.credit} onChange={(e) => updateLine(index, "credit", e.target.value)} /></td><td><button type="button" className="af-remove-line" onClick={() => setLines((current) => current.length > 2 ? current.filter((_, i) => i !== index) : current)}>×</button></td></tr>)}</tbody></table></div>
                <button type="button" className="af-add-line" onClick={() => setLines((current) => [...current, { account_id: "", debit: "", credit: "", description: "" }])}>＋ إضافة سطر</button>
                <div className="af-entry-totals"><span>إجمالي المدين <b>{money(debitTotal / 100)}</b></span><span>إجمالي الدائن <b>{money(creditTotal / 100)}</b></span><span className={balanced ? "balanced" : "unbalanced"}>{balanced ? "✓ القيد متوازن" : "• القيد غير متوازن"}</span></div>
                <div className="af-form-actions"><button className="af-secondary" type="button" onClick={() => void saveJournal(false)} disabled={busy || !balanced}>حفظ كمسودة</button><button className="af-primary" type="button" onClick={() => void saveJournal(true)} disabled={busy || !balanced}>{busy ? "جارٍ الحفظ…" : "حفظ وترحيل القيد"}</button></div>
              </form>
            </section>}
            <section className="af-panel"><div className="af-panel-head"><div><h2>سجل القيود</h2><p>{entries.length.toLocaleString("ar-SA")} قيد ضمن أحدث السجلات</p></div><button className="af-text-button" onClick={() => void refresh()} disabled={busy}>تحديث البيانات ↻</button></div>
              {entries.length ? <div className="af-table-wrap"><table><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحالة</th><th>تاريخ الترحيل</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td className="af-code">{entry.entry_number ?? "—"}</td><td>{dateLabel(entry.entry_date)}</td><td>{entry.description}</td><td><span className={"af-status " + (entry.status === "posted" ? "posted" : "draft")}>{entry.status === "posted" ? "مرحّل" : "مسودة"}</span></td><td>{entry.posted_at ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(entry.posted_at)) : "—"}</td></tr>)}</tbody></table></div> : <div className="af-empty"><b>لا توجد قيود مسجلة</b><p>ستظهر القيود هنا بعد إضافتها.</p></div>}
            </section>
          </>}

          {active === "accounts" && <>
            <div className="af-page-heading"><div><span className="af-eyebrow">الإعدادات المحاسبية</span><h1>دليل الحسابات</h1><p>شجرة الحسابات الخاصة بشركة {companyLabel}.</p></div><span className="af-count-pill">{accounts.length} حساب</span></div>
            <section className="af-panel"><div className="af-panel-head"><div><h2>الحسابات المحاسبية</h2><p>الحسابات التجميعية والتفصيلية</p></div></div>
              <div className="af-table-wrap"><table><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>التصنيف</th><th>طبيعة الرصيد</th><th>نوع الحساب</th><th>الحالة</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td className="af-code">{account.code}</td><td>{account.name_ar}</td><td>{accountClassLabel[account.account_class] ?? account.account_class}</td><td>{account.normal_balance === "debit" ? "مدين" : "دائن"}</td><td>{account.is_posting ? "تفصيلي" : "تجميعي"}</td><td><span className={"af-status " + (account.is_active ? "posted" : "muted")}>{account.is_active ? "نشط" : "موقوف"}</span></td></tr>)}</tbody></table></div>
            </section>
          </>}
        </div>
      </section>
    </main>
  );
}
