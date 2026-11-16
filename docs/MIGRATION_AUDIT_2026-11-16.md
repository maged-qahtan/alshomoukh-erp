# تدقيق سجل ترحيلات قاعدة البيانات — 2026-11-16

## النتيجة التنفيذية

تمت قراءة جدول `supabase_migrations.schema_migrations` في مشروع Supabase المرتبط، دون تنفيذ أي كتابة أو تطبيق ترحيل.

- عدد السجلات المقروءة: **26**.
- آخر ترحيل مسجل: `0026_expense_accounting_posting` عند الإصدار `20261115141623`.
- ملفات المستودع تصل إلى `0034_restrict_asset_disposal_writes_to_rpc.sql`.
- لا تظهر في السجل الحالي أسماء الترحيلات `0027` إلى `0034`.
- توجد ستة أرقام ملفات مكررة من `0014` إلى `0019`، ولكل رقم ملفان مختلفان.

## مطابقة الأسماء

الأسماء التالية موجودة في سجل Supabase:

| رقم الملف | الاسم المسجل |
|---|---|
| 0014 | period_aware_financial_reports |
| 0015 | correct_trial_balance_opening |
| 0016 | include_current_period_earnings_in_balance_sheet |
| 0017 | correct_balance_sheet_current_result_sign |
| 0018 | guard_fiscal_period_closing |
| 0019 | correct_fiscal_year_carryforward_net_income |

أما الملفات الشقيقة التي لا يظهر اسمها في سجل الترحيلات المقروء:

| الرقم المكرر | الملف غير الظاهر في السجل |
|---|---|
| 0014 | `0014_update_draft_journal_entry.sql` |
| 0015 | `0015_opening_balance_journal.sql` |
| 0016 | `0016_close_fiscal_period.sql` |
| 0017 | `0017_serialize_posting_with_period_close.sql` |
| 0018 | `0018_fiscal_year_close_preview.sql` |
| 0019 | `0019_create_next_fiscal_year_opening_draft.sql` |

**تنبيه:** عدم ظهور الاسم في سجل الترحيلات لا يثبت وحده أن أثر SQL غير موجود في قاعدة البيانات؛ قد تكون التغييرات قد وصلت بآلية أخرى أو ضمن ترحيل مختلف. يلزم فحص كتالوج PostgreSQL والدوال والسياسات ذات الصلة قبل اتخاذ قرار.

## فحص كتالوج PostgreSQL للدوال

تم إجراء استعلام قراءة فقط على `pg_proc` و`pg_get_functiondef` للدوال الست التي تنشئها الملفات الشقيقة. **الدوال الست موجودة فعلياً في قاعدة الإنتاج**:

- `update_draft_journal_entry(p_entry_id uuid, p_entry_date date, p_description text, p_lines jsonb)`
- `save_opening_balance_draft(p_company_id uuid, p_fiscal_period_id uuid, p_lines jsonb)`
- `close_fiscal_period(p_fiscal_period_id uuid)`
- `post_journal_entry(p_entry_id uuid, p_user_id uuid)`
- `get_fiscal_year_close_preview(p_fiscal_period_id uuid)`
- `create_next_fiscal_year_opening_draft(p_closed_period_id uuid, p_retained_earnings_account_id uuid, p_new_period_name text)`

جميعها ظهرت كدوال `SECURITY INVOKER` (أي `prosecdef = false`) وبـ `search_path` محدد. هذا يثبت وجود الدوال الحالية فقط؛ ولا يثبت أن تعريفها مطابق بايتاً لملفات migrations الشقيقة أو أن جميع ACL والسياسات المرتبطة بها متطابقة.

**الاستنتاج العملي:** لا تُشغّل الملفات الست لمجرد غياب أسمائها من سجل migrations؛ قد تعيد تعريف دوال موجودة. يجب مقارنة التعريفات والـ grants والسياسات مع ملفات المصدر أولاً.

## إجراء آمن موصى به

1. تجميد تطبيق أي ملفات غير مسجلة على الإنتاج.
2. فحص تعريفات الدوال والجداول والسياسات الحالية ومقارنتها بمحتوى الملفات الستة.
3. إنشاء قاعدة staging مؤقتة واستعادة/بناء خط أساس مطابق للإنتاج.
4. اختبار مسار تثبيت نظيف من البداية، مع ترتيب تبعيات الملفات.
5. إعداد ترحيلات إصلاح جديدة بأرقام/إصدارات فريدة لا تعيد تشغيل الملفات السابقة، بعد إثبات الحاجة إليها.
6. مراجعة محاسب ومراجع أمان، ثم طلب موافقة مستقلة قبل أي تطبيق إنتاجي.

## حدود هذا التدقيق

- القراءة فقط؛ لم تُنفذ أوامر DDL/DML.
- لم يتم تغيير أسماء ملفات migrations.
- لم يتم تطبيق migrations من 0027 إلى 0034.
- لا تعتبر هذه المطابقة اعتماداً محاسبياً أو إثباتاً لسلامة جميع وظائف النظام.
