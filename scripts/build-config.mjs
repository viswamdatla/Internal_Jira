import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const url = process.env.SUPABASE_URL?.trim() || 'https://rnuqzkjeuthbgbjcfywx.supabase.co';
const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || '';

fs.writeFileSync(
  path.join(root, 'supabase', 'config.js'),
  `window.FLOW_SUPABASE_CONFIG={url:${JSON.stringify(url)},anonKey:${JSON.stringify(anonKey)}};\n`
);
