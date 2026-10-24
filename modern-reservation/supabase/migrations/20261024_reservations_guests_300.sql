-- Banquet / large-party bookings (UI already allows up to 300).
alter table public.reservations drop constraint if exists reservations_guests_check;
alter table public.reservations add constraint reservations_guests_check check (guests between 1 and 300);
