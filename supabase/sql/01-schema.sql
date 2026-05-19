-- FLOW — Step 1: tables + RLS (run first)
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new
--
-- If you see "incompatible types: uuid and bigint", an old projects table exists.
-- This drops and recreates projects + tickets (profile rows are kept).

drop table if exists public.tickets cascade;
drop table if exists public.projects cascade;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  email text not null unique,
  color text not null default '#c8f564',
  bg text not null default '#2d4a1a',
  initial text not null,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  icon text not null default '🚀',
  color text not null default '#c8f564',
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  ticket_number integer not null,
  title text not null,
  description text not null default '',
  assignee_name text not null,
  priority text not null check (priority in ('high', 'med', 'low')),
  status text not null check (status in ('todo', 'prog', 'done')),
  created_at timestamptz not null default now(),
  unique (project_id, ticket_number)
);

create index tickets_project_id_idx on public.tickets (project_id);
create index tickets_assignee_idx on public.tickets (assignee_name);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tickets enable row level security;

-- Login page reads profiles before sign-in
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select using (true);

drop policy if exists "projects_all_authenticated" on public.projects;
create policy "projects_all_authenticated"
  on public.projects for all to authenticated using (true) with check (true);

drop policy if exists "tickets_all_authenticated" on public.tickets;
create policy "tickets_all_authenticated"
  on public.tickets for all to authenticated using (true) with check (true);

-- Display name: User Metadata "name", else part before @ in email
create or replace function public.flow_display_name(p_email text, p_meta jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(p_meta->>'name'), ''),
    initcap(replace(split_part(p_email, '@', 1), '.', ' ')),
    p_email
  );
$$;

-- Avatar colors (index 0–5) — stable per user via hashtext in sync/trigger
create or replace function public.flow_profile_colors(p_index int)
returns table(color text, bg text)
language sql
immutable
as $$
  select v.color, v.bg
  from (values
    (0, '#c8f564', '#2d4a1a'),
    (1, '#64c8f5', '#1a2d4a'),
    (2, '#f564a0', '#4a1a2d'),
    (3, '#ef9f27', '#4a3a1a'),
    (4, '#a78bfa', '#2d1a4a'),
    (5, '#34d399', '#1a4a2d')
  ) as v(idx, color, bg)
  where v.idx = (p_index % 6);
$$;

-- Runs when a user is created via sign-up OR Dashboard → Add user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pal record;
  disp text;
begin
  disp := public.flow_display_name(new.email, new.raw_user_meta_data);
  select * into pal from public.flow_profile_colors(abs(hashtext(new.id::text)) % 6);

  insert into public.profiles (id, name, email, color, bg, initial)
  values (new.id, disp, new.email, pal.color, pal.bg, upper(left(disp, 1)))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
