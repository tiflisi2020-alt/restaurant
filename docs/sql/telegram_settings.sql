-- ფაილის ადგილი პროექტში: public/sql/telegram_settings.sql
-- Supabase Dashboard → SQL Editor → ჩასვით ეს ფაილი მთლიანად → Run.
--
-- Telegram Bot Token და Chat ID ინახება settings ცხრილში (key: tg_token, tg_chatid).
-- ადმინის პაროლის ჩანაწერს (admin_pw) ეს სკრიპტი არ ცვლის.
-- უსაფრთხოა განმეორებით გაშვება.

create table if not exists public.settings (
  key text primary key,
  value text not null default ''
);

alter table public.settings enable row level security;

drop policy if exists "settings_anon_select" on public.settings;
create policy "settings_anon_select"
  on public.settings for select to anon using (true);

drop policy if exists "settings_anon_insert" on public.settings;
create policy "settings_anon_insert"
  on public.settings for insert to anon with check (true);

drop policy if exists "settings_anon_update" on public.settings;
create policy "settings_anon_update"
  on public.settings for update to anon using (true) with check (true);

grant select, insert, update on table public.settings to anon;
grant select, insert, update on table public.settings to authenticated;

insert into public.settings (key, value)
select 'tg_token', ''
where not exists (select 1 from public.settings where key = 'tg_token');

insert into public.settings (key, value)
select 'tg_chatid', ''
where not exists (select 1 from public.settings where key = 'tg_chatid');

notify pgrst, 'reload schema';
