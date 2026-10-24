-- Restaurant Tiflis Modern Reservation
-- Run once in Supabase SQL Editor. The server uses the service role key;
-- the browser never receives database credentials.

create extension if not exists pgcrypto;

create table if not exists public.restaurant_settings (
  id boolean primary key default true check (id = true),
  restaurant_name text not null default 'რესტორანი ტიფლისი',
  phone text not null default '+995 555 00 00 00',
  address text not null default 'თბილისი, საქართველო',
  opening_time time not null default '12:00',
  closing_time time not null default '23:00',
  slot_minutes integer not null default 30 check (slot_minutes in (15, 30, 60)),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  seats integer not null check (seats between 1 and 30),
  zone text not null default 'main',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  guest_name text not null,
  phone text not null,
  email text,
  reservation_date date not null,
  reservation_time time not null,
  guests integer not null check (guests between 1 and 300),
  table_id uuid references public.restaurant_tables(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','confirmed','seated','completed','cancelled','no_show')),
  notes text not null default '',
  source text not null default 'website' check (source in ('website','phone','walk_in','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_date_idx on public.reservations (reservation_date, reservation_time);
create index if not exists reservations_status_idx on public.reservations (status);
create unique index if not exists reservations_active_slot_unique
  on public.reservations (reservation_date, reservation_time, table_id)
  where status not in ('cancelled', 'no_show');

create table if not exists public.reservation_events (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  event_type text not null,
  actor text not null default 'system',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists reservations_updated_at on public.reservations;
create trigger reservations_updated_at before update on public.reservations
for each row execute function public.set_updated_at();

insert into public.restaurant_settings (id) values (true) on conflict (id) do nothing;

insert into public.restaurant_tables (name, seats, zone) values
  ('T01', 2, 'window'), ('T02', 2, 'window'), ('T03', 4, 'main'),
  ('T04', 4, 'main'), ('T05', 6, 'main'), ('T06', 8, 'family'),
  ('H-11', 6, 'hall'), ('H-12', 6, 'hall'), ('H-13', 3, 'hall'),
  ('H-14', 4, 'hall'), ('H-15', 2, 'hall'), ('H-16', 4, 'hall'),
  ('H-17', 2, 'hall'), ('H-18', 6, 'hall'), ('H-19', 4, 'hall'),
  ('A-20', 2, 'mezzanine'), ('A-21', 4, 'mezzanine'), ('A-22', 4, 'mezzanine'),
  ('A-23', 4, 'mezzanine'), ('A-24', 4, 'mezzanine'), ('A-25', 4, 'mezzanine'),
  ('A-26', 4, 'mezzanine'), ('A-27', 6, 'mezzanine'), ('A-28', 4, 'mezzanine'),
  ('A-29', 6, 'mezzanine'),
  ('V-1', 3, 'veranda'), ('V-2', 4, 'veranda'), ('V-3', 2, 'veranda'),
  ('V-4', 4, 'veranda'), ('V-5', 4, 'veranda'), ('V-6', 4, 'veranda'),
  ('V-7', 4, 'veranda'), ('V-8', 4, 'veranda')
on conflict (name) do update set seats = excluded.seats, zone = excluded.zone;

insert into public.menu_categories (name, sort_order)
select * from (values
  ('ცივი კერძები', 1), ('ცხელი კერძები', 2), ('ხინკალი', 3), ('დესერტი', 4)
) as seed(name, sort_order)
where not exists (select 1 from public.menu_categories);

alter table public.restaurant_settings enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_events enable row level security;

-- No public policies: all writes/read operations go through the server service role.
-- Never expose SUPABASE_SERVICE_ROLE_KEY in the browser.
