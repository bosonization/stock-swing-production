-- Local smoke-test data.  Production users are created through Supabase Auth.
insert into public.app_users (id, display_name, plan, role, status, max_watchlist_count)
values ('demo', 'デモ利用者', 'standard', 'user', 'active', 400)
on conflict (id) do update set display_name = excluded.display_name, status = excluded.status;

insert into public.watchlists (user_id, code, name, memo, is_active)
values
  ('demo', '7203', 'トヨタ自動車', '初期動作確認', true),
  ('demo', '6758', 'ソニーグループ', '初期動作確認', true),
  ('demo', '9984', 'ソフトバンクグループ', '初期動作確認', true)
on conflict (user_id, code) do update set name = excluded.name, memo = excluded.memo, is_active = true;
