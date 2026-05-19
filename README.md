# FLOW — Internal Project Tracker

Kanban-style tracker for a small team. Static frontend + [Supabase](https://rnuqzkjeuthbgbjcfywx.supabase.co) (auth, database).

## Setup

1. Paste your **anon key** in `supabase/config.js` ([API settings](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/settings/api)).
2. Run in Supabase SQL Editor, in order:
   - `supabase/sql/01-schema.sql`
   - Add users under [Authentication → Users](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/users) (**Add user**, **Auto Confirm User** on)
   - `supabase/sql/02-sync-auth-users.sql` (re-run after adding users)

## Local dev

```bash
npm install
npm run dev
```

Open http://127.0.0.1:8765/flow.html

## Deploy (Vercel)

Import this repo on [Vercel](https://vercel.com) — **Framework: Other**, no build command, output directory `.`.

Set Supabase **Site URL** to your Vercel URL under [Auth URL config](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/url-configuration).
