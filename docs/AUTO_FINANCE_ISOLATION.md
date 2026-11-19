# AUTO-FINANCE isolation and deployment notes

AUTO-FINANCE is developed on the `auto-finance-app` branch and is exposed at `/auto-finance`.
The existing ERP home page and root layout remain unchanged from `main`.

## Dedicated database

- Supabase project: `AUTO-FINANCE`
- Project ref: `fvmdatbwkmwbhoiuzbgn`
- Region: `eu-central-1`
- API URL: `https://fvmdatbwkmwbhoiuzbgn.supabase.co`

This database is independent of the Supabase project used by the existing ERP or SiteCare Pulse.
Do not point this route at another product's database.

## Runtime configuration

Set only these browser-safe variables in the AUTO-FINANCE deployment environment:

- `NEXT_PUBLIC_SUPABASE_URL=https://fvmdatbwkmwbhoiuzbgn.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<project publishable/anon key>`

Never set a service-role or secret key in a `NEXT_PUBLIC_*` variable, browser bundle, or Git commit.
The application deliberately displays a setup screen while the two public variables are absent.

## Database migrations

The dedicated Supabase project currently records these migrations in its migration history:

- `initial_accounting_schema`
- `company_data_isolation_policies`
- `journal_posting_controls`
- `journal_posting_invoker_security`
- `journal_posting_lock_permissions_fix`
- `company_dashboard_summary`
- `harden_journal_permissions_and_atomic_drafts`
- `isolate_secure_posting_and_guard_status`
- `fix_atomic_draft_json_line_order`
- `index_uncovered_foreign_keys`
- `support_fiscal_periods_in_journal_drafts`
- `add_atomic_daily_expense_posting`
- `guard_posted_daily_expenses`

The latest hardening removes anonymous table grants, removes direct update privileges from journal tables,
uses an atomic draft-creation RPC, and confines the privileged posting implementation to the non-exposed
`private` schema. The public posting RPC is SECURITY INVOKER and delegates only after the internal
function validates the authenticated user's company membership.

## Release safety

- Keep PR #9 as draft until final review and owner login setup.
- Do not merge this branch into `main` until the owner approves the release.
- Do not configure a deployment target shared with the existing ERP unless a separate project/environment
  has been explicitly selected and verified.
- No Auth user, email address, or fiscal year is created by this setup.
