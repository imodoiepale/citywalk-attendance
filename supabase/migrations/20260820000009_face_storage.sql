-- Private bucket for face enrolment photos.
--
-- Private, not public: a public bucket would make every staff photo readable by
-- anyone with the URL, which is precisely the exposure this design exists to
-- avoid. 5MB and image types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('face-enrollments', 'face-enrollments', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are keyed <profile_id>/<uuid>.<ext>, so the first path segment is the
-- owner and policies can be written against it.
drop policy if exists face_photos_own_write on storage.objects;
create policy face_photos_own_write on storage.objects for insert
  with check (
    bucket_id = 'face-enrollments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists face_photos_read on storage.objects;
create policy face_photos_read on storage.objects for select
  using (
    bucket_id = 'face-enrollments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or my_role() = 'admin'
      or has_min_access('admin.devices', 'full')
    )
  );

-- Deletion is how a revocation is honoured, so the owner must be able to do it
-- as well as an administrator.
drop policy if exists face_photos_delete on storage.objects;
create policy face_photos_delete on storage.objects for delete
  using (
    bucket_id = 'face-enrollments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or my_role() = 'admin'
      or has_min_access('admin.devices', 'full')
    )
  );
