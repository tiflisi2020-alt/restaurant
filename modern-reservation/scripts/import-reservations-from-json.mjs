/**
 * Import reservations JSON into destination Supabase.
 * Usage: node scripts/import-reservations-from-json.mjs [path-to-json]
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env
 *
 * Accepts:
 *   { reservations: [...] }
 *   [ { reservations_export_json: { reservations: [...] } } ]
 *   a raw array of reservation rows
 *
 * Re-running updates the same rows (confirmation_code SRC-<source id>).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');

function loadEnv() {
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnv();

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const jsonPath = path.resolve(
  process.argv[2] || path.join(root, 'supabase', 'imported-reservations.json')
);

const FLOOR_TABLE_SEATS = {
  'H-11': 6, 'H-12': 6, 'H-13': 3, 'H-14': 4, 'H-15': 2, 'H-16': 4, 'H-17': 2, 'H-18': 6, 'H-19': 4,
  'A-20': 2, 'A-21': 4, 'A-22': 4, 'A-23': 4, 'A-24': 4, 'A-25': 4, 'A-26': 4, 'A-27': 6, 'A-28': 4, 'A-29': 6,
  'V-1': 3, 'V-2': 4, 'V-3': 2, 'V-4': 4, 'V-5': 4, 'V-6': 4, 'V-7': 4, 'V-8': 4,
};
const STATUSES = new Set(['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (id && id !== '—' && id !== '-' && id.toLowerCase() !== 'null') {
    return { name: id.slice(0, 50), seats: 4, zone: 'imported' };
  }
  return null;
}

function unwrap(payload) {
  let data = payload;
  if (Array.isArray(data) && data.length === 1 && data[0] && data[0].reservations_export_json != null) {
    data = data[0].reservations_export_json;
  }
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.reservations_export_json === 'string') {
    data = JSON.parse(data.reservations_export_json);
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.reservations_export_json && typeof data.reservations_export_json === 'object') {
    data = data.reservations_export_json;
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.reservations)) return data.reservations;
  throw new Error('JSON-ში reservations მასივი ვერ ვიპოვე');
}

function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  return null;
}

function normDate(value) {
  const m = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normTime(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

function normStatus(value) {
  const s = String(value || 'pending').trim().toLowerCase();
  if (s === 'canceled') return 'cancelled';
  return STATUSES.has(s) ? s : 'pending';
}

function normGuests(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, 30);
}

function normPrecheck(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  if (typeof value === 'object') return value;
  return null;
}

function confirmationCode(row) {
  const id = pick(row, ['id', 'legacy_id']);
  if (id != null) {
    const safe = String(id).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (safe) return `SRC-${safe}`;
  }
  const existing = pick(row, ['confirmation_code']);
  if (existing && String(existing).startsWith('SRC-')) return String(existing).slice(0, 64);
  const basis = [pick(row, ['date', 'reservation_date']), pick(row, ['time', 'reservation_time']), pick(row, ['phone']), pick(row, ['name', 'guest_name'])].join('|');
  return `SRC-${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16)}`;
}

function tableLabel(row) {
  const named = pick(row, ['table_name', 'table']);
  if (named && !UUID_RE.test(String(named))) return String(named).trim();
  const raw = pick(row, ['table_id']);
  if (raw == null) return '';
  const text = String(raw).trim();
  if (!text || UUID_RE.test(text)) return named ? String(named).trim() : '';
  return text;
}

async function rest(pathname, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
    const err = new Error(`${method} ${pathname} → ${r.status}: ${msg.slice(0, 400)}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function loadTables() {
  const rows = await rest('restaurant_tables?select=id,name');
  const byName = new Map();
  for (const row of rows || []) byName.set(String(row.name).trim().toUpperCase(), row.id);
  return byName;
}

async function resolveTableId(label, byName) {
  const meta = floorTableMeta(label);
  if (!meta) return null;
  const known = byName.get(meta.name);
  if (known) return known;
  const inserted = await rest('restaurant_tables', {
    method: 'POST',
    body: { name: meta.name, seats: meta.seats, zone: meta.zone, is_active: true },
    prefer: 'return=representation',
  });
  const id = inserted?.[0]?.id;
  if (id) byName.set(meta.name, id);
  return id || null;
}

function toRow(src) {
  const date = normDate(pick(src, ['date', 'reservation_date', 'res_date']));
  const time = normTime(pick(src, ['time', 'reservation_time', 'time_slot']));
  const note = String(pick(src, ['note', 'notes']) || '');
  const advance = pick(src, ['advance_amount', 'adv']);
  const advanceNum = advance == null || advance === '' ? null : Number(advance);
  const created = pick(src, ['created_at', 'inserted_at']);
  const row = {
    confirmation_code: confirmationCode(src),
    guest_name: String(pick(src, ['name', 'guest_name']) || 'სტუმარი').slice(0, 100),
    phone: String(pick(src, ['phone']) || '—').slice(0, 40),
    email: pick(src, ['email']) ? String(pick(src, ['email'])).slice(0, 160) : null,
    reservation_date: date,
    reservation_time: time,
    guests: normGuests(pick(src, ['guests'])),
    status: normStatus(pick(src, ['status'])),
    notes: note.slice(0, 500),
    note: note.slice(0, 500),
    payment: pick(src, ['payment']) ? String(pick(src, ['payment'])).slice(0, 60) : null,
    advance_payment: pick(src, ['advance_payment']) ? String(pick(src, ['advance_payment'])).slice(0, 60) : null,
    advance_amount: Number.isFinite(advanceNum) ? advanceNum : null,
    precheck_json: normPrecheck(src.precheck_json),
    source: 'admin',
  };
  if (created && !Number.isNaN(Date.parse(created))) row.created_at = new Date(created).toISOString();
  return row;
}

async function upsertReservation(row) {
  return rest('reservations?on_conflict=confirmation_code', {
    method: 'POST',
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const reservations = unwrap(payload);
  console.log('Destination:', supabaseUrl);
  console.log(`Importing ${reservations.length} reservations from ${jsonPath}`);

  const byName = await loadTables();
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const src of reservations) {
    const row = toRow(src);
    if (!row.reservation_date || !row.reservation_time) {
      skipped += 1;
      console.error('SKIP (no date/time)', row.confirmation_code, row.guest_name);
      continue;
    }
    try {
      row.table_id = await resolveTableId(tableLabel(src), byName);
      await upsertReservation(row);
      ok += 1;
      if (ok % 25 === 0) console.log(`… ${ok}/${reservations.length}`);
    } catch (e) {
      fail += 1;
      console.error('FAIL', row.confirmation_code, row.guest_name, row.reservation_date, row.reservation_time, e.message);
    }
  }

  console.log('\nDone.');
  console.log(`Reservations: ${ok} ok, ${fail} fail, ${skipped} skipped`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
