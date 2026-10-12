-- Community foundation. The existing stock scoring tables and calculation
-- logic are intentionally unchanged. Apply before deploying the matching UI.

create table if not exists public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('business_owner', 'technical_admin', 'community_manager', 'instructor', 'member')),
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists public.feature_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  feature_key text not null check (feature_key in ('community', 'stock_swing_tool')),
  enabled boolean not null default false,
  reason text not null default '',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature_key)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 3 and 160),
  summary text not null default '' check (char_length(summary) <= 500),
  body text not null check (char_length(body) between 1 and 30000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 100,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '' check (char_length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  meeting_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_events_time_order check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.community_events(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'cancelled', 'attended', 'absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  category text not null check (category in ('operation', 'account', 'event', 'withdrawal', 'other')),
  subject text not null check (char_length(subject) between 3 and 160),
  message text not null check (char_length(message) between 10 and 5000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_published_idx on public.announcements(status, published_at desc);
create index if not exists lessons_published_idx on public.lessons(status, sort_order, published_at desc);
create index if not exists community_events_upcoming_idx on public.community_events(status, starts_at);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status, created_at);
create index if not exists feature_entitlements_user_idx on public.feature_entitlements(user_id, enabled);

drop trigger if exists role_assignments_set_updated_at on public.role_assignments;
create trigger role_assignments_set_updated_at before update on public.role_assignments
for each row execute function public.set_updated_at();
drop trigger if exists feature_entitlements_set_updated_at on public.feature_entitlements;
create trigger feature_entitlements_set_updated_at before update on public.feature_entitlements
for each row execute function public.set_updated_at();
drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at before update on public.announcements
for each row execute function public.set_updated_at();
drop trigger if exists lessons_set_updated_at on public.lessons;
create trigger lessons_set_updated_at before update on public.lessons
for each row execute function public.set_updated_at();
drop trigger if exists community_events_set_updated_at on public.community_events;
create trigger community_events_set_updated_at before update on public.community_events
for each row execute function public.set_updated_at();
drop trigger if exists event_registrations_set_updated_at on public.event_registrations;
create trigger event_registrations_set_updated_at before update on public.event_registrations
for each row execute function public.set_updated_at();
drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at before update on public.support_tickets
for each row execute function public.set_updated_at();

alter table public.role_assignments enable row level security;
alter table public.feature_entitlements enable row level security;
alter table public.announcements enable row level security;
alter table public.lessons enable row level security;
alter table public.community_events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.support_tickets enable row level security;

drop policy if exists role_assignments_read_own on public.role_assignments;
create policy role_assignments_read_own on public.role_assignments for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
drop policy if exists feature_entitlements_read_own on public.feature_entitlements;
create policy feature_entitlements_read_own on public.feature_entitlements for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
drop policy if exists announcements_read_published on public.announcements;
create policy announcements_read_published on public.announcements for select to authenticated
using (status = 'published' or public.is_admin());
drop policy if exists lessons_read_published on public.lessons;
create policy lessons_read_published on public.lessons for select to authenticated
using (status = 'published' or public.is_admin());
drop policy if exists community_events_read_published on public.community_events;
create policy community_events_read_published on public.community_events for select to authenticated
using (status in ('published', 'cancelled', 'completed') or public.is_admin());
drop policy if exists event_registrations_read_own on public.event_registrations;
create policy event_registrations_read_own on public.event_registrations for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());
drop policy if exists support_tickets_read_own on public.support_tickets;
create policy support_tickets_read_own on public.support_tickets for select to authenticated
using (public.is_current_user(user_id) or public.is_admin());

grant select on public.role_assignments, public.feature_entitlements,
  public.announcements, public.lessons, public.community_events,
  public.event_registrations, public.support_tickets to authenticated;
grant all on public.role_assignments, public.feature_entitlements,
  public.announcements, public.lessons, public.community_events,
  public.event_registrations, public.support_tickets to service_role;

-- Preserve the current PoC: all existing active users keep tool access.
insert into public.role_assignments (user_id, role)
select id, case when role = 'admin' then 'technical_admin' else 'member' end
from public.app_users
on conflict (user_id, role) do update set is_active = true;

insert into public.feature_entitlements (user_id, feature_key, enabled, reason)
select id, 'community', true, 'community foundation migration'
from public.app_users
on conflict (user_id, feature_key) do update set enabled = excluded.enabled, reason = excluded.reason;

insert into public.feature_entitlements (user_id, feature_key, enabled, reason)
select id, 'stock_swing_tool', true, 'legacy PoC access preserved'
from public.app_users
on conflict (user_id, feature_key) do nothing;

create or replace function public.seed_community_access_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.role_assignments (user_id, role)
  values (new.id, case when new.role = 'admin' then 'technical_admin' else 'member' end)
  on conflict (user_id, role) do update set is_active = true;

  insert into public.feature_entitlements (user_id, feature_key, enabled, reason)
  values
    (new.id, 'community', true, 'new member default'),
    (new.id, 'stock_swing_tool', new.role = 'admin', 'admin approval required')
  on conflict (user_id, feature_key) do nothing;
  return new;
end;
$$;

drop trigger if exists on_app_user_created_seed_community on public.app_users;
create trigger on_app_user_created_seed_community after insert on public.app_users
for each row execute function public.seed_community_access_for_new_user();

insert into public.announcements (slug, title, body, status, published_at)
values (
  'community-start',
  'コミュニティサイトを開始しました',
  E'公式のお知らせ、教材、開催予定、問い合わせ窓口をこのサイトに集約します。\n\nLINEは補助的な通知・交流手段です。規約、開催内容、運営上の決定はこのサイトをご確認ください。',
  'published',
  now()
)
on conflict (slug) do nothing;

insert into public.lessons (slug, title, summary, body, status, sort_order, published_at)
values
  ('fact-and-opinion', '事実と推測を分ける', '企業情報を読む前に、確認できた事実と自分の推測を分けて記録します。', E'公表資料に書かれている内容を「事実」、そこから自分が考えた内容を「推測」として分けます。\n\nこの教材は特定銘柄の売買判断を示すものではありません。', 'published', 10, now()),
  ('record-source', '出典を残す', '後から確認できるよう、資料名・公表日・URLを記録します。', E'数値だけを転記せず、資料名、公表日、参照したページやURLを一緒に残します。\n\n外部サイトの内容は各提供元の条件に従って利用してください。', 'published', 20, now()),
  ('monthly-review', '月1回振り返る', '予想の当たり外れではなく、記録の変化と確認漏れを振り返ります。', E'月末に、追加した事実、修正した推測、次回確認する資料を整理します。投資成績を競う場にはしません。', 'published', 30, now())
on conflict (slug) do nothing;
