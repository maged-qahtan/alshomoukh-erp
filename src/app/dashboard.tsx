"use client";

import { useMemo, useState } from "react";
import { defaultChartOfAccounts } from "@/lib/accounting/default-chart";
import { formatSAR } from "@/lib/accounting/validate-journal";

type Line = { accountId: string; debit: string; credit: string; description: string };

const navItems = ["لوحة التحكم", "القيود اليومية", "دليل الحسابات", "الأستاذ العام", "ميزان المراجعة", "القوائم المالية"];

export default function Dashboard() {
  const [active, setActive] = useState("لوحة التحكم");
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([
    { accountId: "1110", debit: "0", credit: "0", description: "" },
    { accountId: "4100", debit: "0", credit: "0", description: "" },
  ]);
  const totals = useMemo(() => lines.reduce((sum, line) => ({
    debit: sum.debit + Math.round((Number(line.debit) || 0) * 100),
    credit: sum.credit + Math.round((Number(line.credit) || 0) * 100),
  }), { debit: 0, credit: 0 }), [lines]);
  const balanced = totals.debit > 0 && totals.debit === totals.credit;
  const postingAccounts = defaultChartOfAccounts.filter((account) => account.isPosting);

  function updateLine(index: number, field: keyof Line, value: string) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">ش</span><div><b>الشموخ ERP</b><small>النظام المحاسبي</small></div></div>
        <div className="company-switch"><small>الشركة الحالية</small><strong>شركة الشموخ</strong><span>⌄</span></div>
        <div className="nav-caption">القائمة الرئيسية</div>
        <nav>{navItems.map((item, index) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}><span>{["▦", "⇄", "☷", "▤", "⚖", "▥"][index]}</span>{item}</button>)}</nav>
        <div className="sidebar-bottom"><span className="status-dot" /> بيئة تأسيسية · غير متصلة بقاعدة البيانات</div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><span className="breadcrumb">الرئيسية</span><span className="crumb-sep">/</span><b>{active}</b></div><div className="top-actions"><span className="currency-pill">SAR · ريال سعودي</span><span className="avatar">م</span></div></header>
        <div className="page-content">
          <section className="welcome-row"><div><div className="eyebrow">نظام الشموخ المحاسبي</div><h1>{active}</h1><p>إدارة دقيقة للحسابات والعمليات المالية من مكان واحد.</p></div><button className="primary-btn" onClick={() => { setActive("القيود اليومية"); setShowForm(true); }}>＋ قيد يومي جديد</button></section>

          {active === "لوحة التحكم" && <>
            <section className="stats-grid">
              {[["إجمالي الأصول","—","حتى تاريخه","◫"],["إجمالي الالتزامات","—","حتى تاريخه","▤"],["الإيرادات","—","الفترة الحالية","↗"],["المصروفات","—","الفترة الحالية","↘"]].map(([label,value,sub,icon]) => <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{sub}</small></article>)}
            </section>
            <section className="content-grid"><article className="panel"><div className="panel-heading"><div><h2>آخر القيود اليومية</h2><p>الحركات المحاسبية المسجلة مؤخراً</p></div><button className="text-btn" onClick={() => setActive("القيود اليومية")}>عرض الكل ←</button></div><div className="empty-state"><span>▤</span><b>لا توجد قيود مرحلة حتى الآن</b><p>ابدأ بإنشاء أول قيد يومي بعد إعداد قاعدة البيانات.</p></div></article><article className="panel quick-panel"><h2>اختصارات سريعة</h2>{["إضافة حساب جديد","تسجيل سند قبض","تسجيل سند صرف","عرض ميزان المراجعة"].map((item) => <button key={item} className="quick-link" onClick={() => setActive(item.includes("ميزان") ? "ميزان المراجعة" : "القيود اليومية")}>{item}<span>←</span></button>)}</article></section>
          </>}

          {active === "القيود اليومية" && <section className="panel"><div className="panel-heading"><div><h2>دفتر القيود اليومية</h2><p>إدارة المسودات والقيود المرحلة</p></div><button className="primary-btn" onClick={() => setShowForm((value) => !value)}>＋ إنشاء قيد</button></div>
            {showForm && <div className="journal-form"><div className="form-head"><h3>قيد يومية جديد <span className="draft-tag">مسودة محلية</span></h3><button className="close-btn" onClick={() => setShowForm(false)}>إغلاق ×</button></div><div className="form-fields"><label>تاريخ القيد<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="description-field">البيان<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="اكتب وصف القيد المحاسبي" /></label></div>
              <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>البيان</th><th>مدين (SAR)</th><th>دائن (SAR)</th><th></th></tr></thead><tbody>{lines.map((line,index) => <tr key={index}><td><select value={line.accountId} onChange={(event) => updateLine(index,"accountId",event.target.value)}>{postingAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}</select></td><td><input value={line.description} onChange={(event) => updateLine(index,"description",event.target.value)} placeholder="بيان السطر" /></td><td><input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(index,"debit",event.target.value)} /></td><td><input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(index,"credit",event.target.value)} /></td><td><button className="remove-line" onClick={() => setLines((current) => current.filter((_,i) => i !== index))} aria-label="حذف السطر">×</button></td></tr>)}</tbody></table></div>
              <button className="add-line" onClick={() => setLines((current) => [...current,{accountId:"1110",debit:"0",credit:"0",description:""}])}>＋ إضافة سطر</button>
              <div className="totals-row"><div><small>إجمالي المدين</small><b>{formatSAR(totals.debit)}</b></div><div><small>إجمالي الدائن</small><b>{formatSAR(totals.credit)}</b></div><div className={balanced ? "balance-ok" : "balance-warn"}><small>حالة التوازن</small><b>{balanced ? "متوازن ✓" : "غير متوازن"}</b></div></div>
              <div className="form-note">هذه شاشة نموذجية محلية؛ الحفظ والترحيل غير مفعلين قبل ربط قاعدة البيانات والمستخدمين.</div>
              <div className="form-actions"><button className="secondary-btn" onClick={() => { setLines([{accountId:"1110",debit:"0",credit:"0",description:""},{accountId:"4100",debit:"0",credit:"0",description:""}]); setDescription(""); }}>مسح النموذج</button><button className="primary-btn" disabled>الحفظ بعد ربط قاعدة البيانات</button></div>
            </div>}
            {!showForm && <div className="empty-state"><span>⇄</span><b>دفتر القيود جاهز للربط</b><p>تم تجهيز نموذج القيد والتحقق الأولي من تساوي المدين والدائن.</p></div>}
          </section>}

          {active !== "لوحة التحكم" && active !== "القيود اليومية" && <section className="panel placeholder-panel"><span>◈</span><h2>{active}</h2><p>تم إدراج هذه الوحدة ضمن هيكل النظام. سيتم تفعيلها بعد استكمال محرك الحسابات وربط قاعدة البيانات.</p></section>}
          <footer className="page-footer"><span>© نظام الشموخ ERP</span><span>الإصدار 0.2.0 · أساس الاستحقاق · القيد المزدوج</span></footer>
        </div>
      </main>
    </div>
  );
}
