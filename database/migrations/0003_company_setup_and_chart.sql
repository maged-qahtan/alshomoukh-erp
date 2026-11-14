-- Company onboarding and starter chart of accounts.
begin;

create or replace function initialize_company(
  p_legal_name text,
  p_display_name text,
  p_fiscal_year_start date,
  p_fiscal_year_end date
) returns uuid language plpgsql as $$
declare
  new_company_id uuid;
begin
  if nullif(trim(p_legal_name), '') is null or nullif(trim(p_display_name), '') is null then
    raise exception 'Company legal name and display name are required.';
  end if;
  if p_fiscal_year_start is null or p_fiscal_year_end is null or p_fiscal_year_end < p_fiscal_year_start then
    raise exception 'Invalid fiscal year dates.';
  end if;

  insert into companies(legal_name, display_name, base_currency, fiscal_year_start_month)
  values (trim(p_legal_name), trim(p_display_name), 'SAR', extract(month from p_fiscal_year_start)::smallint)
  returning id into new_company_id;

  insert into fiscal_periods(company_id, name, starts_on, ends_on)
  values (
    new_company_id,
    'FY ' || extract(year from p_fiscal_year_start)::integer,
    p_fiscal_year_start,
    p_fiscal_year_end
  );
  return new_company_id;
end;
$$;

create or replace function seed_default_chart_of_accounts(p_company_id uuid)
returns integer language plpgsql as $$
declare
  inserted_count integer := 0;
  affected integer;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Company not found.';
  end if;

  insert into accounts(company_id, code, name_ar, name_en, type, is_posting)
  values
    (p_company_id, '1', 'الأصول', 'Assets', 'asset', false),
    (p_company_id, '2', 'الالتزامات', 'Liabilities', 'liability', false),
    (p_company_id, '3', 'حقوق الملكية', 'Equity', 'equity', false),
    (p_company_id, '4', 'الإيرادات', 'Revenue', 'revenue', false),
    (p_company_id, '5', 'المصروفات', 'Expenses', 'expense', false)
  on conflict (company_id, code) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  insert into accounts(company_id, parent_id, code, name_ar, name_en, type, is_posting)
  select p_company_id, parent.id, child.code, child.name_ar, child.name_en, child.type::account_type, child.is_posting
  from (values
    ('11','1','الأصول المتداولة','Current assets','asset',false),
    ('12','1','الأصول غير المتداولة','Non-current assets','asset',false),
    ('21','2','الالتزامات المتداولة','Current liabilities','liability',false),
    ('22','2','الالتزامات طويلة الأجل','Long-term liabilities','liability',false),
    ('31','3','رأس المال','Capital','equity',false),
    ('32','3','الأرباح المبقاة','Retained earnings','equity',true),
    ('41','4','إيرادات النشاط','Operating revenue','revenue',false),
    ('42','4','إيرادات أخرى','Other income','revenue',false),
    ('51','5','تكلفة المبيعات','Cost of sales','expense',false),
    ('52','5','المصروفات التشغيلية','Operating expenses','expense',false)
  ) as child(code,parent_code,name_ar,name_en,type,is_posting)
  join accounts parent on parent.company_id = p_company_id and parent.code = child.parent_code
  on conflict (company_id, code) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  insert into accounts(company_id, parent_id, code, name_ar, name_en, type, is_posting)
  select p_company_id, parent.id, child.code, child.name_ar, child.name_en, child.type::account_type, true
  from (values
    ('1101','11','الصندوق','Cash','asset'),
    ('1102','11','البنوك','Banks','asset'),
    ('1103','11','العملاء','Accounts receivable','asset'),
    ('1104','11','المخزون','Inventory','asset'),
    ('1201','12','الأصول الثابتة','Fixed assets','asset'),
    ('1202','12','مجمع الإهلاك','Accumulated depreciation','asset'),
    ('2101','21','الموردون','Accounts payable','liability'),
    ('2102','21','ضريبة القيمة المضافة المستحقة','VAT payable','liability'),
    ('2201','22','قروض طويلة الأجل','Long-term loans','liability'),
    ('3101','31','رأس المال المدفوع','Paid-in capital','equity'),
    ('4101','41','إيرادات المبيعات','Sales revenue','revenue'),
    ('4201','42','إيرادات أخرى','Other revenue','revenue'),
    ('5101','51','تكلفة البضاعة المباعة','Cost of goods sold','expense'),
    ('5201','52','الرواتب والأجور','Salaries and wages','expense'),
    ('5202','52','الإيجارات','Rent expense','expense'),
    ('5203','52','المرافق والخدمات','Utilities','expense'),
    ('5204','52','مصروف الإهلاك','Depreciation expense','expense')
  ) as child(code,parent_code,name_ar,name_en,type)
  join accounts parent on parent.company_id = p_company_id and parent.code = child.parent_code
  on conflict (company_id, code) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  return inserted_count;
end;
$$;

commit;
