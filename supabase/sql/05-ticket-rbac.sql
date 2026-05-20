-- FLOW — Step 5: ticket RBAC (creator + roles)
-- Run in SQL Editor after 01-schema.sql
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new

-- Roles on profiles (admin / super_admin can delete any ticket)
alter table public.profiles
  add column if not exists role text not null default 'member';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('member', 'admin', 'super_admin'));

-- Ticket creator (optional delete for creator)
alter table public.tickets
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.tickets
  add column if not exists assignee_id uuid references public.profiles (id) on delete set null;

create index if not exists tickets_created_by_idx on public.tickets (created_by);
create index if not exists tickets_assignee_id_idx on public.tickets (assignee_id);

-- Backfill assignee_id from assignee_name (best effort)
update public.tickets t
set assignee_id = p.id
from public.profiles p
where t.assignee_id is null
  and lower(trim(t.assignee_name)) = lower(trim(p.name));

-- Promote your account: replace email below, then run once
-- update public.profiles set role = 'admin' where email = 'you@company.com';
