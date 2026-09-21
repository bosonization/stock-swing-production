-- Operations dashboard and versioned terms consent management.
-- Apply this migration before deploying the matching web application.

alter table public.app_users
  add column if not exists last_login_at timestamptz;

create table if not exists public.terms_documents (
  id uuid primary key default gen_random_uuid(),
  terms_type text not null,
  version text not null,
  title text not null,
  body text not null,
  is_active boolean not null default false,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (terms_type, version),
  constraint terms_documents_type_format check (terms_type ~ '^[a-z][a-z0-9_]{2,49}$'),
  constraint terms_documents_version_length check (char_length(version) between 2 and 80),
  constraint terms_documents_title_length check (char_length(title) between 3 and 120),
  constraint terms_documents_body_length check (char_length(body) between 100 and 20000)
);

create unique index if not exists terms_documents_one_active_per_type_idx
  on public.terms_documents (terms_type)
  where is_active;

create index if not exists user_consents_lookup_idx
  on public.user_consents (consent_type, version, user_id);

alter table public.terms_documents enable row level security;

drop policy if exists terms_documents_read_authenticated on public.terms_documents;
create policy terms_documents_read_authenticated
on public.terms_documents for select to authenticated
using (is_active or public.is_admin());

grant select on public.terms_documents to authenticated;
grant all on public.terms_documents to service_role;

create or replace function public.publish_terms_document(
  p_terms_type text,
  p_version text,
  p_title text,
  p_body text,
  p_published_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_terms_type !~ '^[a-z][a-z0-9_]{2,49}$' then
    raise exception 'invalid terms type';
  end if;
  if char_length(p_version) < 2 or char_length(p_version) > 80 then
    raise exception 'invalid version';
  end if;
  if char_length(p_title) < 3 or char_length(p_title) > 120 then
    raise exception 'invalid title';
  end if;
  if char_length(p_body) < 100 or char_length(p_body) > 20000 then
    raise exception 'invalid body';
  end if;

  insert into public.terms_documents (
    terms_type, version, title, body, is_active, published_at, published_by
  ) values (
    p_terms_type, p_version, p_title, p_body, false, now(), p_published_by
  ) returning id into v_id;

  update public.terms_documents
     set is_active = false
   where terms_type = p_terms_type
     and id <> v_id
     and is_active;

  update public.terms_documents
     set is_active = true
   where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.publish_terms_document(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_terms_document(text, text, text, text, uuid) to service_role;

create or replace view public.user_operations_summary
with (security_invoker = true)
as
select
  u.id as user_id,
  (
    select count(*)::integer
    from public.watchlists w
    where w.user_id = u.id and w.is_active
  ) as active_watchlist_count,
  latest_run.status as analysis_status,
  latest_run.started_at as analysis_started_at,
  latest_run.finished_at as analysis_finished_at,
  latest_run.error_message as analysis_error_message,
  active_consent.agreed_at as active_terms_agreed_at
from public.app_users u
left join lateral (
  select r.status, r.started_at, r.finished_at, r.error_message
  from public.analysis_runs r
  where r.user_id = u.id
  order by r.started_at desc
  limit 1
) latest_run on true
left join lateral (
  select c.agreed_at
  from public.terms_documents t
  join public.user_consents c
    on c.user_id = u.id
   and c.consent_type = t.terms_type
   and c.version = t.version
  where t.terms_type = 'service_terms'
    and t.is_active
  limit 1
) active_consent on true;

revoke all on public.user_operations_summary from public, anon, authenticated;
grant select on public.user_operations_summary to service_role;

insert into public.terms_documents (
  terms_type,
  version,
  title,
  body,
  is_active
)
values (
  'service_terms',
  'service_terms_v1',
  'サービス利用規約・注意事項',
  E'本サービスは、株価・出来高等の情報をもとに、あらかじめ定めた条件への一致状況を機械的に整理するためのツールです。\n\n本サービスは、特定の銘柄の取得、売却、保有を推奨するものではありません。表示される点数、ラベル、並び順は、将来の値上がり、利益獲得可能性、または投資成果を保証するものではありません。\n\n外部データソースの正確性、完全性、即時性、継続提供は保証されません。利用者は、表示内容だけに依存せず、最終的な投資判断を自身の責任で行うものとします。\n\n運営者は、必要に応じて本規約を改定します。重要な改定を行った場合は、新しい版への同意が完了するまで本サービスの利用を制限することがあります。',
  not exists (
    select 1 from public.terms_documents
    where terms_type = 'service_terms' and is_active
  )
)
on conflict (terms_type, version) do nothing;

update public.terms_documents seed
set is_active = true
where seed.terms_type = 'service_terms'
  and seed.version = 'service_terms_v1'
  and not exists (
    select 1 from public.terms_documents active
    where active.terms_type = 'service_terms' and active.is_active
  );
