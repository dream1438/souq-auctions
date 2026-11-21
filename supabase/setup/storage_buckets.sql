-- Run once in the Supabase SQL editor, after the migrations.
-- Creates the two file buckets the site uses. Safe to run again.
--
--   listing-images       public   item photos, shown to every visitor
--   identity-documents   private  ID photos, opened only by the owner and the review team
--
-- The site uploads with the service role key and checks permissions itself,
-- so the buckets need no storage policies. Do not add a public policy to
-- identity-documents.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-images', 'listing-images', true, 4194304, array['image/jpeg', 'image/png', 'image/webp']),
  ('identity-documents', 'identity-documents', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
