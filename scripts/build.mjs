import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
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

if (!anonKey) {
  console.warn('SUPABASE_ANON_KEY is empty — set it in Vercel Environment Variables.');
}

const configJs = `window.FLOW_SUPABASE_CONFIG={url:${JSON.stringify(url)},anonKey:${JSON.stringify(anonKey)}};\n`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'supabase'), { recursive: true });
fs.mkdirSync(path.join(out, 'css'), { recursive: true });
fs.mkdirSync(path.join(out, 'js'), { recursive: true });

fs.copyFileSync(path.join(root, 'flow.html'), path.join(out, 'flow.html'));
fs.copyFileSync(path.join(root, 'css', 'flow.css'), path.join(out, 'css', 'flow.css'));
fs.copyFileSync(path.join(root, 'js', 'flow.js'), path.join(out, 'js', 'flow.js'));
fs.writeFileSync(path.join(out, 'supabase', 'config.js'), configJs);

// Local dev still uses root supabase/config.js
fs.mkdirSync(path.join(root, 'supabase'), { recursive: true });
fs.writeFileSync(path.join(root, 'supabase', 'config.js'), configJs);

console.log('Build OK → public/');
