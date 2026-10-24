/**
 * Raises public.reservations guests check to 1..300.
 * Prefers DATABASE_URL / POSTGRES_URL; otherwise prints SQL for the dashboard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv(file) {
  const out = {};
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && out[m[1]] == null) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const sql = [
  'alter table public.reservations drop constraint if exists reservations_guests_check;',
  'alter table public.reservations add constraint reservations_guests_check check (guests between 1 and 300);',
].join('\n');

const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL || '';
if (dbUrl) {
  const psql = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (psql.status === 0) {
    console.log('OK: guests max is now 300');
    process.exit(0);
  }
  console.error(psql.stderr || psql.stdout || 'psql failed');
}

console.log('Run in Supabase SQL Editor:');
console.log(sql);
process.exit(dbUrl ? 1 : 2);
