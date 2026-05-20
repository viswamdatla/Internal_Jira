-- FLOW — Step 3: ticket photos
-- Prefer running the full storage setup (bucket + column + policies):
--
--   supabase/storage/setup.sql
--
-- Or run this file only if you already created the bucket manually in Dashboard.

alter table public.tickets
  add column if not exists image_url text;

alter table public.tickets
  add column if not exists image_urls text[];

-- If bucket "ticket-images" does not exist yet, run storage/setup.sql instead of duplicating policies here.
