-- Banquet / large-party bookings (UI + API allow up to 300).
-- Drops any existing guests CHECK (name may vary), then sets 1..300.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.reservations'::regclass
      and c.contype = 'c'
      and a.attname = 'guests'
  loop
    execute format('alter table public.reservations drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.reservations
  add constraint reservations_guests_check check (guests between 1 and 300);
