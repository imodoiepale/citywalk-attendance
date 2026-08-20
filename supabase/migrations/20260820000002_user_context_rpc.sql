-- One round trip for the caller's identity instead of two.
--
-- getCurrentUser() ran a profile+branch select and then the my_permissions()
-- RPC, sequentially, on every request — the layout needs it before any page can
-- render. Measured round-trip latency from Nairobi to this project (eu-west-1)
-- is ~0.5s, so that second query cost roughly half a second on every single
-- navigation, before the page had issued a single query of its own.
--
-- Query execution was never the problem; the number of sequential hops was.
create or replace function my_context()
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id',          p.id,
    'email',       p.email,
    'full_name',   p.full_name,
    'role',        p.role,
    'job_title',   p.job_title,
    'is_active',   p.is_active,
    'branch_id',   b.id,
    'branch_name', b.name,
    'branch_code', b.code,
    'permissions', coalesce(
      (select jsonb_object_agg(rp.permission, rp.access_level)
         from role_permissions rp
        where rp.role = p.role),
      '{}'::jsonb
    )
  )
  from profiles p
  join branches b on b.id = p.branch_id
  where p.id = auth.uid();
$$;

comment on function my_context is
  'Profile, branch and the caller''s permission map in a single round trip. Security definer so it can read role_permissions, which stays admin-only for direct table access — same reasoning as my_permissions().';

grant execute on function my_context() to authenticated;
