// Cat icons from the Battle Cats Wiki (Miraheze), downloaded once at build
// time and published with the site, so visitors never contact the wiki and
// the wiki serves each icon once instead of once per visitor.
//
// The wiki names each unit's first-form icon "<unit>_1.png", where the unit
// number is godfat's cat id - 1 (zero-padded to three digits).

import fs from 'fs';
import path from 'path';

const API = 'https://battlecats.miraheze.org/w/api.php';
const BATCH = 50; // titles per API request (MediaWiki limit)
const MAXLAG_S = 5;
const MAX_BYTES = 256 * 1024;

const fileTitle = (id) => `File:${String(id - 1).padStart(3, '0')}_1.png`;
const idOfTitle = (title) => {
  const m = /^File:(\d+)[ _]1\.png$/.exec(title || '');
  return m ? Number(m[1]) + 1 : null;
};

async function apiJson(params, { userAgent, fetchImpl }) {
  const url = `${API}?${new URLSearchParams({ format: 'json', maxlag: String(MAXLAG_S), ...params })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent } });
    const data = await res.json().catch(() => null);
    // With maxlag the wiki asks clients to wait while it is busy.
    if (data?.error?.code === 'maxlag') {
      const wait = Math.min(Number(res.headers.get('retry-after')) || MAXLAG_S, 30);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!res.ok || !data) throw new Error(`la wiki respondió HTTP ${res.status}`);
    return data;
  }
  throw new Error('la wiki está saturada (maxlag)');
}

/** Thumbnail URL (64 px) of every id that has an icon on the wiki. */
async function iconUrls(ids, opts) {
  const urls = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const titles = ids.slice(i, i + BATCH).map(fileTitle).join('|');
    const data = await apiJson({ action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '64', titles }, opts);
    for (const page of Object.values(data.query?.pages || {})) {
      const id = idOfTitle(page.title);
      const url = page.imageinfo?.[0]?.thumburl;
      if (id && url) urls.set(id, url);
    }
  }
  return urls;
}

/**
 * Copies the icon of every id into `outDir` as <id>.png, downloading only the
 * ones missing from `cacheDir`. Returns { icons: ids with an icon, warnings }.
 * If the wiki is unreachable, the cached icons are still published.
 */
async function buildIcons(ids, { cacheDir, outDir, userAgent, fetchImpl = fetch }) {
  const warnings = [];
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const cached = (id) => path.join(cacheDir, `${id}.png`);
  const missing = ids.filter((id) => !fs.existsSync(cached(id)));

  if (missing.length) {
    try {
      const urls = await iconUrls(missing, { userAgent, fetchImpl });
      for (const [id, url] of urls) {
        const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent } });
        const type = res.headers.get('content-type') || '';
        const body = Buffer.from(await res.arrayBuffer());
        if (!res.ok || !type.startsWith('image/png') || body.length > MAX_BYTES) {
          warnings.push(`Icono ${id}: descarga no válida (HTTP ${res.status}, ${type}).`);
          continue;
        }
        fs.writeFileSync(cached(id), body);
      }
    } catch (err) {
      warnings.push(`No se pudieron descargar iconos nuevos de la wiki (${err.message}); se publican los que ya había.`);
    }
  }

  const icons = [];
  for (const id of ids) {
    if (!fs.existsSync(cached(id))) continue;
    fs.copyFileSync(cached(id), path.join(outDir, `${id}.png`));
    icons.push(id);
  }
  return { icons, warnings };
}

export { buildIcons, fileTitle, idOfTitle };
