-- FLOW — Clear all tickets (fresh start)
-- Run once in Supabase SQL Editor when you want to remove every ticket.
-- Keeps: projects, profiles, auth users, storage bucket setup.
-- Removes: all tickets + assignment history (cascade).
--
-- Optional: delete orphaned files in Dashboard → Storage → ticket-images

delete from public.ticket_assignment_history;
delete from public.tickets;

-- Verify
-- select count(*) from public.tickets;
