# FLOW — Internal Project Tracker

Kanban-style tracker for a small team. Static frontend + [Supabase](https://rnuqzkjeuthbgbjcfywx.supabase.co) (auth, database).

## Environment variables

Copy `.env.example` to `.env` and set your anon key:

```bash
cp .env.example .env   # Windows: copy .env.example .env
```

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Project URL (already set in `.env.example`) |
| `SUPABASE_ANON_KEY` | Anon / publishable key from [API settings](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/settings/api) |

`npm run build` writes `supabase/config.js` from these values (file is gitignored).

### Vercel

1. Project → **Settings** → **Environment Variables**
2. **Import .env** and select `.env.example`, then paste your real `SUPABASE_ANON_KEY`
3. Or add manually: `SUPABASE_URL` and `SUPABASE_ANON_KEY`
4. Enable for **Production** and **Preview**
5. Redeploy

Build command: `npm run build` (set automatically via `vercel.json`).

## Database setup

Run in Supabase SQL Editor, in order:

1. `supabase/sql/01-schema.sql`
2. Add users under [Authentication → Users](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/users) (**Add user**, **Auto Confirm User** on)
3. `supabase/sql/02-sync-auth-users.sql` (re-run after adding users)

## Local dev

```bash
npm install
npm run dev
```

Open http://127.0.0.1:8765/flow.html

## Deploy (Vercel)

Import [Internal_Jira](https://github.com/viswamdatla/Internal_Jira) on [Vercel](https://vercel.com) — **Framework: Other**, output directory `.`.

Set Supabase **Site URL** to your Vercel URL under [Auth URL config](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/auth/url-configuration).
