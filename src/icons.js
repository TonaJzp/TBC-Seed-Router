'use strict';

// Cat icons are served from this app instead of being hotlinked from the
// wiki: visitors' browsers never contact a third party (nothing to disclose
// or consent to), and the wiki serves each icon once per server instead of
// once per visitor. Icons are kept in a disk cache.
//
// A wiki thumbnail     https://static.wikitide.net/battlecatswiki/thumb/a/a5/877_1.png/64px-877_1.png
// becomes local path   /icons/a/a5/877_1.png

const fs = require('fs');
const path = require('path');
const { site } = require('./site');

const UPSTREAM = 'https://static.wikitide.net/battlecatswiki/thumb/';
const SIZE = '64px-';
// Hash directories + a file name without slashes, kept percent-encoded as on the wiki.
const LOCAL = /^\/([0-9a-f])\/([0-9a-f]{2})\/([\w.()%-]+\.(?:png|jpe?g|gif|webp))$/i;
const WIKI = /^https:\/\/static\.wikitide\.net\/battlecatswiki\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([\w.()%-]+)\/64px-\3$/i;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_BYTES = 512 * 1024;
const MAX_AGE_S = 30 * 24 * 3600;

/** Local path for a wiki thumbnail URL, or null if it isn't one. */
function localIconPath(image) {
  const m = WIKI.exec(image || '');
  return m && LOCAL.test(`/${m[1]}/${m[2]}/${m[3]}`) ? `/icons/${m[1]}/${m[2]}/${m[3]}` : null;
}

function iconHandler({ cacheDir, fetchImpl = fetch }) {
  const inFlight = new Map();

  async function load(rel, file) {
    const cached = path.join(cacheDir, rel);
    try {
      return await fs.promises.readFile(cached);
    } catch {
      /* not cached yet */
    }
    const res = await fetchImpl(`${UPSTREAM}${rel}/${SIZE}${file}`, { headers: { 'User-Agent': site.userAgent } });
    if (!res.ok) return null;
    if (!/^image\//.test(res.headers.get('content-type') || '')) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return null;
    await fs.promises.mkdir(path.dirname(cached), { recursive: true });
    await fs.promises.writeFile(cached, body);
    return body;
  }

  return async (req, res) => {
    // req.path is still percent-encoded, exactly like the wiki file name.
    const m = LOCAL.exec(req.path);
    if (!m) return res.sendStatus(404);
    const [, a, ab, file] = m;
    const rel = `${a}/${ab}/${file}`;
    if (!inFlight.has(rel)) inFlight.set(rel, load(rel, file).finally(() => inFlight.delete(rel)));
    let body;
    try {
      body = await inFlight.get(rel);
    } catch {
      return res.sendStatus(502);
    }
    if (!body) return res.sendStatus(404);
    res.set('Content-Type', TYPES[file.split('.').pop().toLowerCase()]);
    res.set('Cache-Control', `public, max-age=${MAX_AGE_S}, immutable`);
    res.send(body);
  };
}

module.exports = { iconHandler, localIconPath };
