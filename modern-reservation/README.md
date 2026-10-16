# Restaurant Tiflis — Modern Reservation

ცალკე, თანამედროვე რეზერვაციის აპლიკაცია Supabase მონაცემთა ბაზით.

სტუმრის საიტი და ადმინი ერთ production-ready Express API-ს იყენებს. ბრაუზერში არასდროს გადადის Supabase service-role secret.

## არქიტექტურა

- `server.js` — Express API და უსაფრთხო server-side Supabase client
- `public/` — სტუმრის საიტი და ადმინ პანელი
- `supabase/schema.sql` — ახალი ბაზის სქემა
- ბრაუზერს არ გადაეცემა Supabase service-role key
- აქტიური ერთი მაგიდის ორმაგი დაჯავშნა დაბლოკილია ბაზის უნიკალური ინდექსით
- ადმინის სესია არის ხელმოწერილი, ვადიანი HttpOnly cookie და არა server memory-ში შენახული session

## გაშვება

1. Supabase SQL Editor-ში გაუშვი `supabase/schema.sql`.
2. `copy .env.example .env` და შეავსე Supabase URL, service-role key, Admin password და განსხვავებული Session secret.
3. `npm install`
4. `npm start`
5. გახსენი `http://localhost:8855/` ან `http://localhost:8855/admin.html`.

## Vercel

ეს პროექტი მზად არის Vercel-ის serverless deployment-ისთვის. Vercel project-ში დაამატე შემდეგი encrypted environment variables Production, Preview და Development გარემოებში:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — მხოლოდ server-side secret, არ ჩასვა GitHub-ში და არ გამოიყენო ბრაუზერში
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

`SUPABASE_SERVICE_ROLE_KEY` არ ჩასვა GitHub-ში, README-ში ან frontend ფაილებში. Vercel-ში დაყენების შემდეგ redeploy აუცილებელია.

Vercel-ის Root Directory უნდა იყოს `modern-reservation`.

ეს ვერსია ძველ `public/` აპს არ ცვლის.
