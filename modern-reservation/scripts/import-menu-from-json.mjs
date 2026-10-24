/**
 * Import menu JSON (categories + items) into destination Supabase.
 * Usage: node scripts/import-menu-from-json.mjs [path-to-json]
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env
 */
import fs from 'fs';
import path from 'path';
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
  process.argv[2] || path.join(root, 'supabase', 'imported-menu.json')
);
const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const categories = Array.isArray(payload.categories) ? payload.categories : [];
const menu = Array.isArray(payload.menu) ? payload.menu : [];

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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
    throw new Error(`${method} ${pathname} → ${r.status}: ${msg.slice(0, 400)}`);
  }
  return data;
}

async function detectSchema() {
  const cats = await rest('menu_categories?select=*&limit=1');
  const items = await rest('menu_items?select=*&limit=1');
  const catSample = Array.isArray(cats) && cats[0] ? cats[0] : {};
  const itemSample = Array.isArray(items) && items[0] ? items[0] : {};
  return {
    catsHaveLegacy: 'legacy_id' in catSample || Object.keys(catSample).length === 0,
    itemsHaveLegacy: 'legacy_id' in itemSample || Object.keys(itemSample).length === 0,
    catKeys: Object.keys(catSample),
    itemKeys: Object.keys(itemSample),
    catCountHint: await rest('menu_categories?select=id', { prefer: 'count=exact' }).catch(() => null),
  };
}

async function upsertCategory(c) {
  const legacyId = Number(c.id);
  const name = String(c.ka || c.en || c.ru || `cat-${legacyId}`).trim() || `cat-${legacyId}`;
  const row = {
    legacy_id: legacyId,
    name,
    ka: String(c.ka || name),
    en: String(c.en || name),
    ru: String(c.ru || name),
    sort_order: Number(c.sort_order != null ? c.sort_order : legacyId),
    is_active: true,
  };

  const existing = await rest(`menu_categories?legacy_id=eq.${legacyId}&select=id`);
  if (Array.isArray(existing) && existing[0]) {
    await rest(`menu_categories?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body: row,
      prefer: 'return=minimal',
    });
    return { action: 'update', legacyId, uuid: existing[0].id };
  }

  // Fallback: integer-id schema (no UUID/legacy_id)
  try {
    const byId = await rest(`menu_categories?id=eq.${legacyId}&select=id`);
    if (Array.isArray(byId) && byId[0]) {
      const patch = {
        ka: row.ka,
        en: row.en,
        ru: row.ru,
        sort_order: row.sort_order,
      };
      if ('name' in (byId[0] || {}) || true) patch.name = name;
      await rest(`menu_categories?id=eq.${legacyId}`, {
        method: 'PATCH',
        body: patch,
        prefer: 'return=minimal',
      });
      return { action: 'update-int', legacyId };
    }
  } catch (_) {
    /* ignore — UUID schema */
  }

  const inserted = await rest('menu_categories', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  const uuid = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
  return { action: 'insert', legacyId, uuid };
}

async function upsertItem(item, catUuidByLegacy) {
  const legacyId = Number(item.id);
  const catLegacy = Number(item.cat || 0);
  const name = String(item.ka || item.en || item.ru || `item-${legacyId}`).trim() || `item-${legacyId}`;
  const price = Number(item.p || 0);
  const active = item.active !== false;

  const row = {
    legacy_id: legacyId,
    name,
    description: '',
    ka: String(item.ka || name),
    en: String(item.en || name),
    ru: String(item.ru || name),
    p: price,
    price,
    cat: catLegacy,
    category_id: catUuidByLegacy.get(catLegacy) || null,
    active,
    is_available: active,
    sort_order: legacyId,
  };

  const existing = await rest(`menu_items?legacy_id=eq.${legacyId}&select=id`);
  if (Array.isArray(existing) && existing[0]) {
    await rest(`menu_items?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body: row,
      prefer: 'return=minimal',
    });
    return { action: 'update', legacyId };
  }

  try {
    const byId = await rest(`menu_items?id=eq.${legacyId}&select=id`);
    if (Array.isArray(byId) && byId[0]) {
      await rest(`menu_items?id=eq.${legacyId}`, {
        method: 'PATCH',
        body: {
          ka: row.ka,
          en: row.en,
          ru: row.ru,
          p: price,
          cat: catLegacy,
          active,
        },
        prefer: 'return=minimal',
      });
      return { action: 'update-int', legacyId };
    }
  } catch (_) {
    /* ignore */
  }

  // Integer primary key insert (legacy tables)
  try {
    await rest('menu_items', {
      method: 'POST',
      body: {
        id: legacyId,
        ka: row.ka,
        en: row.en,
        ru: row.ru,
        p: price,
        cat: catLegacy,
        active,
      },
      prefer: 'return=minimal',
    });
    return { action: 'insert-int', legacyId };
  } catch (e1) {
    const inserted = await rest('menu_items', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).catch((e2) => {
      throw new Error(`item ${legacyId}: ${e1.message}; then ${e2.message}`);
    });
    return { action: 'insert', legacyId, uuid: inserted?.[0]?.id };
  }
}

async function main() {
  console.log('Destination:', supabaseUrl);
  console.log(`Importing ${categories.length} categories, ${menu.length} items from ${jsonPath}`);

  try {
    const schema = await detectSchema();
    console.log('Sample cat keys:', schema.catKeys.join(', ') || '(empty)');
    console.log('Sample item keys:', schema.itemKeys.join(', ') || '(empty)');
  } catch (e) {
    console.warn('Schema probe:', e.message);
  }

  const catUuidByLegacy = new Map();
  let catOk = 0;
  let catFail = 0;
  for (const c of categories) {
    try {
      const res = await upsertCategory(c);
      if (res.uuid) catUuidByLegacy.set(res.legacyId, res.uuid);
      else {
        const look = await rest(`menu_categories?legacy_id=eq.${res.legacyId}&select=id`).catch(() => []);
        if (look?.[0]?.id) catUuidByLegacy.set(res.legacyId, look[0].id);
      }
      catOk += 1;
      process.stdout.write(`C ${res.action} ${res.legacyId}\n`);
    } catch (e) {
      catFail += 1;
      console.error('CAT FAIL', c.id, e.message);
    }
  }

  // Refresh UUID map for all categories
  try {
    const allCats = await rest('menu_categories?select=id,legacy_id');
    for (const row of allCats || []) {
      if (row.legacy_id != null) catUuidByLegacy.set(Number(row.legacy_id), row.id);
    }
  } catch (_) {
    /* integer schema */
  }

  let itemOk = 0;
  let itemFail = 0;
  for (const item of menu) {
    try {
      const res = await upsertItem(item, catUuidByLegacy);
      itemOk += 1;
      if (itemOk % 25 === 0) console.log(`… ${itemOk}/${menu.length} items`);
      else process.stdout.write(`I ${res.action} ${res.legacyId}\n`);
    } catch (e) {
      itemFail += 1;
      console.error('ITEM FAIL', item.id, e.message);
    }
  }

  console.log('\nDone.');
  console.log(`Categories: ${catOk} ok, ${catFail} fail`);
  console.log(`Items: ${itemOk} ok, ${itemFail} fail`);
  if (catFail || itemFail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
