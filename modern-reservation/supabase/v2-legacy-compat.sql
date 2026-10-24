-- Restaurant Tiflis V2 compatibility layer for the full legacy UI.
-- Keeps the new UUID-based core while adding stable legacy IDs and operational data.

alter table public.menu_categories add column if not exists ka text;
alter table public.menu_categories add column if not exists en text;
alter table public.menu_categories add column if not exists ru text;
alter table public.menu_categories add column if not exists legacy_id integer;
alter table public.menu_items add column if not exists ka text;
alter table public.menu_items add column if not exists en text;
alter table public.menu_items add column if not exists ru text;
alter table public.menu_items add column if not exists cat integer;
alter table public.menu_items add column if not exists p numeric(10,2);
alter table public.menu_items add column if not exists active boolean not null default true;
alter table public.menu_items add column if not exists legacy_id integer;

create unique index if not exists menu_categories_legacy_id_uidx on public.menu_categories(legacy_id) where legacy_id is not null;
create unique index if not exists menu_items_legacy_id_uidx on public.menu_items(legacy_id) where legacy_id is not null;

update public.menu_categories set ka = coalesce(ka, name), en = coalesce(en, name), ru = coalesce(ru, name) where ka is null or en is null or ru is null;
with ranked as (
  select id, row_number() over (order by sort_order, id) as n
  from public.menu_categories
)
update public.menu_categories c set legacy_id = ranked.n from ranked where c.id = ranked.id and c.legacy_id is null;

update public.menu_items i set
  ka = coalesce(i.ka, i.name),
  en = coalesce(i.en, i.name),
  ru = coalesce(i.ru, i.name),
  p = coalesce(i.p, i.price),
  cat = coalesce(i.cat, (select c.legacy_id from public.menu_categories c where c.id = i.category_id)),
  active = coalesce(i.active, i.is_available)
where i.ka is null or i.en is null or i.ru is null or i.p is null or i.cat is null;
with ranked as (
  select id, row_number() over (order by sort_order, created_at, id) as n
  from public.menu_items
)
update public.menu_items i set legacy_id = ranked.n from ranked where i.id = ranked.id and i.legacy_id is null;

create table if not exists public.settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.settings(key,value) values
  ('admin_pw','Ialkani2@'),
  ('tg_token',''),
  ('tg_chatid','')
on conflict (key) do nothing;

create table if not exists public.table_groups (
  group_code text primary key,
  name text not null default 'ბანკეტი',
  table_ids jsonb not null default '[]'::jsonb,
  status text not null default 'merged',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.table_operations (
  table_id text not null,
  business_date date not null,
  status text not null default 'free',
  guest_name text,
  guests integer,
  source text not null default 'admin',
  reservation_id text,
  seated_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key(table_id,business_date)
);
create table if not exists public.saved_checks (
  id text primary key,
  name text,
  phone text,
  date date,
  time time,
  guests integer,
  table_id text,
  note text,
  disc numeric(10,2) default 0,
  svc numeric(10,2) default 0,
  adv numeric(10,2) default 0,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) default 0,
  total numeric(10,2) default 0,
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
alter table public.table_groups enable row level security;
alter table public.table_operations enable row level security;
alter table public.saved_checks enable row level security;
-- Legacy bridge is server-mediated; no anon policies are added.

-- Seed a small editable Georgian menu only when the new project is empty.
insert into public.menu_items(legacy_id,category_id,ka,en,ru,name,description,price,p,cat,active,is_available,sort_order)
select * from (
  select 1, c.id, 'ქართული სალათი', 'Georgian Salad', 'Грузинский салат', 'ქართული სალათი', 'პომიდორი, კიტრი, მწვანილი, კაკალი', 14.00, 14.00, c.legacy_id, true, true, 1 from public.menu_categories c where c.legacy_id=1
  union all select 2, c.id, 'აჯაფსანდალი', 'Ajapsandali', 'Аджапсандали', 'აჯაფსანდალი', 'ბადრიჯანი, პომიდორი და მწვანილი', 16.00, 16.00, c.legacy_id, true, true, 2 from public.menu_categories c where c.legacy_id=1
  union all select 3, c.id, 'ხინკალი ქალაქური', 'Khinkali Kalakuri', 'Хинкали калакури', 'ხინკალი ქალაქური', 'საქონლისა და ღორის ხორცით', 2.20, 2.20, c.legacy_id, true, true, 1 from public.menu_categories c where c.legacy_id=3
  union all select 4, c.id, 'ხაჭაპური აჭარული', 'Adjarian Khachapuri', 'Аджарский хачапури', 'ხაჭაპური აჭარული', 'ყველი, კვერცხი და კარაქი', 22.00, 22.00, c.legacy_id, true, true, 1 from public.menu_categories c where c.legacy_id=2
  union all select 5, c.id, 'ჩაქაფული', 'Chakapuli', 'Чакапули', 'ჩაქაფული', 'ბატკნის ხორცი, ტარხუნა და მწვანილი', 28.00, 28.00, c.legacy_id, true, true, 2 from public.menu_categories c where c.legacy_id=2
  union all select 6, c.id, 'ჩურჩხელა', 'Churchkhela', 'Чурчхела', 'ჩურჩხელა', 'ტრადიციული ქართული დესერტი', 8.00, 8.00, c.legacy_id, true, true, 1 from public.menu_categories c where c.legacy_id=4
) seed(legacy_id,category_id,ka,en,ru,name,description,price,p,cat,active,is_available,sort_order)
where not exists (select 1 from public.menu_items);
