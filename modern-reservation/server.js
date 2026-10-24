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

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

const publicDir = path.join(__dirname, 'public');
const publicIndex = path.join(publicDir, 'index.html');
const adminLoginPage = path.join(publicDir, 'admin', 'index.html');
app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(adminLoginPage));
app.get(['/admin/panel', '/admin/panel/'], (_req, res) => res.sendFile(publicIndex));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(png|jpe?g|webp|gif|ico|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

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
const SECRET_SETTING_KEYS = new Set(['admin_pw', 'admin_pw_hash']);
function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length !== right.length) { crypto.timingSafeEqual(left, left); return false; }
  return crypto.timingSafeEqual(left, right);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 32).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(String(password), salt, 32);
  const expected = Buffer.from(hash, 'base64url');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
async function upsertSetting(key, value) {
  const existing = await supa('settings', `?key=eq.${encode(key)}&select=key`);
  if (existing.length) return supa('settings', `?key=eq.${encode(key)}`, { method: 'PATCH', body: JSON.stringify({ value: String(value) }) });
  return supa('settings', '', { method: 'POST', body: JSON.stringify({ key, value: String(value) }) });
}
async function loadPasswordRecord() {
  if (!dbReady) return { hash: '', plain: '' };
  const rows = await supa('settings', '?key=in.(admin_pw_hash,admin_pw)&select=key,value');
  const map = Object.fromEntries((rows || []).map((row) => [row.key, row.value || '']));
  return { hash: map.admin_pw_hash || '', plain: map.admin_pw || '' };
}
async function passwordMatches(input) {
  const record = await loadPasswordRecord();
  if (record.hash) return { ok: verifyPassword(input, record.hash), source: 'hash', record };
  if (record.plain && safeEqual(input, record.plain)) return { ok: true, source: 'plain', record };
  if (adminPassword && safeEqual(input, adminPassword)) return { ok: true, source: 'env', record };
  return { ok: false, source: '', record };
}
async function savePasswordHash(password) {
  await upsertSetting('admin_pw_hash', hashPassword(password));
  try { await supa('settings', '?key=eq.admin_pw', { method: 'DELETE' }); } catch { /* plaintext row may already be gone */ }
}
function passwordConfigured(record) { return Boolean(record.hash || record.plain || adminPassword); }

async function supa(table, query = '', options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, { ...options, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) } });
  const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) { const error = new Error(typeof body === 'object' ? body.message || body.hint || 'Supabase error' : String(body)); error.status = response.status; error.code = body?.code; throw error; }
  return body;
}

const requireDb = (_req, res, next) => dbReady ? next() : res.status(503).json({ error: 'ბაზასთან კავშირი ჯერ არ არის გამართული.' });
const requireAdmin = (req, res, next) => validSession(cookie(req, 'tiflis_admin')) ? next() : res.status(401).json({ error: 'ადმინის ავტორიზაცია საჭიროა.' });

app.get('/api/health', (_req, res) => res.json({ ok: true, supabase: dbReady, admin: Boolean(sessionSecret && (adminPassword || dbReady)), timezone }));
app.get('/api/settings', requireDb, asyncRoute(async (_req, res) => res.json((await supa('restaurant_settings', '?id=eq.true&select=*'))[0] || null)));
app.get('/api/menu', requireDb, asyncRoute(async (_req, res) => res.json(await supa('menu_items', '?is_available=eq.true&select=id,name,description,price,image_url,menu_categories(name,sort_order)&order=sort_order'))));

