-- FLOW — Step 3: ticket photos (run after 01-schema.sql)
-- https://supabase.com/dashboard/project/rnuqzkjeuthbgbjcfywx/sql/new

alter table public.tickets
  add column if not exists image_url text;

-- Storage bucket for ticket attachments (public read)
insert into storage.buckets (id, name, public)
values ('ticket-images', 'ticket-images', true)
on conflict (id) do update set public = true;

-- Authenticated users can upload / update / delete ticket images
drop policy if exists "ticket_images_insert" on storage.objects;
create policy "ticket_images_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_update" on storage.objects;
create policy "ticket_images_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_delete" on storage.objects;
create policy "ticket_images_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-images');

drop policy if exists "ticket_images_select" on storage.objects;
create policy "ticket_images_select"
  on storage.objects for select
  using (bucket_id = 'ticket-images');
