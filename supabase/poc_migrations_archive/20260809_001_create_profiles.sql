create table public.profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    display_name text,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now()
);

alter table public.profiles
enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
    (select auth.uid()) = id
);


create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (
    (select auth.uid()) = id
);


create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (
    (select auth.uid()) = id
)
with check (
    (select auth.uid()) = id
);


create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using (
    (select auth.uid()) = id
);

