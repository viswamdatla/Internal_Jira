# FLOW

Internal Kanban tracker — static site + [Supabase](https://rnuqzkjeuthbgbjcfywx.supabase.co).

## Setup

1. Copy `.env.example` → `.env`, add [anon key](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/settings/api).
2. SQL Editor: `01-schema.sql` → [Auth users](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/users) → `02-sync-auth-users.sql` → `03-ticket-images.sql` (task photos).
3. `npm install && npm run dev` → http://127.0.0.1:8765/flow.html

## Vercel

Import repo — **Build Command:** `npm run build`, **Output Directory:** `public` (set in `vercel.json`).

Add environment variables: `SUPABASE_URL` + `SUPABASE_ANON_KEY` (see `.env.example`). Set Supabase [Site URL](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/url-configuration) to your Vercel domain, then redeploy.
