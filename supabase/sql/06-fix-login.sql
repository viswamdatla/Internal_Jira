-- FLOW — Fix login + missing schema (run once in Supabase SQL Editor)
-- Fixes: profiles.role, Profile not found, flow_profile_colors,
--        tickets.assignee_id / tickets.created_by
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new
--
-- Safe to re-run. Does NOT drop projects/tickets.

-- ── 0) Helper functions (from 01-schema.sql — create if you skipped step 1) ──
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

-- Ensure profiles table exists (minimal — does not recreate if already there)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  email text not null unique,
  color text not null default '#c8f564',
  bg text not null default '#2d4a1a',
  initial text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select using (true);

-- ── 1) Role column (app expects this after RBAC update) ──
alter table public.profiles
  add column if not exists role text not null default 'member';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('member', 'admin', 'super_admin'));

-- ── 2) Sync every Auth user → profiles ──
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null
  and email is not null;

insert into public.profiles (id, name, email, color, bg, initial, role)
select
  u.id,
  public.flow_display_name(u.email, u.raw_user_meta_data),
  u.email,
  pal.color,
  pal.bg,
  upper(left(public.flow_display_name(u.email, u.raw_user_meta_data), 1)),
  'member'
from auth.users u
cross join lateral public.flow_profile_colors((abs(hashtext(u.id::text)) % 6)::int) pal
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  initial = excluded.initial;

-- ── 3) Ticket RBAC columns (from 05-ticket-rbac.sql) ──
alter table public.tickets
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.tickets
  add column if not exists assignee_id uuid references public.profiles (id) on delete set null;

create index if not exists tickets_created_by_idx on public.tickets (created_by);
create index if not exists tickets_assignee_id_idx on public.tickets (assignee_id);

update public.tickets t
set assignee_id = p.id
from public.profiles p
where t.assignee_id is null
  and lower(trim(t.assignee_name)) = lower(trim(p.name));

-- ── 4) Assigner columns + triggers — run full 07-ticket-assignment.sql for history/triggers
-- (minimal columns here; triggers live in 07)
alter table public.tickets
  add column if not exists assigned_by uuid references public.profiles (id) on delete set null;

alter table public.tickets
  add column if not exists assigned_at timestamptz;

alter table public.tickets
  add column if not exists updated_at timestamptz not null default now();

alter table public.tickets
  add column if not exists created_by_name text;

alter table public.tickets
  add column if not exists assigned_by_name text;

update public.tickets
set assigned_by = created_by,
    assigned_at = coalesce(assigned_at, created_at),
    assigned_by_name = created_by_name
where assigned_by is null and created_by is not null;

-- Optional: make yourself admin (edit email)
-- update public.profiles set role = 'admin' where email = 'viswam@gmail.com';
