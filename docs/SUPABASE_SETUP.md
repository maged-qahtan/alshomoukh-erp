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

بعدها اتبع `database/seeds/README.md` لإنشاء الشركة ودليل الحسابات. ثم أنشئ مستخدمي Supabase Auth واربطهم بجدول `app_users` وعضوية `company_users` وفق تعليمات الترحيل.

## 4. ملفات الربط
- `src/lib/supabase/client.ts`: عميل المتصفح.
- `src/lib/supabase/server.ts`: عميل Server Components / Server Actions.
- `src/middleware.ts`: تحديث جلسة الدخول.

## تنبيه
هذا يضيف طبقة اتصال ومخطط RLS أولياً؛ لا يعني أن المصادقة أو صلاحيات المحاسب قد اختُبرت على مشروع Supabase فعلي. يجب اختبار سياسات RLS ووظائف الترحيل بحسابات مختلفة قبل إدخال بيانات حقيقية.
