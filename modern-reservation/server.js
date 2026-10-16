import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const port = Number(process.env.PORT || 8855);
const timezone = process.env.RESTAURANT_TIMEZONE || 'Asia/Tbilisi';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const dbReady = Boolean(supabaseUrl && serviceKey);
const sessionReady = Boolean(adminPassword && sessionSecret);

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const dateOk = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const timeOk = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const encode = (value) => encodeURIComponent(value);

function zonedParts() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}
function todayInTimezone() { const p = zonedParts(); return `${p.year}-${p.month}-${p.day}`; }
function nowMinutesInTimezone() { const p = zonedParts(); return Number(p.hour) * 60 + Number(p.minute); }
function timeToMinutes(value) { const [hour, minute] = String(value).slice(0, 5).split(':').map(Number); return hour * 60 + minute; }
function formatTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function cookie(req, name) { const part = (req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`)); return part ? decodeURIComponent(part.slice(name.length + 1)) : ''; }
function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }
function createSession() { const payload = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url'); return `${payload}.${sign(payload)}`; }
function validSession(token) { try { const [payload, signature] = String(token).split('.'); if (!payload || !signature || !sessionSecret || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return false; return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; } }
function setSessionCookie(res, token, maxAge = 8 * 60 * 60) { const secure = process.env.VERCEL === '1' ? '; Secure' : ''; res.setHeader('Set-Cookie', `tiflis_admin=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`); }

async function supa(table, query = '', options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, { ...options, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) } });
  const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) { const error = new Error(typeof body === 'object' ? body.message || body.hint || 'Supabase error' : String(body)); error.status = response.status; error.code = body?.code; throw error; }
  return body;
}

const requireDb = (_req, res, next) => dbReady ? next() : res.status(503).json({ error: 'ბაზასთან კავშირი ჯერ არ არის გამართული.' });
const requireAdmin = (req, res, next) => validSession(cookie(req, 'tiflis_admin')) ? next() : res.status(401).json({ error: 'ადმინის ავტორიზაცია საჭიროა.' });

app.get('/api/health', (_req, res) => res.json({ ok: true, supabase: dbReady, admin: sessionReady, timezone }));
app.get('/api/settings', requireDb, asyncRoute(async (_req, res) => res.json((await supa('restaurant_settings', '?id=eq.true&select=*'))[0] || null)));
app.get('/api/menu', requireDb, asyncRoute(async (_req, res) => res.json(await supa('menu_items', '?is_available=eq.true&select=id,name,description,price,image_url,menu_categories(name,sort_order)&order=sort_order'))));

app.get('/api/availability', requireDb, asyncRoute(async (req, res) => {
  const date = clean(req.query.date, 10); const guests = Number(req.query.guests || 2);
  if (!dateOk(date) || date < todayInTimezone() || !Number.isInteger(guests) || guests < 1 || guests > 30) return res.status(400).json({ error: 'აირჩიეთ დღევანდელი ან მომავალი თარიღი და 1–30 სტუმარი.' });
  const settings = (await supa('restaurant_settings', '?id=eq.true&select=opening_time,closing_time,slot_minutes'))[0] || { opening_time: '12:00', closing_time: '23:00', slot_minutes: 30 };
  const [tables, reservations] = await Promise.all([
    supa('restaurant_tables', `?is_active=eq.true&seats=gte.${guests}&select=id,name,seats,zone&order=seats`),
    supa('reservations', `?reservation_date=eq.${encode(date)}&status=not.in.(cancelled,no_show)&select=reservation_time,table_id`)
  ]);
  const busy = new Set((reservations || []).map((item) => `${String(item.reservation_time).slice(0, 5)}|${item.table_id}`));
  const start = timeToMinutes(settings.opening_time); const end = timeToMinutes(settings.closing_time); const step = Number(settings.slot_minutes) || 30; const slots = [];
  for (let minute = start; minute < end; minute += step) {
    if (date === todayInTimezone() && minute <= nowMinutesInTimezone() + 30) continue;
    const time = formatTime(minute); const freeTables = (tables || []).filter((table) => !busy.has(`${time}|${table.id}`));
    if (freeTables.length) slots.push({ time, tables: freeTables });
  }
  res.json({ date, guests, slots });
}));

app.post('/api/reservations', requireDb, asyncRoute(async (req, res) => {
  const body = req.body || {}; const guest_name = clean(body.guest_name, 100); const phone = clean(body.phone, 40); const email = clean(body.email, 160); const reservation_date = clean(body.reservation_date, 10); const reservation_time = clean(body.reservation_time, 5); const guests = Number(body.guests); const table_id = clean(body.table_id, 60); const notes = clean(body.notes, 500);
  if (!guest_name || !phone || !dateOk(reservation_date) || reservation_date < todayInTimezone() || !timeOk(reservation_time) || !Number.isInteger(guests) || guests < 1 || guests > 30 || !table_id) return res.status(400).json({ error: 'გთხოვთ ყველა სავალდებულო ველი სწორად შეავსოთ.' });
  const tables = await supa('restaurant_tables', `?id=eq.${encode(table_id)}&is_active=eq.true&select=id,seats`); const table = tables[0];
  if (!table || table.seats < guests) return res.status(400).json({ error: 'არჩეული მაგიდა აღარ არის ხელმისაწვდომი.' });
  const confirmation_code = `TF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  try {
    const inserted = await supa('reservations', '', { method: 'POST', body: JSON.stringify({ confirmation_code, guest_name, phone, email: email || null, reservation_date, reservation_time: `${reservation_time}:00`, guests, table_id, notes }) });
    const data = inserted[0]; await supa('reservation_events', '', { method: 'POST', body: JSON.stringify({ reservation_id: data.id, event_type: 'created', actor: 'website' }) });
    res.status(201).json(data);
  } catch (error) {
    if (error.code === '23505' || error.status === 409) return res.status(409).json({ error: 'ეს მაგიდა ამ დროს უკვე დაჯავშნილია. გთხოვთ სხვა დრო აირჩიოთ.' });
    throw error;
  }
}));

