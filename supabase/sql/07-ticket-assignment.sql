-- FLOW — Step 7: permanent creator + assigner + assignment history
-- Run in SQL Editor after 05-ticket-rbac.sql (or 06-fix-login.sql section 3)
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new
--
-- Enterprise model:
--   created_by     = original creator (never changes)
--   assigned_by    = user who last assigned/reassigned (updates on assignee change)
--   assignee_id    = assigned to (who owns the work)

-- ── Columns ──
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

create index if not exists tickets_assigned_by_idx on public.tickets (assigned_by);

-- Backfill from existing creator / assignee
update public.tickets t
set created_by_name = p.name
from public.profiles p
where t.created_by = p.id
  and (t.created_by_name is null or t.created_by_name = '');

update public.tickets
set assigned_by = created_by,
    assigned_at = coalesce(assigned_at, created_at),
    assigned_by_name = created_by_name
where assigned_by is null
  and created_by is not null;

update public.tickets t
set assigned_by_name = p.name
from public.profiles p
where t.assigned_by = p.id
  and (t.assigned_by_name is null or t.assigned_by_name = '');

-- ── Assignment audit trail ──
create table if not exists public.ticket_assignment_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  assignee_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists ticket_assignment_history_ticket_idx
  on public.ticket_assignment_history (ticket_id, created_at desc);

alter table public.ticket_assignment_history enable row level security;

drop policy if exists "ticket_assignment_history_select" on public.ticket_assignment_history;
create policy "ticket_assignment_history_select"
  on public.ticket_assignment_history for select to authenticated using (true);

-- ── Server-side assignment integrity (ignore client spoofing) ──
create or replace function public.flow_ticket_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pname text;
begin
  if uid is not null then
    new.created_by := uid;
    new.assigned_by := uid;
    select name into pname from public.profiles where id = uid;
    new.created_by_name := pname;
    new.assigned_by_name := pname;
  end if;
  new.assigned_at := coalesce(new.assigned_at, now());
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.flow_ticket_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pname text;
  reassigned boolean;
begin
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;

  reassigned := (new.assignee_id is distinct from old.assignee_id)
    or (lower(trim(coalesce(new.assignee_name, ''))) is distinct from lower(trim(coalesce(old.assignee_name, ''))));

  if reassigned and uid is not null then
    new.assigned_by := uid;
    new.assigned_at := now();
    select name into pname from public.profiles where id = uid;
    new.assigned_by_name := pname;
  else
    new.assigned_by := old.assigned_by;
    new.assigned_by_name := old.assigned_by_name;
    new.assigned_at := old.assigned_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.flow_ticket_after_insert_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_assignment_history (ticket_id, assigned_by, assigned_to, assignee_name)
  values (new.id, new.assigned_by, new.assignee_id, new.assignee_name);
  return new;
end;
$$;

create or replace function public.flow_ticket_after_update_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.assignee_id is distinct from old.assignee_id)
    or (lower(trim(coalesce(new.assignee_name, ''))) is distinct from lower(trim(coalesce(old.assignee_name, '')))) then
    insert into public.ticket_assignment_history (ticket_id, assigned_by, assigned_to, assignee_name)
    values (new.id, new.assigned_by, new.assignee_id, new.assignee_name);
  end if;
  return new;
end;
$$;

drop trigger if exists flow_ticket_before_insert on public.tickets;
create trigger flow_ticket_before_insert
  before insert on public.tickets
  for each row execute function public.flow_ticket_before_insert();

drop trigger if exists flow_ticket_before_update on public.tickets;
create trigger flow_ticket_before_update
  before update on public.tickets
  for each row execute function public.flow_ticket_before_update();

drop trigger if exists flow_ticket_after_insert_history on public.tickets;
create trigger flow_ticket_after_insert_history
  after insert on public.tickets
  for each row execute function public.flow_ticket_after_insert_history();

drop trigger if exists flow_ticket_after_update_history on public.tickets;
create trigger flow_ticket_after_update_history
  after update on public.tickets
  for each row execute function public.flow_ticket_after_update_history();
