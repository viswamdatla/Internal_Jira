-- FLOW — Storage bucket for ticket photos
-- Run in SQL Editor: https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new
--
-- Creates bucket: ticket-images (public read)
-- App uploads to paths like:  {project-uuid}/{ticket-uuid}/{timestamp}.jpg

-- ── 1) Database columns (safe to re-run) ──
alter table public.tickets
  add column if not exists image_url text;

alter table public.tickets
  add column if not exists image_urls text[];

-- Migrate legacy single image_url into image_urls
update public.tickets
set image_urls = array[image_url]
where image_url is not null
  and (image_urls is null or cardinality(image_urls) = 0);

-- ── 2) Bucket ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-images',
  'ticket-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- ── 3) Policies (logged-in users can upload / manage; anyone can read public URLs) ──
drop policy if exists "ticket_images_insert" on storage.objects;
create policy "ticket_images_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_update" on storage.objects;
create policy "ticket_images_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'ticket-images')
  with check (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_delete" on storage.objects;
create policy "ticket_images_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_select" on storage.objects;
create policy "ticket_images_select"
  on storage.objects for select
  using (bucket_id = 'ticket-images');

-- Public read for direct URLs (required when bucket is public)
drop policy if exists "ticket_images_select_public" on storage.objects;
create policy "ticket_images_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'ticket-images');

-- Ensure authenticated team members can always read attachments via API
drop policy if exists "ticket_images_select_authenticated" on storage.objects;
create policy "ticket_images_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ticket-images');
