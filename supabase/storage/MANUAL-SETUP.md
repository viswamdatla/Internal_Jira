# Supabase Storage — manual setup (`ticket-images`)

Use this if you prefer the Dashboard, or if `setup.sql` fails on bucket policies.

Project: [rnuqzkjeuthbgbjcfywx](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx)

## Option A — SQL (recommended)

1. Open [SQL Editor](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new)
2. Paste and run **`supabase/storage/setup.sql`**
3. Done — no empty folder needed in the UI; the app creates paths on first upload.

## Option B — Dashboard (create bucket manually)

### 1. Create the bucket

1. Go to [Storage](https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/storage/buckets)
2. Click **New bucket**
3. Settings:
   - **Name:** `ticket-images` (must match exactly)
   - **Public bucket:** ON
   - **File size limit:** 5 MB (5242880 bytes)
   - **Allowed MIME types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`
4. Click **Create bucket**

You do **not** need to create subfolders in the UI. FLOW uploads files automatically to:

```text
ticket-images/
  └── {project-id}/
        └── {ticket-id}/
              └── 1716192000000.jpg
```

### 2. Add policies

Still run **`setup.sql`** in the SQL Editor (only the policy section is required if the bucket already exists),  
**or** in Storage → `ticket-images` → **Policies**, add:

| Policy | Operation | Role        | Definition              |
|--------|-----------|-------------|-------------------------|
| Read   | SELECT    | public      | `bucket_id = 'ticket-images'` |
| Upload | INSERT    | authenticated | `bucket_id = 'ticket-images'` |
| Update | UPDATE    | authenticated | `bucket_id = 'ticket-images'` |
| Delete | DELETE    | authenticated | `bucket_id = 'ticket-images'` |

### 3. Database column

If not done yet, run in SQL Editor:

```sql
alter table public.tickets add column if not exists image_url text;
```

(`setup.sql` includes this.)

## Verify

1. Storage → Buckets → **ticket-images** exists and is **Public**
2. Create a ticket in FLOW, attach a photo, save
3. Storage → **ticket-images** — you should see a new folder path after save

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Bucket not found` | Bucket name must be exactly `ticket-images` |
| `new row violates row-level security` | Run `setup.sql` policies |
| `column image_url does not exist` | Run `setup.sql` or the `alter table` above |
| Upload works locally but not on Vercel | Redeploy; env vars must be set |
