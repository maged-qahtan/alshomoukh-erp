# ربط Supabase

## 1. إنشاء مشروع
أنشئ مشروعاً في Supabase، ثم افتح Project Settings → API وانسخ Project URL و anon/publishable key.

## 2. إعداد متغيرات البيئة
انسخ `.env.example` إلى `.env.local` وأدخل:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

لا تضع Service Role Key في متغير يبدأ بـ `NEXT_PUBLIC_` ولا ترسله في المحادثة أو ترفعه إلى GitHub.

## 3. تجهيز قاعدة البيانات
نفّذ ملفات SQL في مجلد `database/migrations` بالترتيب:
1. `0001_initial.sql`
2. `0002_reporting_and_reversal.sql`
3. `0003_company_setup_and_chart.sql`
4. `0004_supabase_auth_and_rls.sql`
5. `0005_security_hardening.sql`
6. `0006_security_onboarding_performance.sql`
7. `0007_atomic_journal_drafts.sql`

بعدها اتبع `database/seeds/README.md` لإنشاء الشركة ودليل الحسابات. بعد تفعيل تسجيل المستخدم في Supabase Auth، أنشئ الحساب من شاشة النظام. أول مستخدم يسجل الدخول يستطيع إنشاء الشركة من معالج الإعداد؛ تنشئ وظيفة `bootstrap_company` ملف المستخدم والعضوية ودليل الحسابات والفترة المالية تلقائياً. لا تستخدم مفتاح Service Role في المتصفح.

## 4. ملفات الربط
- `src/lib/supabase/client.ts`: عميل المتصفح.
- `src/lib/supabase/server.ts`: عميل Server Components / Server Actions.
- `src/middleware.ts`: تحديث جلسة الدخول.

## تنبيه
هذا يضيف طبقة اتصال ومخطط RLS أولياً؛ تم تطبيق الترحيلات حتى 0007 على مشروع Supabase المرتبط. يلزم إعداد متغيرات البيئة في Vercel، وتأكيد البريد/تسجيل الدخول، ثم إجراء اختبار وظيفي ببيانات تجريبية قبل إدخال بيانات مالية حقيقية.
