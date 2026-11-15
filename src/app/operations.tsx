"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Props = { supabase: any; companyId: string; appUserId: string | null };
const tabs = ["الأصناف والمخزون", "العملاء والموردون", "المبيعات", "المشتريات", "المرتجعات", "الصندوق والبنوك", "المصروفات", "الأصول الثابتة"] as const;
type Tab = typeof tabs[number];

export default function Operations({ supabase, companyId, appUserId }: Props) {
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [ledgerAccounts,setLedgerAccounts]=useState<any[]>([]);
  const [cashTransactions, setCashTransactions] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]); const [assetBalances,setAssetBalances]=useState<any[]>([]);
  const [salesReturnLines,setSalesReturnLines]=useState<any[]>([]); const [purchaseReturnLines,setPurchaseReturnLines]=useState<any[]>([]); const [salesReturns,setSalesReturns]=useState<any[]>([]); const [purchaseReturns,setPurchaseReturns]=useState<any[]>([]);
  const [returnKind,setReturnKind]=useState<"sales"|"purchase">("sales"); const [returnLine,setReturnLine]=useState(""); const [returnWarehouse,setReturnWarehouse]=useState(""); const [returnNo,setReturnNo]=useState(""); const [returnQty,setReturnQty]=useState("1"); const [returnReason,setReturnReason]=useState(""); const [returnDate,setReturnDate]=useState(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [partyCode,setPartyCode]=useState(""); const [partyName,setPartyName]=useState(""); const [partyType,setPartyType]=useState("customer"); const [partyPhone,setPartyPhone]=useState(""); const [partyTax,setPartyTax]=useState("");
  const [sku, setSku] = useState(""); const [productName, setProductName] = useState("");
  const [barcode, setBarcode] = useState(""); const [unit, setUnit] = useState("حبة");
  const [purchasePrice, setPurchasePrice] = useState("0"); const [salePrice, setSalePrice] = useState("0");
  const [vatRate, setVatRate] = useState("0"); const [minStock, setMinStock] = useState("0");
  const [warehouseCode, setWarehouseCode] = useState(""); const [warehouseName, setWarehouseName] = useState("");
  const [movementProduct, setMovementProduct] = useState(""); const [movementWarehouse, setMovementWarehouse] = useState("");
  const [movementQty, setMovementQty] = useState(""); const [movementCost, setMovementCost] = useState("");
  const [movementKind, setMovementKind] = useState("opening"); const [batch, setBatch] = useState(""); const [expiry, setExpiry] = useState("");
  const [invoiceNo, setInvoiceNo] = useState(""); const [invoiceParty, setInvoiceParty] = useState("");
  const [invoiceWarehouse, setInvoiceWarehouse] = useState(""); const [invoiceProduct, setInvoiceProduct] = useState("");
  const [invoiceQty, setInvoiceQty] = useState("1"); const [invoicePrice, setInvoicePrice] = useState("0");
  const [invoiceVat, setInvoiceVat] = useState("0"); const [invoiceDate, setInvoiceDate] = useState(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10));
  const [cashCode, setCashCode] = useState(""); const [cashName, setCashName] = useState(""); const [cashType, setCashType] = useState("cash");
  const [cashAccount, setCashAccount] = useState(""); const [cashAmount, setCashAmount] = useState(""); const [cashKind, setCashKind] = useState("receipt"); const [cashDescription, setCashDescription] = useState("");
  const [cashLedgerAccount,setCashLedgerAccount]=useState(""); const [cashContraAccount,setCashContraAccount]=useState(""); const [cashDate,setCashDate]=useState(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)); const [cashReference,setCashReference]=useState(""); const [cashParty,setCashParty]=useState("");
  const [expenseNo, setExpenseNo] = useState(""); const [expenseCategory, setExpenseCategory] = useState(""); const [expenseDescription, setExpenseDescription] = useState(""); const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate,setExpenseDate]=useState(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)); const [expenseVat,setExpenseVat]=useState("0"); const [expenseCashAccount,setExpenseCashAccount]=useState(""); const [expenseLedgerAccount,setExpenseLedgerAccount]=useState(""); const [expenseCostCenter,setExpenseCostCenter]=useState("");
  const [assetCode, setAssetCode] = useState(""); const [assetName, setAssetName] = useState(""); const [assetDate, setAssetDate] = useState(new Date().toISOString().slice(0,10)); const [assetCost, setAssetCost] = useState(""); const [assetLife, setAssetLife] = useState("60"); const [assetResidual, setAssetResidual] = useState("0"); const [depreciationAsset,setDepreciationAsset]=useState(""); const [depreciationMonth,setDepreciationMonth]=useState(new Date().toISOString().slice(0,7));

  const refresh = useCallback(async () => {
    const results = await Promise.all([
      supabase.from("products").select("id,sku,barcode,name_ar,unit,purchase_price,sale_price,vat_rate,min_stock,is_active").eq("company_id",companyId).order("sku"),
      supabase.from("warehouses").select("id,code,name_ar,is_active").eq("company_id",companyId).order("code"),
      supabase.from("stock_on_hand").select("*").eq("company_id",companyId).order("product_name"),
      supabase.from("sales_invoices").select("id,invoice_number,invoice_date,grand_total,status,journal_entry_id").eq("company_id",companyId).order("invoice_date",{ascending:false}).limit(50),
      supabase.from("purchase_invoices").select("id,invoice_number,invoice_date,grand_total,status,journal_entry_id").eq("company_id",companyId).order("invoice_date",{ascending:false}).limit(50),
      supabase.from("cash_accounts").select("id,code,name_ar,account_type,opening_balance,ledger_account_id").eq("company_id",companyId).order("code"),
      supabase.from("accounts").select("id,code,name_ar,is_active,is_posting").eq("company_id",companyId).eq("is_active",true).eq("is_posting",true).order("code"),
      supabase.from("cash_transactions").select("id,transaction_date,transaction_type,amount,description,status,journal_entry_id").eq("company_id",companyId).order("transaction_date",{ascending:false}).limit(50),
      supabase.from("expenses").select("id,expense_number,expense_date,category,description,amount,vat_amount,status,journal_entry_id,expense_account_id,cash_account_id,cost_center_id").eq("company_id",companyId).order("expense_date",{ascending:false}).limit(50),
      supabase.from("fixed_assets").select("id,asset_code,name_ar,acquisition_date,acquisition_cost,useful_life_months,residual_value,is_active").eq("company_id",companyId).order("asset_code"),
      supabase.from("fixed_asset_balances").select("asset_id,accumulated_depreciation,net_book_value").eq("company_id",companyId),
      supabase.from("sales_invoice_lines").select("id,invoice_id,product_id,description,quantity,unit_price,vat_rate,line_total,sales_invoices!inner(invoice_number,status)").eq("company_id",companyId).eq("sales_invoices.status","posted"),
      supabase.from("purchase_invoice_lines").select("id,invoice_id,product_id,description,quantity,unit_cost,vat_rate,line_total,purchase_invoices!inner(invoice_number,status)").eq("company_id",companyId).eq("purchase_invoices.status","posted"),
      supabase.from("sales_returns").select("id,return_number,return_date,quantity,grand_total,status,journal_entry_id").eq("company_id",companyId).order("created_at",{ascending:false}).limit(50),
      supabase.from("purchase_returns").select("id,return_number,return_date,quantity,grand_total,status,journal_entry_id").eq("company_id",companyId).order("created_at",{ascending:false}).limit(50),
      supabase.from("cost_centers").select("id,code,name_ar,is_active").eq("company_id",companyId).eq("is_active",true).order("code"),
    ]);
    const error = results.find(x => x.error)?.error;
    if (error) setNotice(error.message);
    setProducts(results[0].data ?? []); setWarehouses(results[1].data ?? []); setStock(results[2].data ?? []);
    setSales(results[3].data ?? []); setPurchases(results[4].data ?? []); setCashAccounts(results[5].data ?? []);
    setCashTransactions(results[7].data ?? []); setExpenses(results[8].data ?? []); setAssets(results[9].data ?? []);
    setAssetBalances(results[10].data??[]); setLedgerAccounts(results[6].data??[]);
    setSalesReturnLines(results[10].data??[]); setPurchaseReturnLines(results[11].data??[]); setSalesReturns(results[12].data??[]); setPurchaseReturns(results[13].data??[]); setCostCenters(results[14].data??[]);
  }, [supabase,companyId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent, work: () => Promise<any>, success: string) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const result = await work();
      if (result?.error) throw result.error;
      setNotice(success); await refresh();
    } catch (e: any) { setNotice(e?.message ?? "تعذر إتمام العملية."); }
    finally { setBusy(false); }
  }

  async function postInvoice(kind: "sales"|"purchase", invoiceId: string) {
    if (!window.confirm("سيتم ترحيل الفاتورة وإنشاء القيد المحاسبي وحركة المخزون، ولا يمكن تعديلها بعد الترحيل. هل تريد المتابعة؟")) return;
    setBusy(true); setNotice("");
    try {
      const rpc=kind==="sales"?"post_sales_invoice":"post_purchase_invoice";
      const result=await supabase.rpc(rpc,{p_invoice_id:invoiceId});
      if(result.error) throw result.error;
      setNotice("تم ترحيل الفاتورة وإنشاء القيد وحركة المخزون بنجاح.");
      await refresh();
    } catch(e:any) { setNotice(e?.message??"تعذر ترحيل الفاتورة."); }
    finally { setBusy(false); }
  }
  const saveProduct = (e: FormEvent) => submit(e, async () => {
    if (!sku.trim() || !productName.trim()) throw new Error("رمز الصنف واسمه مطلوبان.");
    const r = await supabase.from("products").insert({company_id:companyId,sku:sku.trim(),barcode:barcode.trim()||null,name_ar:productName.trim(),unit,purchase_price:Number(purchasePrice),sale_price:Number(salePrice),vat_rate:Number(vatRate),min_stock:Number(minStock)});
    if (!r.error) {setSku("");setProductName("");setBarcode("");}
    return r;
  },"تم حفظ الصنف.");
  const saveParty = (e: FormEvent) => submit(e, async () => {
    if(!partyCode.trim()||!partyName.trim()) throw new Error("رمز العميل/المورد واسمه مطلوبان.");
    const r=await supabase.from("parties").insert({company_id:companyId,code:partyCode.trim(),name:partyName.trim(),party_type:partyType,phone:partyPhone.trim()||null,tax_number:partyTax.trim()||null});
    if(!r.error){setPartyCode("");setPartyName("");setPartyPhone("");setPartyTax("");}
    return r;
  },"تم حفظ العميل/المورد.");
  const saveWarehouse = (e: FormEvent) => submit(e, async () => {
    const r=await supabase.from("warehouses").insert({company_id:companyId,code:warehouseCode.trim(),name_ar:warehouseName.trim()});
    if(!r.error){setWarehouseCode("");setWarehouseName("");} return r;
  },"تم حفظ المستودع.");
  const saveMovement = (e: FormEvent) => submit(e, async () => {
    const qty=Number(movementQty); if(!movementProduct||!movementWarehouse||qty<=0) throw new Error("اختر الصنف والمستودع وأدخل كمية صحيحة.");
    const incoming=["opening","purchase","sale_return","transfer_in"].includes(movementKind);
    const r=await supabase.from("stock_movements").insert({company_id:companyId,product_id:movementProduct,warehouse_id:movementWarehouse,movement_type:movementKind,quantity_in:incoming?qty:0,quantity_out:incoming?0:qty,unit_cost:Number(movementCost)||0,batch_number:batch||null,expiry_date:expiry||null,created_by:appUserId});
    if(!r.error){setMovementQty("");setMovementCost("");setBatch("");setExpiry("");} return r;
  },"تم تسجيل حركة المخزون. راجع أثرها على الرصيد.");
  const saveInvoice = (kind: "sales"|"purchase") => (e: FormEvent) => submit(e, async () => {
    const product=products.find(p=>p.id===invoiceProduct);
    const qty=Number(invoiceQty); const price=Number(invoicePrice); const rate=Number(invoiceVat);
    if(!invoiceNo.trim()||!product||!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0||!Number.isFinite(rate)||rate<0||rate>100)
      throw new Error("أكمل رقم الفاتورة والصنف والكمية والسعر ونسبة الضريبة بشكل صحيح.");
    if(kind==="purchase"&&!invoiceWarehouse) throw new Error("اختر المستودع لفاتورة الشراء.");

    const rpcName=kind==="sales"?"create_sales_invoice_draft":"create_purchase_invoice_draft";
    const common={
      p_company_id:companyId,
      p_invoice_number:invoiceNo.trim(),
      p_invoice_date:invoiceDate,
      p_product_id:product.id,
      p_quantity:qty,
      p_vat_rate:rate,
    };
    const params=kind==="sales"
      ? {...common,p_customer_id:invoiceParty||null,p_unit_price:price}
      : {...common,p_supplier_id:invoiceParty||null,p_warehouse_id:invoiceWarehouse,p_unit_cost:price};
    const result=await supabase.rpc(rpcName,params);
    if(!result.error){setInvoiceNo("");setInvoiceQty("1");}
    return result;
  },kind==="sales"?"تم حفظ مسودة فاتورة البيع مع تفاصيلها ذرياً. لم يتم ترحيلها محاسبياً.":"تم حفظ مسودة فاتورة الشراء مع تفاصيلها ذرياً. لم يتم ترحيلها محاسبياً.");
  const saveReturn=(e:FormEvent)=>submit(e,async()=>{
    const line=(returnKind==="sales"?salesReturnLines:purchaseReturnLines).find(x=>x.id===returnLine);
    const qty=Number(returnQty); if(!line||!returnNo.trim()||!returnReason.trim()||!Number.isFinite(qty)||qty<=0) throw new Error("أكمل رقم المرتجع والفاتورة الأصلية والكمية والسبب.");
    if(returnKind==="sales"&&!returnWarehouse) throw new Error("اختر المستودع الذي ستُعاد إليه البضاعة.");
    const rpc=returnKind==="sales"?"create_sales_return_draft":"create_purchase_return_draft";
    const params=returnKind==="sales"?{p_company_id:companyId,p_return_number:returnNo.trim(),p_return_date:returnDate,p_original_line_id:line.id,p_warehouse_id:returnWarehouse,p_quantity:qty,p_reason:returnReason.trim()}:{p_company_id:companyId,p_return_number:returnNo.trim(),p_return_date:returnDate,p_original_line_id:line.id,p_quantity:qty,p_reason:returnReason.trim()};
    const r=await supabase.rpc(rpc,params); if(!r.error){setReturnNo("");setReturnQty("1");setReturnReason("");setReturnLine("");} return r;
  }, "تم حفظ مسودة المرتجع. لم يتم تغيير المخزون أو الحسابات حتى الترحيل.");
  async function postReturn(kind:"sales"|"purchase",id:string){if(!window.confirm("سيتم ترحيل المرتجع وعكس الأثر المحاسبي وتحديث المخزون. هل تريد المتابعة؟"))return;setBusy(true);setNotice("");try{const r=await supabase.rpc(kind==="sales"?"post_sales_return":"post_purchase_return",{p_return_id:id});if(r.error)throw r.error;setNotice("تم ترحيل المرتجع وإنشاء القيد وحركة المخزون.");await refresh();}catch(e:any){setNotice(e?.message??"تعذر ترحيل المرتجع.");}finally{setBusy(false);}}

  const saveCashAccount = (e: FormEvent) => submit(e, async()=>{if(!cashLedgerAccount)throw new Error("اربط الصندوق أو البنك بحساب دليل الحسابات.");const r=await supabase.from("cash_accounts").insert({company_id:companyId,code:cashCode.trim(),name_ar:cashName.trim(),account_type:cashType,ledger_account_id:cashLedgerAccount});if(!r.error){setCashCode("");setCashName("");setCashLedgerAccount("");}return r;},"تم حفظ حساب الصندوق/البنك.");
  const saveCashTransaction = (e: FormEvent) => submit(e,async()=>{if(!cashAccount||Number(cashAmount)<=0)throw new Error("اختر الحساب وأدخل مبلغاً صحيحاً.");if(!cashContraAccount)throw new Error("اختر الحساب المقابل للحركة.");const r=await supabase.from("cash_transactions").insert({company_id:companyId,cash_account_id:cashAccount,transaction_type:cashKind,transaction_date:cashDate,amount:Number(cashAmount),description:cashDescription.trim(),reference:cashReference.trim()||null,contra_account_id:cashContraAccount,party_id:cashParty||null,status:"draft",created_by:appUserId});if(!r.error){setCashAmount("");setCashDescription("");setCashReference("");setCashParty("");}return r;},"تم حفظ مسودة حركة الصندوق.");
  async function postCashTransaction(id:string){if(!window.confirm("سيتم إنشاء قيد محاسبي وترحيل حركة الصندوق/البنك. هل تريد المتابعة؟"))return;setBusy(true);setNotice("");try{const r=await supabase.rpc("post_cash_transaction",{p_transaction_id:id});if(r.error)throw r.error;setNotice("تم ترحيل الحركة وإنشاء القيد المحاسبي.");await refresh();}catch(e:any){setNotice(e?.message??"تعذر ترحيل الحركة.");}finally{setBusy(false);}}
  const saveExpense = (e: FormEvent) => submit(e,async()=>{const amount=Number(expenseAmount),vat=Number(expenseVat);if(!expenseNo.trim()||!expenseCategory.trim()||!expenseDescription.trim()||!expenseCashAccount||!expenseLedgerAccount||!Number.isFinite(amount)||amount<=0||!Number.isFinite(vat)||vat<0)throw new Error("أكمل بيانات المصروف والحسابات وأدخل مبلغاً وضريبة صحيحين.");const r=await supabase.from("expenses").insert({company_id:companyId,expense_number:expenseNo.trim(),expense_date:expenseDate,category:expenseCategory.trim(),description:expenseDescription.trim(),amount,vat_amount:vat,cash_account_id:expenseCashAccount,expense_account_id:expenseLedgerAccount,cost_center_id:expenseCostCenter||null,status:"draft",created_by:appUserId});if(!r.error){setExpenseNo("");setExpenseCategory("");setExpenseDescription("");setExpenseAmount("");setExpenseVat("0");}return r;},"تم حفظ المصروف كمسودة. لم يُنشأ القيد بعد.");
  async function postExpense(id:string){if(!window.confirm("سيتم ترحيل المصروف وإنشاء قيد مدين للمصروف والضريبة (إن وجدت) ودائن للصندوق/البنك. لا يمكن تعديل المصروف بعد الترحيل. هل تريد المتابعة؟"))return;setBusy(true);setNotice("");try{const r=await supabase.rpc("post_expense",{p_expense_id:id});if(r.error)throw r.error;setNotice("تم ترحيل المصروف وإنشاء القيد المحاسبي.");await refresh();}catch(e:any){setNotice(e?.message??"تعذر ترحيل المصروف.");}finally{setBusy(false);}}
  const saveAsset = (e: FormEvent) => submit(e,async()=>{const cost=Number(assetCost),residual=Number(assetResidual),life=Number(assetLife);if(!assetCode.trim()||!assetName.trim()||!Number.isFinite(cost)||cost<=0||!Number.isInteger(life)||life<1||!Number.isFinite(residual)||residual<0||residual>cost)throw new Error("تحقق من رمز الأصل واسمه والتكلفة والعمر والقيمة المتبقية.");const r=await supabase.from("fixed_assets").insert({company_id:companyId,asset_code:assetCode.trim(),name_ar:assetName.trim(),acquisition_date:assetDate,acquisition_cost:cost,useful_life_months:life,residual_value:residual});if(!r.error){setAssetCode("");setAssetName("");setAssetCost("");}return r;},"تم تسجيل الأصل الثابت.");
  async function postAssetDepreciation(){if(!depreciationAsset||!/^\\d{4}-\\d{2}$/.test(depreciationMonth)){setNotice("اختر الأصل وشهر الإهلاك.");return;}const [year,month]=depreciationMonth.split("-").map(Number);const start=`${depreciationMonth}-01`;const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);if(!window.confirm(`سيتم إنشاء قيد إهلاك للأصل عن ${depreciationMonth}. هل تريد المتابعة؟`))return;setBusy(true);setNotice("");try{const r=await supabase.rpc("post_asset_depreciation",{p_asset_id:depreciationAsset,p_period_start:start,p_period_end:end});if(r.error)throw r.error;setNotice("تم ترحيل إهلاك الأصل وربطه بالقيد المحاسبي.");await refresh();}catch(e:any){setNotice(e?.message??"تعذر ترحيل إهلاك الأصل.");}finally{setBusy(false);}}

  const parties = async (type: "customer"|"supplier") => {
    const r=await supabase.from("parties").select("id,name,party_type").eq("company_id",companyId).eq("is_active",true).in("party_type",[type,"both"]).order("name");
    return r.data ?? [];
  };
  const [customers,setCustomers]=useState<any[]>([]); const [suppliers,setSuppliers]=useState<any[]>([]);
  useEffect(()=>{void Promise.all([parties("customer"),parties("supplier")]).then(([c,s])=>{setCustomers(c);setSuppliers(s);});},[companyId]);

  const [allParties,setAllParties]=useState<any[]>([]);
  useEffect(()=>{void supabase.from("parties").select("id,code,name,party_type,phone,tax_number,is_active").eq("company_id",companyId).order("code").then((r:any)=>{if(!r.error)setAllParties(r.data??[]);});},[supabase,companyId,customers.length,suppliers.length]);

  return <section className="panel">
    <div className="panel-heading"><div><h2>إدارة العمليات</h2><p>المخزون والفواتير والنقدية والمصروفات والأصول</p></div></div>
    <div className="ops-tabs">{tabs.map(t=><button key={t} className={tab===t?"primary-btn":"secondary-btn"} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {notice&&<p className="notice">{notice}</p>}
    {tab==="العملاء والموردون"&&<><h3>إضافة عميل أو مورد</h3><form className="journal-form" onSubmit={saveParty}><div className="form-fields"><label>الرمز<input required value={partyCode} onChange={e=>setPartyCode(e.target.value)}/></label><label>الاسم<input required value={partyName} onChange={e=>setPartyName(e.target.value)}/></label><label>النوع<select value={partyType} onChange={e=>setPartyType(e.target.value)}><option value="customer">عميل</option><option value="supplier">مورد</option><option value="both">عميل ومورد</option></select></label><label>الهاتف<input value={partyPhone} onChange={e=>setPartyPhone(e.target.value)}/></label><label>الرقم الضريبي<input value={partyTax} onChange={e=>setPartyTax(e.target.value)}/></label></div><button className="primary-btn" disabled={busy}>حفظ</button></form><h3>دليل العملاء والموردين ({allParties.length})</h3><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>الرقم الضريبي</th><th>الحالة</th></tr></thead><tbody>{allParties.map(p=><tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.party_type==="customer"?"عميل":p.party_type==="supplier"?"مورد":"عميل ومورد"}</td><td>{p.phone||"—"}</td><td>{p.tax_number||"—"}</td><td>{p.is_active?"نشط":"موقوف"}</td></tr>)}</tbody></table></div></>}
    {tab==="الأصناف والمخزون"&&<>
      <h3>إضافة صنف</h3><form className="journal-form" onSubmit={saveProduct}><div className="form-fields">
        <label>رمز الصنف<input required value={sku} onChange={e=>setSku(e.target.value)}/></label><label>اسم الصنف<input required value={productName} onChange={e=>setProductName(e.target.value)}/></label><label>الباركود<input value={barcode} onChange={e=>setBarcode(e.target.value)}/></label><label>الوحدة<input value={unit} onChange={e=>setUnit(e.target.value)}/></label>
        <label>سعر الشراء<input type="number" min="0" step="0.0001" value={purchasePrice} onChange={e=>setPurchasePrice(e.target.value)}/></label><label>سعر البيع<input type="number" min="0" step="0.0001" value={salePrice} onChange={e=>setSalePrice(e.target.value)}/></label><label>الضريبة %<input type="number" min="0" max="100" step="0.01" value={vatRate} onChange={e=>setVatRate(e.target.value)}/></label><label>حد إعادة الطلب<input type="number" min="0" value={minStock} onChange={e=>setMinStock(e.target.value)}/></label>
      </div><button className="primary-btn" disabled={busy}>حفظ الصنف</button></form>
      <h3>المستودعات</h3><form className="journal-form" onSubmit={saveWarehouse}><div className="form-fields"><label>رمز المستودع<input required value={warehouseCode} onChange={e=>setWarehouseCode(e.target.value)}/></label><label>اسم المستودع<input required value={warehouseName} onChange={e=>setWarehouseName(e.target.value)}/></label><button className="primary-btn" disabled={busy}>إضافة مستودع</button></div></form>
      <h3>تسجيل حركة مخزون يدوية</h3><form className="journal-form" onSubmit={saveMovement}><div className="form-fields">
        <label>الصنف<select required value={movementProduct} onChange={e=>setMovementProduct(e.target.value)}><option value="">اختر الصنف</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name_ar}</option>)}</select></label>
        <label>المستودع<select required value={movementWarehouse} onChange={e=>setMovementWarehouse(e.target.value)}><option value="">اختر المستودع</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name_ar}</option>)}</select></label>
        <label>نوع الحركة<select value={movementKind} onChange={e=>setMovementKind(e.target.value)}><option value="opening">رصيد افتتاحي</option><option value="adjustment">تسوية جرد</option><option value="purchase">وارد شراء</option><option value="sale">صادر بيع</option><option value="purchase_return">مرتجع شراء</option><option value="sale_return">مرتجع بيع</option></select></label>
        <label>الكمية<input required type="number" min="0.001" step="0.001" value={movementQty} onChange={e=>setMovementQty(e.target.value)}/></label><label>تكلفة الوحدة<input type="number" min="0" step="0.0001" value={movementCost} onChange={e=>setMovementCost(e.target.value)}/></label><label>رقم التشغيلة<input value={batch} onChange={e=>setBatch(e.target.value)}/></label><label>تاريخ الصلاحية<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
      </div><button className="primary-btn" disabled={busy}>تسجيل الحركة</button></form>
      <h3>الأرصدة الحالية</h3><div className="table-wrap"><table><thead><tr><th>الصنف</th><th>المستودع</th><th>الكمية</th><th>متوسط التكلفة</th></tr></thead><tbody>{stock.map((r,i)=><tr key={i}><td>{r.sku} — {r.product_name}</td><td>{r.warehouse_name}</td><td>{r.quantity_on_hand}</td><td>{Number(r.weighted_unit_cost||0).toFixed(4)}</td></tr>)}</tbody></table></div>
      <h3>الأصناف المسجلة ({products.length})</h3><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>باركود</th><th>شراء</th><th>بيع</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td>{p.sku}</td><td>{p.name_ar}</td><td>{p.barcode||"—"}</td><td>{p.purchase_price}</td><td>{p.sale_price}</td></tr>)}</tbody></table></div>
    </>}
    {(tab==="المبيعات"||tab==="المشتريات")&&<><h3>{tab==="المبيعات"?"إنشاء مسودة فاتورة بيع":"إنشاء مسودة فاتورة شراء"}</h3><p className="notice">احفظ الفاتورة كمسودة ثم راجعها واضغط «ترحيل» لإنشاء القيد المحاسبي وحركة المخزون آلياً. ربط ZATCA غير مفعّل.</p>
      <form className="journal-form" onSubmit={saveInvoice(tab==="المبيعات"?"sales":"purchase")}><div className="form-fields">
        <label>رقم الفاتورة<input required value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)}/></label><label>التاريخ<input lang="ar-YE" dir="rtl" type="date" required value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)}/></label>
        <label>{tab==="المبيعات"?"العميل":"المورد (اختياري)"}<select value={invoiceParty} onChange={e=>setInvoiceParty(e.target.value)}><option value="">{tab==="المبيعات"?"بيع نقدي — بدون عميل":"شراء نقدي — بدون مورد"}</option>{(tab==="المبيعات"?customers:suppliers).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {tab==="المشتريات"&&<label>المستودع<select required value={invoiceWarehouse} onChange={e=>setInvoiceWarehouse(e.target.value)}><option value="">اختر المستودع</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name_ar}</option>)}</select></label>}
        <label>الصنف<select required value={invoiceProduct} onChange={e=>{setInvoiceProduct(e.target.value);const p=products.find(x=>x.id===e.target.value);if(p){setInvoicePrice(String(tab==="المبيعات"?p.sale_price:p.purchase_price));setInvoiceVat(String(p.vat_rate));}}}><option value="">اختر الصنف</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name_ar}</option>)}</select></label>
        <label>الكمية<input required type="number" min="0.001" step="0.001" value={invoiceQty} onChange={e=>setInvoiceQty(e.target.value)}/></label><label>سعر الوحدة<input required type="number" min="0" step="0.0001" value={invoicePrice} onChange={e=>setInvoicePrice(e.target.value)}/></label><label>الضريبة %<input type="number" min="0" max="100" step="0.01" value={invoiceVat} onChange={e=>setInvoiceVat(e.target.value)}/></label>
      </div><button className="primary-btn" disabled={busy}>حفظ مسودة الفاتورة</button></form>
      <h3>الفواتير المحفوظة</h3><div className="table-wrap"><table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th>القيد المرتبط</th><th>الإجراء</th></tr></thead><tbody>{(tab==="المبيعات"?sales:purchases).map(r=><tr key={r.id}><td>{r.invoice_number}</td><td>{r.invoice_date?new Date(`${r.invoice_date}T00:00:00`).toLocaleDateString("ar-YE",{year:"numeric",month:"2-digit",day:"2-digit"}):"—"}</td><td>{Number(r.grand_total).toFixed(2)}</td><td>{r.status==="posted"?"مرحّلة":r.status==="cancelled"?"ملغاة":"مسودة"}</td><td>{r.journal_entry_id||"—"}</td><td>{r.status==="draft"?<button type="button" className="primary-btn" disabled={busy} onClick={()=>void postInvoice(tab==="المبيعات"?"sales":"purchase",r.id)}>ترحيل</button>:"—"}</td></tr>)}</tbody></table></div>
    </>}
    {tab==="المرتجعات"&&<><h3>إنشاء مرتجع مبيعات أو مشتريات</h3><p className="notice">المرتجع مرتبط ببند فاتورة أصلية مُرحّلة. لا يمكن تجاوز الكمية الأصلية، وتُحدّث الحسابات والمخزون عند الترحيل فقط.</p><form className="journal-form" onSubmit={saveReturn}><div className="form-fields">
      <label>نوع المرتجع<select value={returnKind} onChange={e=>{setReturnKind(e.target.value as "sales"|"purchase");setReturnLine("");}}><option value="sales">مرتجع مبيعات (من عميل)</option><option value="purchase">مرتجع مشتريات (إلى مورد)</option></select></label>
      <label>رقم المرتجع<input required value={returnNo} onChange={e=>setReturnNo(e.target.value)}/></label><label>التاريخ<input type="date" required value={returnDate} onChange={e=>setReturnDate(e.target.value)}/></label>
      <label>بند الفاتورة الأصلية<select required value={returnLine} onChange={e=>setReturnLine(e.target.value)}><option value="">اختر بنداً من فاتورة مرحلة</option>{(returnKind==="sales"?salesReturnLines:purchaseReturnLines).map(l=><option key={l.id} value={l.id}>{l.sales_invoices?.invoice_number||l.purchase_invoices?.invoice_number} — {l.description} — الكمية الأصلية: {l.quantity}</option>)}</select></label>
      {returnKind==="sales"&&<label>مستودع إعادة البضاعة<select required value={returnWarehouse} onChange={e=>setReturnWarehouse(e.target.value)}><option value="">اختر المستودع</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name_ar}</option>)}</select></label>}
      <label>الكمية المرتجعة<input type="number" required min="0.001" step="0.001" value={returnQty} onChange={e=>setReturnQty(e.target.value)}/></label><label>سبب المرتجع<input required value={returnReason} onChange={e=>setReturnReason(e.target.value)}/></label>
    </div><button className="primary-btn" disabled={busy}>حفظ مسودة المرتجع</button></form>
    <h3>مرتجعات المبيعات</h3><div className="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الكمية</th><th>الإجمالي</th><th>الحالة</th><th>القيد</th><th>إجراء</th></tr></thead><tbody>{salesReturns.map(r=><tr key={r.id}><td>{r.return_number}</td><td>{r.return_date}</td><td>{r.quantity}</td><td>{Number(r.grand_total).toFixed(2)}</td><td>{r.status==="posted"?"مرحّل":"مسودة"}</td><td>{r.journal_entry_id||"—"}</td><td>{r.status==="draft"?<button type="button" className="primary-btn" disabled={busy} onClick={()=>void postReturn("sales",r.id)}>ترحيل</button>:"—"}</td></tr>)}</tbody></table></div>
    <h3>مرتجعات المشتريات</h3><div className="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الكمية</th><th>الإجمالي</th><th>الحالة</th><th>القيد</th><th>إجراء</th></tr></thead><tbody>{purchaseReturns.map(r=><tr key={r.id}><td>{r.return_number}</td><td>{r.return_date}</td><td>{r.quantity}</td><td>{Number(r.grand_total).toFixed(2)}</td><td>{r.status==="posted"?"مرحّل":"مسودة"}</td><td>{r.journal_entry_id||"—"}</td><td>{r.status==="draft"?<button type="button" className="primary-btn" disabled={busy} onClick={()=>void postReturn("purchase",r.id)}>ترحيل</button>:"—"}</td></tr>)}</tbody></table></div></>}
    {tab==="الصندوق والبنوك"&&<><h3>إضافة صندوق أو حساب بنكي</h3><form className="journal-form" onSubmit={saveCashAccount}><div className="form-fields"><label>الرمز<input required value={cashCode} onChange={e=>setCashCode(e.target.value)}/></label><label>الاسم<input required value={cashName} onChange={e=>setCashName(e.target.value)}/></label><label>النوع<select value={cashType} onChange={e=>setCashType(e.target.value)}><option value="cash">صندوق</option><option value="bank">بنك</option></select></label><label>حساب دليل الحسابات<select required value={cashLedgerAccount} onChange={e=>setCashLedgerAccount(e.target.value)}><option value="">اختر الحساب المحاسبي</option>{ledgerAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></label></div><button className="primary-btn" disabled={busy}>حفظ الحساب</button></form>
      <h3>سند قبض أو صرف</h3><p className="notice">اختر الحساب النقدي والحساب المقابل. الحفظ ينشئ مسودة فقط؛ الترحيل ينشئ القيد المحاسبي ويثبت الحركة.</p><form className="journal-form" onSubmit={saveCashTransaction}><div className="form-fields"><label>الصندوق / البنك<select required value={cashAccount} onChange={e=>setCashAccount(e.target.value)}><option value="">اختر الحساب</option>{cashAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}{a.ledger_account_id?"":" (غير مربوط محاسبياً)"}</option>)}</select></label><label>نوع السند<select value={cashKind} onChange={e=>setCashKind(e.target.value)}><option value="receipt">سند قبض</option><option value="payment">سند صرف</option></select></label><label>التاريخ<input required type="date" value={cashDate} onChange={e=>setCashDate(e.target.value)}/></label><label>المبلغ<input required type="number" min="0.01" step="0.01" value={cashAmount} onChange={e=>setCashAmount(e.target.value)}/></label><label>الحساب المقابل<select required value={cashContraAccount} onChange={e=>setCashContraAccount(e.target.value)}><option value="">اختر الحساب المقابل</option>{ledgerAccounts.filter(a=>a.id!==cashAccounts.find(x=>x.id===cashAccount)?.ledger_account_id).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></label><label>الطرف (اختياري)<select value={cashParty} onChange={e=>setCashParty(e.target.value)}><option value="">بدون طرف</option>{allParties.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>رقم المرجع<input value={cashReference} onChange={e=>setCashReference(e.target.value)}/></label><label>البيان<input required value={cashDescription} onChange={e=>setCashDescription(e.target.value)}/></label></div><button className="primary-btn" disabled={busy}>حفظ السند كمسودة</button></form>
      <h3>حسابات الصندوق والبنوك</h3><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الرصيد الافتتاحي</th></tr></thead><tbody>{cashAccounts.map(a=><tr key={a.id}><td>{a.code}</td><td>{a.name_ar}</td><td>{a.account_type==="cash"?"صندوق":"بنك"}</td><td>{a.opening_balance}</td></tr>)}</tbody></table></div>
      <h3>آخر الحركات</h3><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>البيان</th><th>النوع</th><th>المبلغ</th><th>الحالة</th><th>القيد</th><th>الإجراء</th></tr></thead><tbody>{cashTransactions.map(r=><tr key={r.id}><td>{r.transaction_date}</td><td>{r.description}</td><td>{r.transaction_type==="receipt"?"قبض":"صرف"}</td><td>{r.amount}</td><td>{r.status==="posted"?"مرحّلة":"مسودة"}</td><td>{r.journal_entry_id||"—"}</td><td>{r.status==="draft"?<button type="button" className="primary-btn" disabled={busy} onClick={()=>void postCashTransaction(r.id)}>ترحيل</button>:"—"}</td></tr>)}</tbody></table></div>
    </>}
    {tab==="المصروفات"&&<><h3>تسجيل مصروف (مسودة)</h3><p className="notice">أدخل المبلغ قبل الضريبة والضريبة بشكل مستقل. عند الترحيل يُحمّل المصروف على حساب المصروفات، والضريبة على حساب ضريبة المدخلات، ويُخصم الإجمالي من الصندوق أو البنك المختار.</p><form className="journal-form" onSubmit={saveExpense}><div className="form-fields"><label>رقم المصروف<input required value={expenseNo} onChange={e=>setExpenseNo(e.target.value)}/></label><label>التاريخ<input required type="date" value={expenseDate} onChange={e=>setExpenseDate(e.target.value)}/></label><label>التصنيف<input required value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)} placeholder="إيجار، كهرباء، رواتب..."/></label><label>البيان<input required value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)}/></label><label>حساب المصروف<select required value={expenseLedgerAccount} onChange={e=>setExpenseLedgerAccount(e.target.value)}><option value="">اختر حساب المصروف</option>{ledgerAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></label><label>الصندوق / البنك<select required value={expenseCashAccount} onChange={e=>setExpenseCashAccount(e.target.value)}><option value="">اختر الصندوق أو البنك</option>{cashAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>)}</select></label><label>مركز التكلفة (اختياري)<select value={expenseCostCenter} onChange={e=>setExpenseCostCenter(e.target.value)}><option value="">بدون مركز تكلفة</option>{costCenters.map(c=><option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}</select></label><label>المبلغ قبل الضريبة<input required type="number" min="0.01" step="0.01" value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)}/></label><label>ضريبة المدخلات<input type="number" min="0" step="0.01" value={expenseVat} onChange={e=>setExpenseVat(e.target.value)}/></label></div><button className="primary-btn" disabled={busy}>حفظ المصروف كمسودة</button></form><h3>سجل المصروفات</h3><div className="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>التصنيف</th><th>البيان</th><th>المبلغ</th><th>الضريبة</th><th>الحالة</th><th>القيد المحاسبي</th><th>الإجراء</th></tr></thead><tbody>{expenses.map(r=><tr key={r.id}><td>{r.expense_number}</td><td>{r.expense_date}</td><td>{r.category}</td><td>{r.description}</td><td>{Number(r.amount).toFixed(2)}</td><td>{Number(r.vat_amount||0).toFixed(2)}</td><td>{r.status==="posted"?"مرحّل":r.status==="void"?"ملغى":"مسودة"}</td><td>{r.journal_entry_id||"—"}</td><td>{r.status==="draft"?<button type="button" className="primary-btn" disabled={busy} onClick={()=>void postExpense(r.id)}>ترحيل</button>:"—"}</td></tr>)}</tbody></table></div></>}
    {tab==="الأصول الثابتة"&&<><h3>تسجيل أصل ثابت</h3><form className="journal-form" onSubmit={saveAsset}><div className="form-fields"><label>رمز الأصل<input required value={assetCode} onChange={e=>setAssetCode(e.target.value)}/></label><label>اسم الأصل<input required value={assetName} onChange={e=>setAssetName(e.target.value)}/></label><label>تاريخ الاقتناء<input required type="date" value={assetDate} onChange={e=>setAssetDate(e.target.value)}/></label><label>التكلفة<input required type="number" min="0.01" step="0.01" value={assetCost} onChange={e=>setAssetCost(e.target.value)}/></label><label>العمر الإنتاجي بالأشهر<input required type="number" min="1" value={assetLife} onChange={e=>setAssetLife(e.target.value)}/></label><label>القيمة المتبقية<input type="number" min="0" step="0.01" value={assetResidual} onChange={e=>setAssetResidual(e.target.value)}/></label></div><button className="primary-btn" disabled={busy}>حفظ الأصل</button></form><h3>ترحيل الإهلاك الشهري</h3><div className="form-fields"><label>الأصل<select value={depreciationAsset} onChange={e=>setDepreciationAsset(e.target.value)}><option value="">اختر الأصل</option>{assets.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.asset_code} — {a.name_ar}</option>)}</select></label><label>شهر الإهلاك<input type="month" value={depreciationMonth} onChange={e=>setDepreciationMonth(e.target.value)}/></label><button type="button" className="primary-btn" disabled={busy||!depreciationAsset} onClick={()=>void postAssetDepreciation()}>ترحيل الإهلاك وإنشاء القيد</button></div><div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الأصل</th><th>تاريخ الاقتناء</th><th>التكلفة</th><th>العمر (شهر)</th><th>الإهلاك الشهري</th><th>مجمع الإهلاك</th><th>صافي القيمة الدفترية</th><th>الحالة</th></tr></thead><tbody>{assets.map(a=>{const b=assetBalances.find(x=>x.asset_id===a.id);return <tr key={a.id}><td>{a.asset_code}</td><td>{a.name_ar}</td><td>{a.acquisition_date}</td><td>{Number(a.acquisition_cost).toFixed(2)}</td><td>{a.useful_life_months}</td><td>{((Number(a.acquisition_cost)-Number(a.residual_value))/Number(a.useful_life_months)).toFixed(2)}</td><td>{Number(b?.accumulated_depreciation||0).toFixed(2)}</td><td>{Number(b?.net_book_value??a.acquisition_cost).toFixed(2)}</td><td>{a.is_active?"نشط":"موقوف"}</td></tr>})}</tbody></table></div><p className="notice">يُنشأ قيد الإهلاك عند الترحيل فقط، ولا يُكرر القيد للشهر نفسه. يجب التأكد من فتح الفترة المالية المختارة.</p></>}
  </section>;
}
