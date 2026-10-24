-- =============================================================================
-- Restaurant Tiflis — მენიუს კოპირება (კატეგორიები + კერძები + ფასები)
-- =============================================================================
-- 1) Supabase → SQL Editor → New query
-- 2) ჩასვი QUERY #1 → Run
-- 3) შედეგი: Ctrl+A / Ctrl+C (ან Copy cell)
-- 4) ჩატში ჩააგდე მთელი JSON — ჩავამატებთ არსებულ მენიუში
--
-- მხოლოდ კითხვაა — არაფერს ცვლის.
-- =============================================================================

-- QUERY #1 — რეკომენდებული (ლეგასი სქემა: id, ka, en, ru, p, cat, active)
select jsonb_pretty(
  jsonb_build_object(
    'exported_at', to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'source', 'supabase',
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'ka', c.ka,
          'en', c.en,
          'ru', c.ru,
          'sort_order', coalesce(c.sort_order, c.id)
        )
        order by coalesce(c.sort_order, c.id), c.id
      )
      from public.menu_categories c
    ), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'ka', i.ka,
          'en', i.en,
          'ru', i.ru,
          'p', coalesce(i.p, 0),
          'cat', coalesce(i.cat, 0),
          'active', coalesce(i.active, true)
        )
        order by coalesce(i.cat, 0), i.id
      )
      from public.menu_items i
      where coalesce(i.active, true) = true
    ), '[]'::jsonb)
  )
) as menu_export_json;


-- =============================================================================
-- QUERY #2 — თუ #1 შეცდომას იძლევა (სვეტები name/price/legacy_id/is_available)
-- მოხსენი /* */ და გაუშვი მხოლოდ ეს ბლოკი
-- =============================================================================
/*
select jsonb_pretty(
  jsonb_build_object(
    'exported_at', to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'source', 'supabase-v2',
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', coalesce(c.legacy_id, 0),
          'ka', coalesce(c.ka, c.name, ''),
          'en', coalesce(c.en, c.name, ''),
          'ru', coalesce(c.ru, c.name, ''),
          'sort_order', coalesce(c.sort_order, 0)
        )
        order by coalesce(c.sort_order, 0), coalesce(c.legacy_id, 0)
      )
      from public.menu_categories c
      where coalesce(c.is_active, true)
    ), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', coalesce(i.legacy_id, 0),
          'ka', coalesce(i.ka, i.name, ''),
          'en', coalesce(i.en, i.name, ''),
          'ru', coalesce(i.ru, i.name, ''),
          'p', coalesce(i.p, i.price, 0),
          'cat', coalesce(
            i.cat,
            (select c2.legacy_id from public.menu_categories c2 where c2.id = i.category_id),
            0
          ),
          'active', coalesce(i.active, i.is_available, true)
        )
        order by coalesce(i.cat, 0), coalesce(i.sort_order, 0), coalesce(i.legacy_id, 0)
      )
      from public.menu_items i
      where coalesce(i.active, i.is_available, true)
    ), '[]'::jsonb)
  )
) as menu_export_json;
*/


-- =============================================================================
-- ალტერნატივა ადმინიდან (SQL-ის გარეშე):
-- ადმინი → პარამეტრები → ღილაკი «JSON» (exportMenuJSON)
-- ი�ები → ღილაკი «JSON» (exportMenuJSON)
-- იგივე ფორმატის ფაილი ჩამოიტვირთება.
-- =============================================================================
