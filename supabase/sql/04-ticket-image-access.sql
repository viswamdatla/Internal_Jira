-- FLOW — Step 4: ensure ticket image columns + storage read access
-- Run after storage/setup.sql if assignees cannot see attachments.
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new

alter table public.tickets
  add column if not exists image_url text;

alter table public.tickets
  add column if not exists image_urls text[];

update public.tickets
set image_urls = array[image_url]
where image_url is not null
  and (image_urls is null or cardinality(image_urls) = 0);

-- Re-apply storage read policies (safe to re-run)
drop policy if exists "ticket_images_select_public" on storage.objects;
create policy "ticket_images_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_select_authenticated" on storage.objects;
create policy "ticket_images_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ticket-images');
