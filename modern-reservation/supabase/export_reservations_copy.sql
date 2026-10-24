-- =============================================================================
-- Restaurant Tiflis — ჯავშნების კოპირება
-- =============================================================================
-- 1) ძველი Supabase → SQL Editor → New query
-- 2) ჩასვი QUERY #1 → Run
-- 3) შედეგი: Ctrl+A / Ctrl+C (ან Copy cell)
-- 4) ჩატში ჩააგდე მთელი JSON — ჩავწერთ ამ პროექტის Supabase-ში
--
-- მხოლოდ კითხვაა — არაფერს ცვლის.
-- იღებს ყველა სვეტს: სახელი, ტელეფონი, თარიღი, საათი, მაგიდა,
-- სტატუსი, გადახდა, ავანსი, შენიშვნა, precheck_json (ჩეკი).
-- =============================================================================

-- QUERY #1 — რეკომენდებული (ლეგასი სქემა: name, date, time, table_id ტექსტი)
select jsonb_pretty(
  jsonb_build_object(
    'exported_at', to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'source', 'supabase',
    'reservations', coalesce((
      select jsonb_agg(to_jsonb(r))
      from public.reservations r
    ), '[]'::jsonb)
  )
) as reservations_export_json;


-- =============================================================================
-- QUERY #2 — თუ table_id არის uuid (ახალი სქემა) და გინდა მაგიდის სახელიც
-- მოხსენი /* */ და გაუშვი მხოლოდ ეს ბლოკი
-- =============================================================================
/*
select jsonb_pretty(
  jsonb_build_object(
    'exported_at', to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'source', 'supabase-v2',
    'reservations', coalesce((
      select jsonb_agg(
        to_jsonb(r) || jsonb_build_object('table_name', t.name)
      )
      from public.reservations r
      left join public.restaurant_tables t on t.id = r.table_id
    ), '[]'::jsonb)
  )
) as reservations_export_json;
*/
