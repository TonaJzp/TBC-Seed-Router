// Cat icons from the Battle Cats Wiki (Miraheze), downloaded once at build
// time and published with the site, so visitors never contact the wiki and
// the wiki serves each icon once instead of once per visitor.
//
// The wiki names each unit's first-form icon "<unit>_1.png", where the unit
// number is godfat's cat id - 1 (zero-padded to three digits). The files are
// read from the wiki's file server, at the path MediaWiki derives from the MD5
// of the name: the wiki's own pages and API refuse GitHub's servers (HTTP 403)
// but its file server does not.
//
// Icons already published with the site are taken from there first: the wiki
// is only asked for new cats, and the site keeps its icons even if the build
// cache is lost or the wiki refuses the build server.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const FILES = 'https://static.wikitide.net/battlecatswiki';
const MAX_BYTES = 256 * 1024;
const PUBLISHED_PARALLEL = 8; // our own site: a few downloads at a time

const fileName = (id) => `${String(id - 1).padStart(3, '0')}_1.png`;

/**
 * Where the wiki keeps a cat's icon: the 64 px thumbnail, and the original
 * (thumbnails of images that are already that small do not exist).
 */
function iconUrls(id) {
  const name = fileName(id);
  const md5 = crypto.createHash('md5').update(name).digest('hex');
  const dir = `${md5[0]}/${md5.slice(0, 2)}/${name}`;
  return { thumb: `${FILES}/thumb/${dir}/64px-${name}`, original: `${FILES}/${dir}` };
}

/**
 * The icon of one cat from the wiki, or null if the wiki has no such file.
 * Throws if the wiki does not answer as expected (refused, down...).
 */
async function wikiIcon(id, opts) {
  const { thumb, original } = iconUrls(id);
  for (const url of [thumb, original]) {
    const { body, status, error } = await downloadPng(url, opts);
    if (body) return body;
    // 400: no thumbnail for small images; 404: no such file.
    if (status !== 400 && status !== 404) throw new Error(error);
  }
  return null;
}

/** The PNG at `url`, or the reason it can't be used. */
async function downloadPng(url, { userAgent, fetchImpl }) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent } });
  const type = res.headers.get('content-type') || '';
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok || !type.startsWith('image/png') || body.length > MAX_BYTES) {
    return { status: res.status, error: `HTTP ${res.status} (${type || 'sin tipo'}, ${body.length} bytes)` };
  }
  return { body };
}

/** Copies into the cache the icons the published site already has. */
async function fromPublished(ids, siteUrl, cached, opts) {
  const res = await opts.fetchImpl(new URL('data/gacha.json', siteUrl), { headers: { 'User-Agent': opts.userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const published = new Set((await res.json()).icons || []);
  const queue = ids.filter((id) => published.has(id));
  const failed = [];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const { body } = await downloadPng(new URL(`icons/${id}.png`, siteUrl), opts);
        if (body) fs.writeFileSync(cached(id), body);
        else failed.push(id);
      } catch {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: PUBLISHED_PARALLEL }, worker));
  return failed;
}

/**
 * Copies the icon of every id into `outDir` as <id>.png. Icons missing from
 * `cacheDir` are taken from the published site (`siteUrl`, if given) and then
 * from the wiki. Returns { icons: ids with an icon, warnings, wikiError }:
 * warnings are only logged; wikiError says the wiki could not be asked (the
 * icons it would have given are missing).
 */
async function buildIcons(ids, { cacheDir, outDir, userAgent, siteUrl = null, fetchImpl = fetch }) {
  const warnings = [];
  let wikiError = null;
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const cached = (id) => path.join(cacheDir, `${id}.png`);
  const missing = () => ids.filter((id) => !fs.existsSync(cached(id)));
  const opts = { userAgent, fetchImpl };

  if (siteUrl && missing().length) {
    try {
      const failed = await fromPublished(missing(), siteUrl, cached, opts);
      if (failed.length) warnings.push(`${failed.length} iconos de la web publicada no se pudieron copiar; se piden a la wiki.`);
    } catch (err) {
      warnings.push(`No se pudieron copiar los iconos de la web publicada (${err.message}); se piden a la wiki.`);
    }
  }

  // One icon at a time: the wiki is a volunteer project.
  const notOnWiki = [];
  for (const id of missing()) {
    try {
      const body = await wikiIcon(id, opts);
      if (body) fs.writeFileSync(cached(id), body);
      else notOnWiki.push(id);
    } catch (err) {
      wikiError = err.message;
      warnings.push(`No se pudieron descargar iconos nuevos de la wiki (${err.message}); se publican los que ya había.`);
      break;
    }
  }
  if (notOnWiki.length) warnings.push(`La wiki no tiene el icono de ${notOnWiki.length} gatos (${notOnWiki.join(', ')}).`);

  const icons = [];
  for (const id of ids) {
    if (!fs.existsSync(cached(id))) continue;
    fs.copyFileSync(cached(id), path.join(outDir, `${id}.png`));
    icons.push(id);
  }
  return { icons, warnings, wikiError };
}

/**
 * Cats of the banners without an icon that need the owner: all of them if the
 * wiki could not be asked; otherwise only those of a banner that has already
 * started (for upcoming cats the wiki often adds the icon later).
 * @param data  the site data (events, gacha, cats, icons)
 * @param today YYYY-MM-DD
 */
function missingIcons(data, today, wikiError) {
  const has = new Set(data.icons);
  const started = new Set(data.events.filter((e) => e.start <= today).map((e) => String(e.gacha)));
  const missing = new Map();
  for (const [gacha, cats] of Object.entries(data.gacha)) {
    if (!wikiError && !started.has(gacha)) continue;
    for (const id of cats) {
      if (has.has(id)) continue;
      const reason = wikiError ? `la wiki no respondió (${wikiError})` : 'la wiki no tiene su icono';
      missing.set(id, { id, name: data.cats[id]?.names[0] || `#${id}`, reason });
    }
  }
  return [...missing.values()].sort((a, b) => a.id - b.id);
}

export { buildIcons, missingIcons, iconUrls };
