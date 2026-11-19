"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Account = { id: string; code: string; name_ar: string; account_class: string; normal_balance: string; is_posting: boolean; is_active: boolean };
type Period = { id: string; name: string; start_date: string; end_date: string };
type Sale = { id: string; sales_date: string; mada_gross: number; cash_gross: number; tabby_gross: number; tamara_gross: number; bank_transfer_gross: number; other_gross: number; discounts: number; returns: number; status: string };
type Allocation = { account_id: string; amount: string };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const money = (value: number) => new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(value);

export default function AutoFinanceSales({ companyId, accounts, fiscalPeriods, hasFiscalYears }: {
  companyId: string; accounts: Account[]; fiscalPeriods: Period[]; hasFiscalYears: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [sales, setSales] = useState<Sale[]>([]);
  const [date, setDate] = useState(today());
  const [mada, setMada] = useState("0");
  const [cash, setCash] = useState("0");
  const [tabby, setTabby] = useState("0");
  const [tamara, setTamara] = useState("0");
  const [bank, setBank] = useState("0");
  const [other, setOther] = useState("0");
  const [discounts, setDiscounts] = useState("0");
  const [returns, setReturns] = useState("0");
  const [periodId, setPeriodId] = useState("");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([{ account_id: "", amount: "" }]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const collected = [mada,cash,tabby,tamara,bank,other].reduce((s,v)=>s+(Number(v)||0),0);
  const grossRevenue = collected + (Number(discounts)||0) + (Number(returns)||0);
  const allocated = allocations.reduce((s,a)=>s+(Number(a.amount)||0),0);
  const balanced = Math.round(grossRevenue*100)===Math.round(allocated*100);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from("daily_sales")
      .select("id,sales_date,mada_gross,cash_gross,tabby_gross,tamara_gross,bank_transfer_gross,other_gross,discounts,returns,status")
      .eq("company_id",companyId).order("sales_date",{ascending:false}).limit(100);
    if (error) setNotice("تعذر تحميل سجل المبيعات: "+error.message);
    else setSales((data ?? []) as Sale[]);
  },[supabase,companyId]);

  useEffect(()=>{ void refresh(); },[refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const values=[mada,cash,tabby,tamara,bank,other,discounts,returns].map(Number);
    if(values.some(v=>!Number.isFinite(v)||v<0||Math.round(v*100)!==v*100)||collected<=0){
      setNotice("أدخل مبالغ صحيحة بدقتين عشريتين، ويجب وجود مبلغ تحصيل واحد على الأقل."); return;
    }
    if(!allocations.length || allocations.some(a=>!a.account_id||!(Number(a.amount)>0)) || !balanced){
      setNotice("وزّع إجمالي الإيراد على حسابات الإيرادات بحيث يساوي التحصيلات مضافاً إليها الخصومات والمردودات."); return;
    }
    if(hasFiscalYears&&!periodId){setNotice("اختر فترة مالية مفتوحة قبل ترحيل المبيعات.");return;}
    setBusy(true);setNotice("");
    const branch=await supabase.from("branches").select("id").eq("company_id",companyId).eq("is_active",true).order("code").limit(1).maybeSingle();
    if(branch.error||!branch.data?.id){setBusy(false);setNotice("تعذر تحديد الفرع النشط.");return;}
    const {error}=await supabase.rpc("record_daily_sale",{
      p_company_id:companyId,p_branch_id:branch.data.id,p_sales_date:date,
      p_mada_gross:Number(mada),p_cash_gross:Number(cash),p_tabby_gross:Number(tabby),
      p_tamara_gross:Number(tamara),p_bank_transfer_gross:Number(bank),p_other_gross:Number(other),
      p_discounts:Number(discounts),p_returns:Number(returns),
      p_allocations:allocations.map(a=>({account_id:a.account_id,amount:Number(a.amount)})),
      p_notes:notes.trim()||null,p_fiscal_period_id:periodId||null
    });
    setBusy(false);
    if(error){setNotice("تعذر تسجيل المبيعات: "+error.message);return;}
    setNotice("تم تسجيل المبيعات وترحيل القيد المحاسبي بنجاح.");
    setMada("0");setCash("0");setTabby("0");setTamara("0");setBank("0");setOther("0");
    setDiscounts("0");setReturns("0");setNotes("");setAllocations([{account_id:"",amount:""}]);setShowForm(false);
    await refresh();
  }

  const amountField=(label:string,value:string,set:(v:string)=>void)=><label>{label}<input type="number" min="0" step="0.01" value={value} onChange={e=>set(e.target.value)} /></label>;

  return <>
    <div className="af-page-heading"><div><span className="af-eyebrow">الحركة التشغيلية</span><h1>المبيعات اليومية</h1><p>تسجيل التحصيلات وتوزيع الإيرادات مع إنشاء القيد وترحيله بصورة ذرية.</p></div><button className="af-primary" onClick={()=>setShowForm(v=>!v)}>＋ تسجيل مبيعات</button></div>
    {notice&&<div className="af-inline-notice">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
    {showForm&&<section className="af-panel af-entry-form">
      <div className="af-panel-head"><div><h2>ملخص المبيعات والتحصيلات</h2><p>أدخل صافي المبالغ المحصلة لكل وسيلة، ثم سجل الخصومات والمردودات.</p></div><button className="af-icon-button" onClick={()=>setShowForm(false)}>×</button></div>
      <form onSubmit={save}>
        <div className="af-form-grid">
          <label>تاريخ المبيعات<input type="date" required value={date} onChange={e=>setDate(e.target.value)} /></label>
          {hasFiscalYears&&<label>الفترة المالية<select required value={periodId} onChange={e=>setPeriodId(e.target.value)}><option value="">اختر فترة مفتوحة</option>{fiscalPeriods.map(p=><option key={p.id} value={p.id}>{p.name} ({p.start_date} – {p.end_date})</option>)}</select></label>}
          {amountField("نقداً — الصندوق",cash,setCash)}
          {amountField("مدى — قيد التسوية",mada,setMada)}
          {amountField("تابي — قيد التسوية",tabby,setTabby)}
          {amountField("تمارا — قيد التسوية",tamara,setTamara)}
          {amountField("تحويل بنكي",bank,setBank)}
          {amountField("وسائل دفع أخرى",other,setOther)}
          {amountField("خصومات المبيعات",discounts,setDiscounts)}
          {amountField("مردودات المبيعات",returns,setReturns)}
          <label className="af-wide">ملاحظات<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} /></label>
        </div>
        <div className="af-entry-totals"><span>إجمالي التحصيلات <b>{money(collected)}</b></span><span>إجمالي الإيراد قبل الخصم/المرتجع <b>{money(grossRevenue)}</b></span><span>الموزع على الإيرادات <b>{money(allocated)}</b></span><span className={balanced?"balanced":"unbalanced"}>{balanced?"✓ التوزيع متوازن":"• التوزيع غير مكتمل"}</span></div>
        <div className="af-panel-head"><div><h2>توزيع الإيرادات</h2><p>وزع إجمالي الإيراد على حساب أو أكثر.</p></div><button type="button" className="af-add-line" onClick={()=>setAllocations(v=>[...v,{account_id:"",amount:""}])}>＋ إضافة حساب</button></div>
        <div className="af-table-wrap"><table className="af-lines-table"><thead><tr><th>حساب الإيراد</th><th>المبلغ (ر.س)</th><th></th></tr></thead><tbody>{allocations.map((a,i)=><tr key={i}><td><select required value={a.account_id} onChange={e=>setAllocations(v=>v.map((x,j)=>j===i?{...x,account_id:e.target.value}:x))}><option value="">اختر حساب الإيراد</option>{accounts.map(ac=><option key={ac.id} value={ac.id}>{ac.code} — {ac.name_ar}</option>)}</select></td><td><input type="number" min="0.01" step="0.01" required value={a.amount} onChange={e=>setAllocations(v=>v.map((x,j)=>j===i?{...x,amount:e.target.value}:x))}/></td><td><button type="button" className="af-remove-line" disabled={allocations.length===1} onClick={()=>setAllocations(v=>v.filter((_,j)=>j!==i))}>×</button></td></tr>)}</tbody></table></div>
        {hasFiscalYears&&fiscalPeriods.length===0&&<p className="af-inline-notice">لا توجد فترة مالية مفتوحة؛ لا يمكن ترحيل المبيعات.</p>}
        <div className="af-form-actions"><button className="af-secondary" type="button" onClick={()=>setShowForm(false)}>إلغاء</button><button className="af-primary" type="submit" disabled={busy||!balanced||(hasFiscalYears&&!periodId)}>{busy?"جارٍ الترحيل…":"حفظ المبيعات وترحيل القيد"}</button></div>
      </form>
    </section>}
    <section className="af-panel"><div className="af-panel-head"><div><h2>سجل المبيعات اليومية</h2><p>{sales.length.toLocaleString("ar-SA")} سجل ضمن أحدث السجلات</p></div><button className="af-text-button" onClick={()=>void refresh()} disabled={busy}>تحديث البيانات ↻</button></div>
      {sales.length?<div className="af-table-wrap"><table><thead><tr><th>التاريخ</th><th>التحصيلات</th><th>الخصومات</th><th>المردودات</th><th>الإجمالي قبل الخصم/المرتجع</th><th>الحالة</th></tr></thead><tbody>{sales.map(s=>{const total=Number(s.mada_gross)+Number(s.cash_gross)+Number(s.tabby_gross)+Number(s.tamara_gross)+Number(s.bank_transfer_gross)+Number(s.other_gross);return <tr key={s.id}><td>{s.sales_date}</td><td className="af-code">{money(total)}</td><td className="af-code">{money(Number(s.discounts))}</td><td className="af-code">{money(Number(s.returns))}</td><td className="af-code">{money(total+Number(s.discounts)+Number(s.returns))}</td><td><span className="af-status posted">{s.status==="posted"?"مرحّل":s.status}</span></td></tr>})}</tbody></table></div>:<div className="af-empty"><b>لا توجد مبيعات مسجلة</b><p>ستظهر هنا ملخصات المبيعات اليومية بعد تسجيلها.</p></div>}
    </section>
  </>;
}
