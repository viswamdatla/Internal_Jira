# FLOW

Internal Kanban tracker — static site + [Supabase](https://rnuqzkjeuthbgbjcfywx.supabase.co).

## Setup

1. Copy `.env.example` → `.env`, add [anon key](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/settings/api).
2. SQL Editor: `supabase/sql/01-schema.sql` → add users in [Auth](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/users) → `supabase/sql/02-sync-auth-users.sql`.
3. `npm install && npm run dev` → http://127.0.0.1:8765/flow.html

## Vercel

Import repo, no build output override (uses `npm run build`). Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` from `.env.example`. Set Supabase [Site URL](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/url-configuration) to your Vercel domain.
