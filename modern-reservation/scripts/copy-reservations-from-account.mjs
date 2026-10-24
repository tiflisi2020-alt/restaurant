/**
 * Copy reservations from the other Supabase account into this project.
 * Source anon key is the one already embedded in public/index.html (project xcxzkelvpmynreewflrj).
 * Destination is SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
 *
 * Usage: node scripts/copy-reservations-from-account.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sourceUrl = 'https://xcxzkelvpmynreewflrj.supabase.co';
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const keyMatch = html.match(/const SUPA_KEY = '([^']+)'/);
if (!keyMatch) {
  console.error('SUPA_KEY not found in public/index.html');
  process.exit(1);
}
const sourceKey = keyMatch[1];
const outFile = path.join(root, 'supabase', 'imported-reservations.json');

async function fetchPage(from, to) {
  const r = await fetch(`${sourceUrl}/rest/v1/reservations?select=*&order=id.asc`, {
    headers: {
      apikey: sourceKey,
      Authorization: `Bearer ${sourceKey}`,
      Range: `${from}-${to}`,
      Prefer: 'count=exact',
    },
  });
  const text = await r.text();
  let rows = null;
  try { rows = text ? JSON.parse(text) : []; } catch { rows = null; }
  if (!r.ok && r.status !== 206) {
    const msg = typeof rows === 'object' ? JSON.stringify(rows) : String(text);
    throw new Error(`source ${r.status}: ${msg.slice(0, 300)}`);
  }
  if (!Array.isArray(rows)) throw new Error('source did not return an array');
  const range = r.headers.get('content-range') || '';
  const total = Number((range.match(/\/(\d+)$/) || [])[1]);
  return { rows, total: Number.isFinite(total) ? total : null };
}

const all = [];
const pageSize = 200;
let from = 0;
let total = null;
while (true) {
  const page = await fetchPage(from, from + pageSize - 1);
  if (total == null) total = page.total;
  all.push(...page.rows);
  console.log(`fetched ${all.length}${total != null ? ` / ${total}` : ''}`);
  if (!page.rows.length || (total != null && all.length >= total) || page.rows.length < pageSize) break;
  from += pageSize;
}

const payload = {
  exported_at: new Date().toISOString(),
  source: sourceUrl,
  reservations: all,
};
fs.writeFileSync(outFile, JSON.stringify(payload));
console.log(`saved ${all.length} reservations`);

const child = spawn(process.execPath, ['scripts/import-reservations-from-json.mjs', outFile], {
  cwd: root,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