app.get('/api/availability', requireDb, asyncRoute(async (req, res) => {
  const date = clean(req.query.date, 10); const guests = Number(req.query.guests || 2);
  if (!dateOk(date) || date < todayInTimezone() || !Number.isInteger(guests) || guests < 1 || guests > 300) return res.status(400).json({ error: 'აირჩიეთ დღევანდელი ან მომავალი თარიღი და 1–300 სტუმარი.' });
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
  if (!guest_name || !phone || !dateOk(reservation_date) || reservation_date < todayInTimezone() || !timeOk(reservation_time) || !Number.isInteger(guests) || guests < 1 || guests > 300 || !table_id) return res.status(400).json({ error: 'გთხოვთ ყველა სავალდებულო ველი სწორად შეავსოთ (სტუმრები 1–300).' });
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

app.post('/api/admin/login', asyncRoute(async (req, res) => {
  if (!sessionSecret || (!adminPassword && !dbReady)) return res.status(503).json({ error: 'ადმინის უსაფრთხოების პარამეტრები ჯერ არ არის გამართული.' });
  const password = clean(req.body?.password, 200);
  const match = await passwordMatches(password);
  if (!match.ok) return res.status(401).json({ error: 'პაროლი არასწორია.' });
  if (match.source === 'plain') { try { await savePasswordHash(password); } catch (error) { console.warn('password upgrade', error.message); } }
  setSessionCookie(res, createSession());
  res.json({ ok: true });
}));
app.get('/api/admin/password', requireAdmin, asyncRoute(async (_req, res) => {
  const record = await loadPasswordRecord();
  res.json({ configured: passwordConfigured(record) });
}));
app.post('/api/admin/password', requireAdmin, asyncRoute(async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'ბაზასთან კავშირი ჯერ არ არის გამართული.' });
  const currentPassword = clean(req.body?.currentPassword, 200);
  const newPassword = String(req.body?.newPassword ?? '');
  const confirmPassword = String(req.body?.confirmPassword ?? '');
  if (newPassword.length < 8 || newPassword.length > 200) return res.status(400).json({ error: 'ახალი პაროლი უნდა იყოს 8-დან 200 სიმბოლომდე.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'ახალი პაროლი არ ემთხვევა გამეორებას.' });
  const record = await loadPasswordRecord();
  if (passwordConfigured(record)) {
    const match = await passwordMatches(currentPassword);
    if (!match.ok) return res.status(401).json({ error: 'მიმდინარე პაროლი არასწორია.' });
  }
  await savePasswordHash(newPassword);
  res.json({ ok: true });
}));
app.post('/api/admin/logout', requireAdmin, (_req, res) => { setSessionCookie(res, '', 0); res.json({ ok: true }); });
app.get('/api/admin/session', (req, res) => res.json({ authenticated: validSession(cookie(req, 'tiflis_admin')) }));
app.get('/api/admin/reservations', requireDb, requireAdmin, asyncRoute(async (req, res) => { const date = clean(req.query.date, 10); const filter = dateOk(date) ? `&reservation_date=eq.${encode(date)}` : ''; res.json(await supa('reservations', `?select=*,restaurant_tables(name,seats,zone)&order=reservation_date.asc,reservation_time.asc&limit=200${filter}`)); }));
app.patch('/api/admin/reservations/:id', requireDb, requireAdmin, asyncRoute(async (req, res) => { const status = clean(req.body?.status, 20); if (!['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'სტატუსი არასწორია.' }); const updated = await supa('reservations', `?id=eq.${encode(req.params.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); const data = updated[0]; await supa('reservation_events', '', { method: 'POST', body: JSON.stringify({ reservation_id: data.id, event_type: `status:${status}`, actor: 'admin' }) }); res.json(data); }));

// Compatibility bridge for the legacy full-featured UI. The browser talks only to
// this same-origin route; the Supabase service key remains server-side.
const legacyQuery = (req, key) => new URL(req.protocol + '://' + (req.headers.host || 'localhost') + req.originalUrl).searchParams.get(key) || '';
const legacyEq = (value, prefix) => String(value || '').replace(new RegExp(`^${prefix}=`), '').replace(/^eq\./, '');
const legacyAdminMutation = (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.method === 'POST' && req.params.table === 'reservations') return true;
  if (validSession(cookie(req, 'tiflis_admin'))) return true;
  res.status(401).json({ message: 'ადმინის ავტორიზაცია საჭიროა.' });
  return false;
};
function legacyCategory(row) { return { id: Number(row.legacy_id || 0), legacy_id: Number(row.legacy_id || 0), ka: row.ka || row.name, en: row.en || row.name, ru: row.ru || row.name, sort_order: row.sort_order }; }
function legacyMenuItem(row) { return { id: Number(row.legacy_id || 0), legacy_id: Number(row.legacy_id || 0), ka: row.ka || row.name, en: row.en || row.name, ru: row.ru || row.name, p: Number(row.p ?? row.price ?? 0), cat: Number(row.cat || 0), active: row.active !== false }; }
function legacyReservation(row, tableName = '') {
  return { ...row, name: row.guest_name, date: row.reservation_date, time: String(row.reservation_time || '').slice(0, 5), table_id: tableName || row.table_id || '', payment: row.payment || '', note: row.note || row.notes || '', precheck_json: row.precheck_json || null };
}
/** Guest fields from the check editor. Status-only patches must stay unchanged. */
export function legacyReservationPatch(body) {
  const b = body || {};
  const patch = {};
  for (const k of ['status', 'payment', 'precheck_json', 'advance_amount', 'advance_payment']) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  if (b.note !== undefined) patch.notes = b.note;
  if (b.name !== undefined || b.guest_name !== undefined) {
    const guestName = clean(b.name ?? b.guest_name, 100);
    if (guestName) patch.guest_name = guestName;
  }
  if (b.phone !== undefined) {
    const phone = clean(b.phone, 80);
    if (phone) patch.phone = phone;
  }
  if (b.date !== undefined || b.reservation_date !== undefined) {
    const reservationDate = clean(b.date ?? b.reservation_date, 10);
    if (dateOk(reservationDate)) patch.reservation_date = reservationDate;
  }
  if (b.time !== undefined || b.reservation_time !== undefined) {
    const hhmm = clean(b.time ?? b.reservation_time, 8).slice(0, 5);
    if (timeOk(hhmm)) patch.reservation_time = `${hhmm}:00`;
  }
  if (b.guests !== undefined && b.guests !== null && b.guests !== '') {
    const guests = Number(b.guests);
    if (Number.isInteger(guests) && guests >= 1 && guests <= 300) patch.guests = guests;
  }
  return patch;
}
const LEGACY_RES_SELECT = {
  id: 'id', name: 'guest_name', guest_name: 'guest_name', phone: 'phone', email: 'email',
  date: 'reservation_date', reservation_date: 'reservation_date', time: 'reservation_time',
  reservation_time: 'reservation_time', guests: 'guests', table_id: 'table_id', status: 'status',
  note: 'notes', notes: 'notes', payment: 'payment', precheck_json: 'precheck_json',
  confirmation_code: 'confirmation_code', created_at: 'created_at',
  advance_amount: 'advance_amount', advance_payment: 'advance_payment'
};
/** Filters reservations in Postgres. Same response shape as before; avoids downloading the latest 500 rows on every call. */
export function buildLegacyReservationListQuery(searchParams, tableUuid = '') {
  const filters = [];
  for (const raw of searchParams.getAll('date')) {
    const value = String(raw || '');
    let op = '';
    let day = '';
    if (value.startsWith('gte.')) { op = 'gte'; day = value.slice(4); }
    else if (value.startsWith('lte.')) { op = 'lte'; day = value.slice(4); }
    else if (value.startsWith('eq.')) { op = 'eq'; day = value.slice(3); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { op = 'eq'; day = value; }
    if (op && /^\d{4}-\d{2}-\d{2}$/.test(day)) filters.push(`reservation_date=${op}.${day}`);
  }
  const status = String(searchParams.get('status') || '');
  const statusValue = status.startsWith('neq.') ? status.slice(4) : status.startsWith('eq.') ? status.slice(3) : status;
  if (statusValue && /^[a-z_]+$/.test(statusValue)) filters.push(`status=${status.startsWith('neq.') ? 'neq' : 'eq'}.${statusValue}`);
  const precheck = String(searchParams.get('precheck_json') || '');
  if (precheck === 'not.is.null' || precheck === 'is.null') filters.push(`precheck_json=${precheck}`);
  if (tableUuid) filters.push(`table_id=eq.${tableUuid}`);
  const selectParam = String(searchParams.get('select') || '');
  let select = '*';
  if (selectParam && selectParam !== '*') {
    const cols = new Set(['id']);
    for (const part of selectParam.split(',')) {
      const col = LEGACY_RES_SELECT[part.trim()];
      if (col) cols.add(col);
    }
    select = [...cols].join(',');
  }
  const orderMap = { date: 'reservation_date', time: 'reservation_time' };
  const safeOrder = [];
  for (const token of String(searchParams.get('order') || '').split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const dot = trimmed.lastIndexOf('.');
    const rawCol = dot > 0 ? trimmed.slice(0, dot) : trimmed;
    const dir = dot > 0 ? trimmed.slice(dot + 1) : 'desc';
    const col = orderMap[rawCol] || rawCol;
    if (!['created_at', 'id', 'reservation_date', 'reservation_time'].includes(col)) continue;
    safeOrder.push(`${col}.${dir === 'asc' ? 'asc' : 'desc'}`);
  }
  const order = safeOrder.length ? safeOrder.join(',') : 'created_at.desc,reservation_date.desc,reservation_time.desc';
  return {
    query: `?select=${select}&order=${order}&limit=500${filters.length ? '&' + filters.join('&') : ''}`,
    needsNames: select === '*' || select.includes('table_id')
  };
}
const FLOOR_TABLE_SEATS = {
  'H-11': 6, 'H-12': 6, 'H-13': 3, 'H-14': 4, 'H-15': 2, 'H-16': 4, 'H-17': 2, 'H-18': 6, 'H-19': 4,
  'A-20': 2, 'A-21': 4, 'A-22': 4, 'A-23': 4, 'A-24': 4, 'A-25': 4, 'A-26': 4, 'A-27': 6, 'A-28': 4, 'A-29': 6,
  'V-1': 3, 'V-2': 4, 'V-3': 2, 'V-4': 4, 'V-5': 4, 'V-6': 4, 'V-7': 4, 'V-8': 4
};
function floorTableMeta(name) {
  const id = String(name || '').trim().toUpperCase();
  if (FLOOR_TABLE_SEATS[id] != null) {
    const zone = id.startsWith('H-') ? 'hall' : id.startsWith('A-') ? 'mezzanine' : 'veranda';
    return { name: id, seats: FLOOR_TABLE_SEATS[id], zone };
  }
  if (/^B-\d+$/.test(id)) return { name: id, seats: 8, zone: 'banquet' };
  if (/^T\d+$/.test(id)) return { name: id, seats: 4, zone: 'main' };
  if (/^H-\d+$/.test(id)) return { name: id, seats: 4, zone: 'hall' };
  if (/^A-\d+$/.test(id)) return { name: id, seats: 4, zone: 'mezzanine' };
  if (/^V-\d+$/.test(id)) return { name: id, seats: 4, zone: 'veranda' };
  return null;
}
async function resolveRestaurantTable(tableName) {
  const name = clean(tableName, 50);
  if (!name || name === '—' || name === '-') return null;
  const found = (await supa('restaurant_tables', `?name=eq.${encode(name)}&select=id,name,seats`))[0];
  if (found) return found;
  const meta = floorTableMeta(name);
  if (!meta) {
    const err = new Error('მაგიდა ვერ მოიძებნა');
    err.status = 400;
    throw err;
  }
  const inserted = await supa('restaurant_tables', '', { method: 'POST', body: JSON.stringify({ ...meta, is_active: true }) });
  return inserted[0];
}

app.all('/api/legacy/rest/v1/:table', requireDb, asyncRoute(async (req, res) => {
  const table = req.params.table;
  if (!legacyAdminMutation(req, res)) return;
  if (table === 'menu_categories') {
    if (req.method === 'GET') {
      let rows = await supa('menu_categories', '?select=id,legacy_id,name,ka,en,ru,sort_order,is_active&order=sort_order.asc,legacy_id.asc');
      rows = rows.filter((r) => r.is_active !== false);
      const idFilter = legacyQuery(req, 'id'); if (idFilter) rows = rows.filter((r) => String(r.legacy_id) === legacyEq(idFilter, 'id'));
      return res.json(rows.map(legacyCategory));
    }
    const body = Array.isArray(req.body) ? req.body[0] : (req.body || {});
    const id = Number(body.id || body.legacy_id || 0); const patch = { name: clean(body.ka || body.name, 160), ka: clean(body.ka || body.name, 160), en: clean(body.en || body.ka || body.name, 160), ru: clean(body.ru || body.ka || body.name, 160), sort_order: Number(body.sort_order || id || 0), is_active: body.active !== false };
    let rows = id ? await supa('menu_categories', `?legacy_id=eq.${id}&select=id`) : [];
    if (req.method === 'DELETE') { if (rows[0]) await supa('menu_categories', `?id=eq.${encode(rows[0].id)}`, { method: 'DELETE' }); return res.json([]); }
    if (rows[0]) { const updated = await supa('menu_categories', `?id=eq.${encode(rows[0].id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); return res.json(updated.map(legacyCategory)); }
    const inserted = await supa('menu_categories', '', { method: 'POST', body: JSON.stringify({ ...patch, legacy_id: id || Date.now() }) }); return res.json(inserted.map(legacyCategory));
  }
  if (table === 'menu_items') {
    if (req.method === 'GET') {
      let rows = await supa('menu_items', '?select=id,legacy_id,name,ka,en,ru,p,price,cat,active,is_available&order=sort_order.asc,legacy_id.asc');
      const idFilter = legacyQuery(req, 'id'); if (idFilter) rows = rows.filter((r) => String(r.legacy_id) === legacyEq(idFilter, 'id'));
      return res.json(rows.map(legacyMenuItem));
    }
    const body = Array.isArray(req.body) ? req.body[0] : (req.body || {}); const id = Number(body.id || body.legacy_id || 0); const patch = { name: clean(body.ka || body.name, 160), ka: clean(body.ka || body.name, 160), en: clean(body.en || body.ka || body.name, 160), ru: clean(body.ru || body.ka || body.name, 160), p: Number(body.p || body.price || 0), price: Number(body.p || body.price || 0), cat: Number(body.cat || 0), active: body.active !== false, is_available: body.active !== false };
    let rows = id ? await supa('menu_items', `?legacy_id=eq.${id}&select=id`) : [];
    if (req.method === 'DELETE') { if (rows[0]) await supa('menu_items', `?id=eq.${encode(rows[0].id)}`, { method: 'PATCH', body: JSON.stringify({ active: false, is_available: false }) }); return res.json([]); }
    if (rows[0]) { const updated = await supa('menu_items', `?id=eq.${encode(rows[0].id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); return res.json(updated.map(legacyMenuItem)); }
    const category = (await supa('menu_categories', `?legacy_id=eq.${Number(patch.cat)}&select=id`))[0]; const inserted = await supa('menu_items', '', { method: 'POST', body: JSON.stringify({ ...patch, legacy_id: id || Date.now(), category_id: category?.id || null }) }); return res.json(inserted.map(legacyMenuItem));
  }
  if (table === 'settings') {
    const keyParam = legacyQuery(req, 'key'); const key = keyParam.replace(/^eq\./, '').replace(/^in\.\((.*)\)$/, '$1').split(',')[0];
    const hidden = (name) => SECRET_SETTING_KEYS.has(String(name || '').trim());
    if (req.method === 'GET') {
      const rows = await supa('settings', keyParam.includes('in.') ? `?key=in.(${keyParam.match(/in\.\((.*)\)/)?.[1] || ''})&select=key,value` : `?key=eq.${encode(key)}&select=key,value`);
      return res.json((rows || []).filter((row) => !hidden(row.key)));
    }
    const body = Array.isArray(req.body) ? req.body[0] : (req.body || {}); const target = key || body.key;
    if (hidden(target)) return res.status(403).json({ message: 'პაროლი აქედან არ იცვლება.' });
    const existing = await supa('settings', `?key=eq.${encode(target)}&select=key`); if (existing.length) { const updated = await supa('settings', `?key=eq.${encode(target)}`, { method: 'PATCH', body: JSON.stringify({ value: String(body.value ?? '') }) }); return res.json(updated); } const inserted = await supa('settings', '', { method: 'POST', body: JSON.stringify({ key: target, value: String(body.value ?? '') }) }); return res.json(inserted);
  }
  if (table === 'tables') {
    const date = todayInTimezone();
    if (req.method === 'GET') {
      const tables = await supa('restaurant_tables', '?is_active=eq.true&select=id,name,seats,zone&order=name');
      const ops = await supa('table_operations', `?business_date=eq.${date}&select=table_id,status,guest_name,guests,reservation_id`);
      const opMap = new Map(ops.map((row) => [String(row.table_id), row]));
      return res.json(tables.map((row) => { const op = opMap.get(row.name) || {}; return { id: row.name, name: row.name, seats: row.seats, zone: row.zone, status: op.status || 'free', guest_name: op.guest_name || null, guests: op.guests || null, reservation_id: op.reservation_id || null }; }));
    }
    if (Array.isArray(req.body)) {
      const rows = req.body.map((body) => {
        const id = clean(body.id || body.table_id, 50);
        if (!id) return null;
        return { table_id: id, business_date: date, status: clean(body.status || 'free', 30), guest_name: body.guest_name || body.name || null, guests: body.guests == null ? null : Number(body.guests), source: 'admin', reservation_id: body.reservation_id || null, updated_by: 'legacy-bridge' };
      }).filter(Boolean);
      if (!rows.length) return res.json([]);
      const saved = await supa('table_operations', '?on_conflict=table_id,business_date', { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      return res.json(saved || []);
    }
    const id = legacyQuery(req, 'id').replace(/^eq\./, ''); const body = req.body || {}; if (!id) return res.json([]); const row = { table_id: id, business_date: date, status: clean(body.status || 'free', 30), guest_name: body.guest_name || body.name || null, guests: body.guests == null ? null : Number(body.guests), source: 'admin', reservation_id: body.reservation_id || null, updated_by: 'legacy-bridge' }; const saved = await supa('table_operations', `?on_conflict=table_id,business_date`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }); return res.json(saved);
  }
  if (table === 'reservations') {
    if (req.method === 'GET') {
      const idFilter = legacyQuery(req, 'id').replace(/^eq\./, '');
      if (idFilter) {
        const one = await supa('reservations', `?id=eq.${encode(idFilter)}&select=*`);
        const tables = await supa('restaurant_tables', '?select=id,name');
        const names = new Map(tables.map((t) => [t.id, t.name]));
        return res.json(one.map((r) => legacyReservation(r, names.get(r.table_id) || '')));
      }
      const url = new URL(req.protocol + '://' + (req.headers.host || 'localhost') + req.originalUrl);
      const tableFilter = (url.searchParams.get('table_id') || '').replace(/^eq\./, '');
      let tableUuid = '';
      if (tableFilter) {
        const byName = (await supa('restaurant_tables', `?name=eq.${encode(tableFilter)}&select=id`))[0];
        const byId = byName || (/^[0-9a-f-]{36}$/i.test(tableFilter) ? (await supa('restaurant_tables', `?id=eq.${encode(tableFilter)}&select=id`))[0] : null);
        if (!byId) return res.json([]);
        tableUuid = byId.id;
      }
      const built = buildLegacyReservationListQuery(url.searchParams, tableUuid);
      const rows = await supa('reservations', built.query);
      const tables = built.needsNames ? await supa('restaurant_tables', '?select=id,name') : [];
      const names = new Map((tables || []).map((t) => [t.id, t.name]));
      return res.json((rows || []).map((r) => legacyReservation(r, names.get(r.table_id) || '')));
    }
    if (req.method === 'POST') {
      const b = Array.isArray(req.body) ? req.body[0] : (req.body || {});
      const tableName = clean(b.table_id, 50);
      let tableRow = null;
      try {
        tableRow = await resolveRestaurantTable(tableName);
      } catch (err) {
        return res.status(err.status || 400).json({ message: err.message || 'მაგიდა ვერ მოიძებნა' });
      }
      if (!tableRow && tableName && tableName !== '—' && tableName !== '-') {
        return res.status(400).json({ message: 'მაგიდა ვერ მოიძებნა' });
      }
      const displayName = tableRow?.name || tableName || '—';
      const reservationDate = clean(b.date || b.reservation_date, 10);
      const reservationTime = clean(b.time || b.reservation_time, 5);
      if (tableRow && reservationDate && reservationTime) {
        const existing = await supa('reservations', `?reservation_date=eq.${encode(reservationDate)}&table_id=eq.${encode(tableRow.id)}&status=not.in.(cancelled,no_show)&select=id,guest_name,reservation_time,status`);
        const hold = 120;
        const toMin = (value) => {
          const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
          return match ? Number(match[1]) * 60 + Number(match[2]) : null;
        };
        const start = toMin(reservationTime);
        const clash = (existing || []).find((row) => {
          const other = toMin(row.reservation_time);
          return start != null && other != null && start < other + hold && other < start + hold;
        });
        if (clash) {
          return res.status(409).json({
            message: `მაგიდა ${displayName} უკვე დაკავებულია ${String(clash.reservation_time || '').slice(0, 5)}-ზე (${clash.guest_name || 'ჯავშანი'}). სხვა საათი ან მაგიდა აირჩიეთ.`
          });
        }
        const linkGroups = await supa('table_groups', '?status=eq.merged&select=group_code,table_ids');
        const linkedIds = (linkGroups || [])
          .filter((group) => String(group.group_code || '').startsWith('L-') && (group.table_ids || []).map(String).includes(displayName))
          .map((group) => String(group.group_code).slice(2))
          .filter(Boolean);
        if (linkedIds.length) {
          const linkedRows = await supa('reservations', `?id=in.(${linkedIds.map(encode).join(',')})&reservation_date=eq.${encode(reservationDate)}&status=not.in.(cancelled,no_show)&select=id,guest_name,reservation_time,status`);
          const linkedClash = (linkedRows || []).find((row) => {
            const other = toMin(row.reservation_time);
            return start != null && other != null && start < other + hold && other < start + hold;
          });
          if (linkedClash) {
            return res.status(409).json({
              message: `მაგიდა ${displayName} მიერთებულია ${String(linkedClash.reservation_time || '').slice(0, 5)}-ის ჯავშანზე (${linkedClash.guest_name || 'სტუმარი'}). სხვა მაგიდა აირჩიეთ.`
            });
          }
        }
      }
      const advanceAmount = b.advance_amount == null || b.advance_amount === '' ? null : Number(b.advance_amount);
      const guestsCount = Number(b.guests || 2);
      if (!Number.isInteger(guestsCount) || guestsCount < 1 || guestsCount > 300) {
        return res.status(400).json({ message: 'სტუმრების რაოდენობა უნდა იყოს 1-დან 300-მდე.' });
      }
      if (!clean(b.name || b.guest_name, 100) || !clean(b.phone, 40)) {
        return res.status(400).json({ message: 'გთხოვთ შეიყვანოთ სახელი და ტელეფონი.' });
      }
      if (!dateOk(reservationDate) || !timeOk(reservationTime)) {
        return res.status(400).json({ message: 'გთხოვთ სწორად აირჩიოთ თარიღი და დრო.' });
      }
      const row = {
        confirmation_code: `TF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        guest_name: clean(b.name || b.guest_name, 100),
        phone: clean(b.phone, 40),
        email: b.email || null,
        reservation_date: reservationDate,
        reservation_time: reservationTime ? `${reservationTime}:00` : null,
        guests: guestsCount,
        table_id: tableRow?.id || null,
        status: b.status || 'pending',
        notes: clean(b.note || b.notes, 500),
        payment: clean(b.payment, 60),
        precheck_json: b.precheck_json || null
      };
      if (Number.isFinite(advanceAmount)) row.advance_amount = advanceAmount;
      if (b.advance_payment) row.advance_payment = clean(b.advance_payment, 60);
      try {
        let inserted;
        try {
          inserted = await supa('reservations', '', { method: 'POST', body: JSON.stringify(row) });
        } catch (e1) {
          // Older schemas may lack advance_* / payment / precheck_json — retry core fields only.
          const msg = String(e1.message || '');
          const unknownCol = e1.code === 'PGRST204' || /Could not find the .+ column/i.test(msg) || /schema cache/i.test(msg);
          if (!unknownCol) throw e1;
          const core = {
            confirmation_code: row.confirmation_code,
            guest_name: row.guest_name,
            phone: row.phone,
            email: row.email,
            reservation_date: row.reservation_date,
            reservation_time: row.reservation_time,
            guests: row.guests,
            table_id: row.table_id,
            status: row.status,
            notes: row.notes
          };
          inserted = await supa('reservations', '', { method: 'POST', body: JSON.stringify(core) });
        }
        const saved = inserted[0];
        // Guest bookings cannot PATCH /tables (admin-only). Mark floor state here with the service key.
        if (displayName && displayName !== '—' && displayName !== '-') {
          try {
            await supa('table_operations', '?on_conflict=table_id,business_date', {
              method: 'POST',
              body: JSON.stringify({
                table_id: displayName,
                business_date: reservationDate || todayInTimezone(),
                status: 'reserved',
                guest_name: row.guest_name || null,
                guests: row.guests || null,
                source: 'reservation',
                reservation_id: saved?.id || null,
                updated_by: 'legacy-bridge'
              }),
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
            });
          } catch (opsErr) {
            console.warn('reservation table_operations reserved', opsErr?.message || opsErr);
          }
        }
        return res.status(201).json(legacyReservation(saved, displayName));
      } catch (err) {
        if (err.code === '23505' || err.status === 409) {
          return res.status(409).json({ message: 'ეს მაგიდა ამ დროს უკვე დაჯავშნილია. გთხოვთ სხვა დრო აირჩიოთ.' });
        }
        if (err.code === '23514' || /guests_check/i.test(String(err.message || ''))) {
          return res.status(400).json({ message: 'სტუმრების რაოდენობა ბაზაში შეზღუდულია. განაახლეთ guests ლიმიტი ან შეამცირეთ რაოდენობა.' });
        }
        throw err;
      }
    }
    const idFilter = legacyQuery(req, 'id').replace(/^eq\./, '');
    const dateFilter = legacyQuery(req, 'date').replace(/^eq\./, '');
    const tableFilter = legacyQuery(req, 'table_id').replace(/^eq\./, '');
    const statusFilter = legacyQuery(req, 'status');
    let targets = [];
    if (idFilter) {
      targets = await supa('reservations', `?id=eq.${encode(idFilter)}&select=*`);
    } else if (dateFilter || tableFilter) {
      let query = '?select=*&limit=100';
      if (dateFilter) query += `&reservation_date=eq.${encode(dateFilter)}`;
      if (tableFilter) {
        const tableRow = await resolveRestaurantTable(tableFilter).catch(() => null);
        if (!tableRow) return res.json([]);
        query += `&table_id=eq.${encode(tableRow.id)}`;
      }
      targets = await supa('reservations', query);
      if (statusFilter) {
        targets = targets.filter((r) => statusFilter.startsWith('neq.') ? r.status !== statusFilter.slice(4) : r.status === statusFilter.slice(3));
      }
    }
    if (!targets.length) return res.json([]);
    const b = req.body || {};
    const patch = legacyReservationPatch(b);
    let displayTableName = '';
    if (b.table_id !== undefined) {
      try {
        const tableRow = await resolveRestaurantTable(b.table_id);
        patch.table_id = tableRow?.id || null;
        displayTableName = tableRow?.name || '';
      } catch (err) {
        return res.status(err.status || 400).json({ message: err.message || 'მაგიდა ვერ მოიძებნა' });
      }
    }
    const updated = [];
    for (const existing of targets) {
      const rows = await supa('reservations', `?id=eq.${encode(existing.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      updated.push(...rows);
    }
    if (!displayTableName && updated[0]?.table_id) {
      const names = await supa('restaurant_tables', `?id=eq.${encode(updated[0].table_id)}&select=name`);
      displayTableName = names[0]?.name || '';
    }
    return res.json(updated.map((r) => legacyReservation(r, displayTableName)));
  }
  if (['table_groups', 'table_operations', 'saved_checks'].includes(table)) {
    if (table === 'saved_checks') {
      const rawQuery = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const query = rawQuery.replace(/saved_at/g, 'created_at').replace(/edited_at/g, 'updated_at');
      if (req.method === 'GET') {
        const rows = await supa(table, query, { method: 'GET' });
        return res.json(rows.map((row) => ({ id: row.id, name: row.name || '', phone: row.phone || '', email: row.email || '', res_date: row.date || null, time_slot: row.time || '', guests: row.guests, payment: row.payment || '', table_id: row.table_id || '', note: row.note || '', disc: row.disc || 0, svc: row.svc || 0, adv: row.adv || 0, items: row.items || [], subtotal: row.subtotal || 0, total: row.total || 0, saved_at: row.created_at || null, edited_at: row.updated_at || null })));
      }
      if (req.method === 'POST') {
        const b = Array.isArray(req.body) ? req.body[0] : (req.body || {});
        const row = { id: String(b.id ?? crypto.randomUUID()), name: clean(b.name, 160), phone: clean(b.phone, 50), date: b.res_date || null, time: b.time_slot || null, guests: b.guests == null ? null : Number(b.guests), table_id: clean(b.table_id, 50), note: clean(b.note, 500), disc: Number(b.disc || 0), svc: Number(b.svc || 0), adv: Number(b.adv || 0), items: Array.isArray(b.items) ? b.items : [], subtotal: Number(b.subtotal || 0), total: Number(b.total || 0), updated_at: b.edited_at || new Date().toISOString() };
        const saved = await supa(table, '?on_conflict=id', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
        return res.json(saved.map((r) => ({ ...r, res_date: r.date, time_slot: r.time, saved_at: r.created_at, edited_at: r.updated_at })));
      }
      const result = await supa(table, query, { method: req.method, body: ['GET','HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body) }); return res.json(result);
    }
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const options = {
      method: req.method,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      headers: {},
    };
    // Upsert must send Prefer: resolution=merge-duplicates. Without it, seating fails when
    // the (table_id, business_date) row already exists (free/reserved), so only localStorage updates.
    if (req.method === 'POST' && (table === 'table_operations' || table === 'table_groups')) {
      const prefer = String(req.get('prefer') || '');
      options.headers.Prefer = prefer.includes('resolution=')
        ? prefer
        : 'resolution=merge-duplicates,return=minimal';
    } else if (req.get('prefer')) {
      options.headers.Prefer = req.get('prefer');
    }
    return res.json(await supa(table, query, options));
  }
  return res.status(404).json({ message: `Legacy table not supported: ${table}` });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status && error.status < 500 ? error.status : 500;
  const text = status < 500 ? (error.message || 'მოთხოვნა ვერ შესრულდა') : 'სერვერის შეცდომა. სცადეთ მოგვიანებით.';
  res.status(status).json({ message: text, error: text });
});
export default app;
if (process.env.VERCEL !== '1') app.listen(port, () => console.log(`Modern reservation running at http://localhost:${port}`));