app.post('/api/admin/login', (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: 'ადმინის უსაფრთხოების პარამეტრები ჯერ არ არის გამართული.' });
  if (clean(req.body?.password, 200) !== adminPassword) return res.status(401).json({ error: 'პაროლი არასწორია.' });
  setSessionCookie(res, createSession()); res.json({ ok: true });
});
app.post('/api/admin/logout', requireAdmin, (_req, res) => { setSessionCookie(res, '', 0); res.json({ ok: true }); });
app.get('/api/admin/session', (req, res) => res.json({ authenticated: validSession(cookie(req, 'tiflis_admin')) }));
app.get('/api/admin/reservations', requireDb, requireAdmin, asyncRoute(async (req, res) => { const date = clean(req.query.date, 10); const filter = dateOk(date) ? `&reservation_date=eq.${encode(date)}` : ''; res.json(await supa('reservations', `?select=*,restaurant_tables(name,seats,zone)&order=reservation_date.asc,reservation_time.asc&limit=200${filter}`)); }));
app.patch('/api/admin/reservations/:id', requireDb, requireAdmin, asyncRoute(async (req, res) => { const status = clean(req.body?.status, 20); if (!['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'სტატუსი არასწორია.' }); const updated = await supa('reservations', `?id=eq.${encode(req.params.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); const data = updated[0]; await supa('reservation_events', '', { method: 'POST', body: JSON.stringify({ reservation_id: data.id, event_type: `status:${status}`, actor: 'admin' }) }); res.json(data); }));

app.use((error, _req, res, _next) => { console.error(error); res.status(error.status && error.status < 500 ? error.status : 500).json({ error: error.status && error.status < 500 ? error.message : 'სერვერის შეცდომა. სცადეთ მოგვიანებით.' }); });
export default app;
if (process.env.VERCEL !== '1') app.listen(port, () => console.log(`Modern reservation running at http://localhost:${port}`));
