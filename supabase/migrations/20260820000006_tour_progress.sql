-- Per-person record of which guided tours someone has finished.
--
-- Deliberately in the database rather than localStorage: branch devices are
-- shared kiosks, so localStorage would mark a tour complete for whoever signs
-- in next and they would never be shown it. Tour progress belongs to a person,
-- not a browser.
create table user_tour_progress (
  profile_id   uuid not null references profiles(id) on delete cascade,
  tour_id      text not null,
  completed_at timestamptz not null default now(),
  primary key (profile_id, tour_id)
);
comment on table user_tour_progress is
  'Which guided tours a person has completed. Keyed per user because branch devices are shared.';

alter table user_tour_progress enable row level security;

-- Strictly self-only, in both directions: a tour someone has seen is not
-- information anyone else needs, and nobody should be able to mark a tour
-- complete on another person''s behalf and rob them of the walkthrough.
create policy user_tour_progress_self_read on user_tour_progress for select
  using (profile_id = auth.uid());
create policy user_tour_progress_self_write on user_tour_progress for insert
  with check (profile_id = auth.uid());
create policy user_tour_progress_self_delete on user_tour_progress for delete
  using (profile_id = auth.uid());

-- Marking a tour done. on conflict do nothing so replaying it keeps the
-- original completion time rather than moving it forward.
create or replace function complete_tour(p_tour_id text)
returns void
language sql security invoker set search_path = public as $$
  insert into user_tour_progress (profile_id, tour_id)
  values (auth.uid(), p_tour_id)
  on conflict (profile_id, tour_id) do nothing;
$$;

grant execute on function complete_tour(text) to authenticated;
