-- Stock Swing production schema.
-- The scoring implementation lives in stock-swing-core and is intentionally
-- not duplicated in SQL.  This migration only supplies its durable data model.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_users (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  plan text not null default 'standard' check (plan in ('standard', 'pro', 'admin')),
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  max_watchlist_count integer not null default 400 check (max_watchlist_count between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{3,4}[A-Z]?$'),
  name text not null default '',
  memo text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, code)
);

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  status text not null default 'running' check (status in ('queued', 'running', 'success', 'failed')),
  score_version text not null default 'v2_26_conditions_202606',
  source text not null default 'stock-swing-core',
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  code text not null,
  name text,
  close numeric,
  score integer,
  condition_count integer,
  failed_star_numbers text not null default '',
  pickup_flag boolean not null default false,
  tags text[] not null default '{}',
  tag_reasons jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  kabutan_url text,
  created_at timestamptz not null default now(),
  unique (run_id, code),
  constraint score_range check (score is null or score between -2 and 67)
);

create table if not exists public.earnings_calendar (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  company_name text,
  announcement_date date not null,
  fiscal_year text,
  fiscal_quarter text,
  source text not null default 'jquants_v2',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, code, announcement_date)
);

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  consent_type text not null,
  version text not null,
  agreed_at timestamptz not null default now(),
  user_agent text,
  ip_hash text,
  unique (user_id, consent_type, version)
);

create table if not exists public.app_event_logs (
  id bigint generated always as identity primary key,
  user_id text references public.app_users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  event_version text not null default 'production_v1',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists watchlists_user_active_idx on public.watchlists(user_id, is_active, code);
create index if not exists analysis_runs_latest_idx on public.analysis_runs(user_id, status, started_at desc);
create index if not exists analysis_results_run_score_idx on public.analysis_results(run_id, score desc nulls last);
create index if not exists earnings_calendar_code_date_idx on public.earnings_calendar(code, announcement_date);

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at before update on public.app_users
for each row execute function public.set_updated_at();
drop trigger if exists watchlists_set_updated_at on public.watchlists;
create trigger watchlists_set_updated_at before update on public.watchlists
for each row execute function public.set_updated_at();
drop trigger if exists earnings_calendar_set_updated_at on public.earnings_calendar;
create trigger earnings_calendar_set_updated_at before update on public.earnings_calendar
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_users (id, auth_user_id, display_name, email)
  values (
    new.id::text,
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), ''),
    new.email
  ) on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_current_user(target_user_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users u
    where u.id = target_user_id and u.auth_user_id = auth.uid() and u.status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid() and u.role = 'admin' and u.status = 'active'
  );
$$;

alter table public.app_users enable row level security;
alter table public.watchlists enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_results enable row level security;
alter table public.earnings_calendar enable row level security;
alter table public.user_consents enable row level security;
alter table public.app_event_logs enable row level security;

create policy app_users_read_own on public.app_users for select to authenticated
using (auth_user_id = auth.uid() or public.is_admin());
create policy app_users_update_own on public.app_users for update to authenticated
using (auth_user_id = auth.uid() or public.is_admin())
with check (auth_user_id = auth.uid() or public.is_admin());

create policy watchlists_read_own on public.watchlists for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
create policy watchlists_insert_own on public.watchlists for insert to authenticated
with check (public.is_current_user(user_id) or public.is_admin());
create policy watchlists_update_own on public.watchlists for update to authenticated
using (public.is_current_user(user_id) or public.is_admin())
with check (public.is_current_user(user_id) or public.is_admin());
create policy watchlists_delete_own on public.watchlists for delete to authenticated
using (public.is_current_user(user_id) or public.is_admin());

create policy analysis_runs_read_own on public.analysis_runs for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
create policy analysis_results_read_own on public.analysis_results for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
create policy earnings_calendar_read_authenticated on public.earnings_calendar for select to authenticated using (true);
create policy consents_read_own on public.user_consents for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
create policy consents_insert_own on public.user_consents for insert to authenticated
with check (public.is_current_user(user_id) or public.is_admin());
create policy event_logs_read_admin on public.app_event_logs for select to authenticated using (public.is_admin());

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, update on public.app_users to authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant select on public.analysis_runs, public.analysis_results, public.earnings_calendar to authenticated;
grant select, insert on public.user_consents to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
