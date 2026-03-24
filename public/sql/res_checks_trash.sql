-- ფაილის ადგილი პროექტში: public/sql/res_checks_trash.sql (იგივე საქაღალდე რაც index.html).
-- Supabase Dashboard → SQL Editor → ჩასვით ეს ფაილი მთლიანად → Run.
--
-- თუ ბრაუზერში ჩანს: „Could not find the table res_checks_trash“ — ეს სკრიპტი აუცილებელია.
-- გაუქმებული ჩეკიანი ჯავშნების არქივი (admin „ურნა“). წაშლა არა — snapshot აქ ინახება.

create table if not exists public.res_checks_trash (
  id uuid primary key default gen_random_uuid(),
  reservation_id text not null,
  cancelled_at timestamptz not null default now(),
  res_date date,
  name text,
  phone text,
  time_slot text,
  table_id text,
  guests integer,
  note text,
  precheck_json jsonb,
  previous_status text,
  constraint res_checks_trash_reservation_id_key unique (reservation_id)
);

create index if not exists res_checks_trash_res_date_idx on public.res_checks_trash (res_date desc nulls last);
create index if not exists res_checks_trash_cancelled_at_idx on public.res_checks_trash (cancelled_at desc);

alter table public.res_checks_trash enable row level security;

drop policy if exists "res_checks_trash_anon_select" on public.res_checks_trash;
create policy "res_checks_trash_anon_select"
  on public.res_checks_trash for select to anon using (true);

drop policy if exists "res_checks_trash_anon_insert" on public.res_checks_trash;
create policy "res_checks_trash_anon_insert"
  on public.res_checks_trash for insert to anon with check (true);

drop policy if exists "res_checks_trash_anon_update" on public.res_checks_trash;
create policy "res_checks_trash_anon_update"
  on public.res_checks_trash for update to anon using (true) with check (true);

drop policy if exists "res_checks_trash_anon_delete" on public.res_checks_trash;
create policy "res_checks_trash_anon_delete"
  on public.res_checks_trash for delete to anon using (true);

grant select, insert, update, delete on table public.res_checks_trash to anon;
grant select, insert, update, delete on table public.res_checks_trash to authenticated;
