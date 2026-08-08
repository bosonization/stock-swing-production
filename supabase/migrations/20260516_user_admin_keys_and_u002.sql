-- User-specific admin keys and u002 bootstrap.
-- Run this once in Supabase SQL Editor.

alter table app_users
  add column if not exists admin_key text;

-- u001: 管理キーは必要に応じて変更してください。
insert into app_users (
  id,
  display_name,
  email,
  plan,
  status,
  max_watchlist_count,
  admin_key
)
values (
  'u001',
  'ユーザ001',
  null,
  'beta',
  'active',
  400,
  'u001-change-me'
)
on conflict (id) do update set
  display_name = excluded.display_name,
  plan = excluded.plan,
  status = excluded.status,
  max_watchlist_count = excluded.max_watchlist_count,
  admin_key = coalesce(app_users.admin_key, excluded.admin_key),
  updated_at = now();

-- u002: 2人目のユーザ。管理キーは必ず変更してください。
insert into app_users (
  id,
  display_name,
  email,
  plan,
  status,
  max_watchlist_count,
  admin_key
)
values (
  'u002',
  'ユーザ002',
  null,
  'beta',
  'active',
  400,
  'u002-change-me'
)
on conflict (id) do update set
  display_name = excluded.display_name,
  plan = excluded.plan,
  status = excluded.status,
  max_watchlist_count = excluded.max_watchlist_count,
  admin_key = coalesce(app_users.admin_key, excluded.admin_key),
  updated_at = now();

-- 管理キーを任意の値に変更する例:
-- update app_users set admin_key = 'your-u001-secret-key' where id = 'u001';
-- update app_users set admin_key = 'your-u002-secret-key' where id = 'u002';
