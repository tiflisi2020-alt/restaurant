-- ფაილის ადგილი პროექტში: public/sql/saved_checks.sql
-- Supabase Dashboard → SQL Editor → ჩასვით ეს ფაილი მთლიანად → Run.
--
-- თუ ადმინში ჩანს: „ცხრილი saved_checks არ არის“ — ეს სკრიპტი აუცილებელია.
-- სტუმრის შენახული ჩეკები (ადმინი → შენახული ჩეკები). ყველა მოწყობილობა ერთ სიას ხედავს.

create table if not exists public.saved_checks (
  id bigint primary key,
  name text,
  phone text,
  email text,
  res_date date,
  time_slot text,
  guests integer,
  payment text,
  table_id text,
  note text,
  disc numeric not null default 0,
  svc numeric not null default 0,
  adv numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  saved_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists saved_checks_saved_at_idx on public.saved_checks (saved_at desc);

alter table public.saved_checks enable row level security;

drop policy if exists "saved_checks_anon_select" on public.saved_checks;
create policy "saved_checks_anon_select"
  on public.saved_checks for select to anon using (true);

drop policy if exists "saved_checks_anon_insert" on public.saved_checks;
create policy "saved_checks_anon_insert"
  on public.saved_checks for insert to anon with check (true);

drop policy if exists "saved_checks_anon_update" on public.saved_checks;
create policy "saved_checks_anon_update"
  on public.saved_checks for update to anon using (true) with check (true);

drop policy if exists "saved_checks_anon_delete" on public.saved_checks;
create policy "saved_checks_anon_delete"
  on public.saved_checks for delete to anon using (true);

grant select, insert, update, delete on table public.saved_checks to anon;
grant select, insert, update, delete on table public.saved_checks to authenticated;

notify pgrst, 'reload schema';
