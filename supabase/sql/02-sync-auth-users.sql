-- FLOW — Step 2: sync ALL users from Authentication → Users into profiles
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new
--
-- Use this after adding users in the dashboard:
--   Authentication → Users → Add user → Create new user
--   • Email + password
--   • Turn ON "Auto Confirm User" (recommended), OR run this script to confirm them
--   • Optional User Metadata: {"name": "Viswam"}  (otherwise name comes from email)
--
-- Safe to re-run whenever you add new users.
-- Requires flow_display_name + flow_profile_colors (run 01-schema.sql or 06-fix-login.sql first).

-- Confirm anyone still waiting on email verification
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null
  and email is not null;

-- Create or refresh profiles for every auth user
insert into public.profiles (id, name, email, color, bg, initial)
select
  u.id,
  public.flow_display_name(u.email, u.raw_user_meta_data),
  u.email,
  pal.color,
  pal.bg,
  upper(left(public.flow_display_name(u.email, u.raw_user_meta_data), 1))
from auth.users u
cross join lateral public.flow_profile_colors((abs(hashtext(u.id::text)) % 6)::int) pal
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  initial = excluded.initial;
  -- color/bg left as-is on update so avatars stay stable
