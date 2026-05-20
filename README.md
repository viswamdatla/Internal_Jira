# FLOW

Internal Kanban tracker — static site + [Supabase](https://rnuqzkjeuthbgbjcfywx.supabase.co).

## Setup

1. Copy `.env.example` → `.env`, add [anon key](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/settings/api).
2. SQL Editor — run in order:
   - `supabase/sql/01-schema.sql`
   - [Auth users](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/users) → `supabase/sql/02-sync-auth-users.sql`
   - **`supabase/storage/setup.sql`** (ticket photos — bucket + policies)
3. `npm install && npm run dev` → http://127.0.0.1:8765/flow.html

### Ticket photos (storage)

| File | Purpose |
|------|---------|
| [storage/setup.sql](supabase/storage/setup.sql) | Creates `ticket-images` bucket + RLS (run once) |
| [storage/MANUAL-SETUP.md](supabase/storage/MANUAL-SETUP.md) | Create bucket in Dashboard by hand |
| [storage/ticket-images/](supabase/storage/ticket-images/) | Docs for upload path layout |

## Vercel

Import repo — **Build Command:** `npm run build`, **Output Directory:** `public`.

Add `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Set [Auth Site URL](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/url-configuration) to your Vercel domain.
