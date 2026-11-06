import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'src/data/panneaux.json');
const outDir = path.join(root, 'public/signs');
const mapFile = path.join(root, 'src/data/signs-local.json');
const UA = 'SignaGo/1.0 (educational road signs app; contact: signago-app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slug = (code) => code.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const baseCode = (code) => code.replace(/\s*\([^)]*\)/, '').trim();

async function exists(file) {
  try { return (await stat(file)).size > 200; } catch { return false; }
}

async function getText(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'image/svg+xml,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* réessaie */ }
    await sleep(800 * attempt);
  }
  return null;
}

const isSvg = (t) => typeof t === 'string' && t.includes('<svg');

async function searchSvgUrl(code) {
  for (const q of [`France road sign ${baseCode(code)}`, `France road sign ${code}`]) {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=6&format=json`;
    const txt = await getText(api);
    if (!txt) continue;
    try {
      const exact = new RegExp(`France road sign ${baseCode(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i');
      const hit = (JSON.parse(txt)?.query?.search || []).find((r) => r.title.toLowerCase().endsWith('.svg') && exact.test(r.title));
      if (hit) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(hit.title.replace(/^(File|Fichier):/i, ''))}`;
    } catch { /* ignore */ }
  }
  return null;
}

async function main() {
  if (process.env.SKIP_SIGN_FETCH) { console.log('[signs] ignoré'); return; }
  console.log('[signs] démarrage');
  const deadline = Date.now() + 4 * 60 * 1000;
  const signs = JSON.parse(await readFile(dataFile, 'utf8')).filter(
    (s) => s.imageUrl && s.imageUrl.startsWith('http')
  );
  await mkdir(outDir, { recursive: true });
  const map = {};
  const failed = [];
  let downloaded = 0, kept = 0;

  for (let i = 0; i < signs.length; i++) {
    if (Date.now() > deadline) {
      console.log('[signs] temps écoulé, images restantes ignorées');
      break;
    }

    const currentNumber = i + 1;
    if (currentNumber % 20 === 0) {
      console.log(`[signs] ${currentNumber}/${signs.length}…`);
    }

    const s = signs[i];
    const file = `${slug(s.code)}.svg`;
    const target = path.join(outDir, file);
    if (await exists(target)) { map[s.code] = `/signs/${file}`; kept++; continue; }

    let text = await getText(s.imageUrl);
    if (!isSvg(text)) {
      const found = await searchSvgUrl(s.code);
      text = found ? await getText(found) : null;
    }
    if (isSvg(text)) {
      await writeFile(target, text, 'utf8');
      map[s.code] = `/signs/${file}`;
      downloaded++;
    } else {
      failed.push(s.code);
    }
    await sleep(150);
  }

  await writeFile(mapFile, JSON.stringify(map, null, 2) + '\n', 'utf8');
  console.log(`[signs] ${downloaded} téléchargées, ${kept} déjà présentes, ${failed.length} échecs`);
  if (failed.length) console.log(`[signs] sans image locale : ${failed.join(', ')}`);
}

main().catch((e) => console.warn('[signs] erreur ignorée :', e?.message || e));
