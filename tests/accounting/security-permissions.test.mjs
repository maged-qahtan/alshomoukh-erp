import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = (name) =>
  readFile(new URL(`../../database/migrations/${name}`, import.meta.url), "utf8");

test("company management requires an active owner or accountant membership", async () => {
  const sql = await migration("0009_role_based_permissions.sql");
  const fn = sql.match(/create or replace function public\.can_manage_company[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.ok(fn, "can_manage_company definition must exist");
  assert.match(fn, /security definer/i);
  assert.match(fn, /set search_path\s*=\s*pg_catalog,\s*public/i);
  assert.match(fn, /cu\.company_id\s*=\s*target_company_id/i);
  assert.match(fn, /cu\.user_id\s*=\s*public\.current_app_user_id\(\)/i);
  assert.match(fn, /cu\.is_active\s*=\s*true/i);
  assert.match(fn, /r\.code\s+in\s*\('owner',\s*'accountant'\)/i);
  assert.match(sql, /revoke all on function public\.can_manage_company\(uuid\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.can_manage_company\(uuid\) to authenticated/i);
});

test("reviewer and viewer roles are not granted accounting write authority", async () => {
  const roles = await migration("0001_initial.sql");
  const permissions = await migration("0009_role_based_permissions.sql");
  assert.match(roles, /\('reviewer',[\s\S]*?\),\s*\('viewer'/i);
  const fn = permissions.match(/create or replace function public\.can_manage_company[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.doesNotMatch(fn, /'reviewer'|'viewer'/i);
});

test("journal write policies require management permission and draft state", async () => {
  const sql = await migration("0009_role_based_permissions.sql");
  assert.match(sql, /create policy "managers create draft journal entries"[\s\S]*?with check\s*\(public\.can_manage_company\(company_id\) and status = 'draft'\)/i);
  assert.match(sql, /create policy "managers update company journal entries"[\s\S]*?using\s*\(public\.can_manage_company\(company_id\)\)[\s\S]*?with check\s*\(public\.can_manage_company\(company_id\)\)/i);
  assert.match(sql, /create policy "managers insert lines of draft entries"[\s\S]*?public\.can_manage_company\(company_id\)[\s\S]*?e\.status = 'draft'/i);
  assert.match(sql, /create policy "managers delete lines of draft entries"[\s\S]*?public\.can_manage_company\(company_id\)[\s\S]*?e\.status = 'draft'/i);
});

test("posted and reversed journals cannot be directly mutated or deleted", async () => {
  const sql = await migration("0005_security_hardening.sql");
  assert.match(sql, /if old\.status in \('posted', 'reversed'\) then[\s\S]*?raise exception 'Posted journal entries cannot be deleted\.'/i);
  assert.match(sql, /if old\.status = 'reversed' then[\s\S]*?raise exception 'Reversed journal entries are immutable\.'/i);
  assert.match(sql, /Posted journal entries are immutable; use reverse_journal_entry\(\)\./i);
  assert.match(sql, /before update or delete on public\.audit_logs/i);
  assert.match(sql, /Audit log records are append-only/i);
});

test("company bootstrap is authenticated, one-time, and provisions the owner role", async () => {
  const sql = await migration("0006_security_onboarding_performance.sql");
  const fn = sql.match(/create or replace function public\.bootstrap_company[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.ok(fn, "bootstrap_company definition must exist");
  assert.match(fn, /security definer/i);
  assert.match(fn, /set search_path\s*=\s*pg_catalog,\s*public,\s*auth/i);
  assert.match(fn, /v_auth_id\s*:=\s*auth\.uid\(\);[\s\S]*?if v_auth_id is null then/i);
  assert.match(fn, /already completed company onboarding/i);
  assert.match(fn, /where code = 'owner'/i);
  assert.match(fn, /insert into public\.company_users/i);
  assert.match(sql, /revoke all on function public\.bootstrap_company\(text, text, date, date\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.bootstrap_company\(text, text, date, date\) to authenticated/i);
});
