'use strict';

// Everything the public deployment adds: site configuration, load limits,
// icon proxy, legal page and security headers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSite, siteProblems } = require('../src/site');
const { JobQueue, QueueFullError, createRateLimiter } = require('../src/limits');
const { iconHandler, localIconPath } = require('../src/icons');
const { createApp } = require('../server');

const PUBLIC_ENV = {
  NODE_ENV: 'production',
  SITE_URL: 'https://seed.example.org/',
  CONTACT_EMAIL: 'contacto@example.org',
  HOSTING_PROVIDER: 'Hosting SAS (Francia)',
};

const VALID_BODY = {
  url: 'https://bc.godfat.org/?seed=1',
  targets: ['A'],
  from: '2099-01-01',
  to: '2099-01-02',
  today: '2099-01-01',
};

async function withServer(options, fn) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const postRoutes = async (base, body = VALID_BODY) =>
  (await (await fetch(`${base}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// --- Site configuration -----------------------------------------------------

test('the User-Agent identifies the app with its public URL and contact', () => {
  const site = loadSite(PUBLIC_ENV);
  assert.equal(site.url, 'https://seed.example.org');
  assert.equal(site.userAgent, 'TBCSeedRouter/1.0 (+https://seed.example.org; contacto@example.org)');
  assert.equal(loadSite({}).userAgent, 'TBCSeedRouter/1.0 (local)');
});

test('production refuses to start without a contact email and public URL', () => {
  assert.deepEqual(siteProblems(loadSite(PUBLIC_ENV)).errors, []);
  const { errors } = siteProblems(loadSite({ NODE_ENV: 'production' }));
  assert.equal(errors.length, 2);
  assert.deepEqual(siteProblems(loadSite({})).errors, [], 'local runs need nothing');
});

test('the support link only appears with the full owner identification', () => {
  const donate = { ...PUBLIC_ENV, DONATE_URL: 'https://ko-fi.com/example' };
  assert.equal(loadSite(donate).donationsEnabled, false);
  assert.match(siteProblems(loadSite(donate)).warnings.join(), /OWNER_NIF/);
  const full = loadSite({ ...donate, OWNER_NIF: '00000000T', OWNER_ADDRESS: 'Calle Falsa 1, Madrid' });
  assert.equal(full.donationsEnabled, true);
  assert.equal(loadSite({ ...donate, DONATE_URL: 'http://insecure.example', OWNER_NIF: 'x', OWNER_ADDRESS: 'y' }).donationsEnabled, false);
});

test('GODFAT_ENABLED=false switches godfat off', () => {
  assert.equal(loadSite({}).godfatEnabled, true);
  assert.equal(loadSite({ GODFAT_ENABLED: 'false' }).godfatEnabled, false);
});

// --- Load limits ------------------------------------------------------------

test('the queue runs a fixed number of jobs at once and reports the line', async () => {
  const queue = new JobQueue({ concurrency: 1, maxWaiting: 1 });
  let release;
  const first = queue.run(() => new Promise((resolve) => (release = resolve)));
  const positions = [];
  const second = queue.run(async () => 'second', { onWait: (n) => positions.push(n) });
  await assert.rejects(queue.run(async () => 'third'), QueueFullError);
  assert.equal(queue.running, 1);
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.deepEqual(positions, [1]);
});

test('a visitor that leaves while waiting is dropped from the queue', async () => {
  const queue = new JobQueue({ concurrency: 1, maxWaiting: 5 });
  let release;
  const first = queue.run(() => new Promise((resolve) => (release = resolve)));
  const left = new AbortController();
  let ran = false;
  const waiting = queue.run(async () => (ran = true), { signal: left.signal });
  left.abort();
  await assert.rejects(waiting, /cancelada/);
  release();
  await first;
  assert.equal(ran, false);
  assert.equal(queue.waiting.length, 0);
});

test('the rate limiter allows max hits per window and forgets old visitors', () => {
  let t = 0;
  const hit = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.ok(hit('a').ok);
  assert.ok(hit('a').ok);
  const third = hit('a');
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterMs, 1000);
  assert.ok(hit('b').ok, 'other visitors are not affected');
  t = 1000;
  assert.ok(hit('a').ok, 'a new window starts');
});

// --- Icons ------------------------------------------------------------------

test('every wiki icon in the snapshot maps to a local path', () => {
  const { cats } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cats.json'), 'utf8'));
  for (const c of cats.filter((c) => c.image)) assert.ok(localIconPath(c.image), c.image);
  assert.equal(
    localIconPath('https://static.wikitide.net/battlecatswiki/thumb/a/a5/877_1.png/64px-877_1.png'),
    '/icons/a/a5/877_1.png'
  );
  assert.equal(localIconPath('https://evil.example/battlecatswiki/thumb/a/a5/x.png/64px-x.png'), null);
});

test('icons are fetched from the wiki once, cached, and nothing else is proxied', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(Buffer.from('PNG'), { headers: { 'content-type': 'image/png' } });
  };
  const handler = iconHandler({ cacheDir, fetchImpl });
  const express = require('express');
  const app = express().use('/icons', handler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/icons`;
  try {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/0/0e/Li%27l_Cat.png`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.equal(await res.text(), 'PNG');
    }
    assert.deepEqual(calls, ['https://static.wikitide.net/battlecatswiki/thumb/0/0e/Li%27l_Cat.png/64px-Li%27l_Cat.png']);
    for (const bad of ['/0/0e/x.svg', '/0/0e/../../x.png', '/zz/0e/x.png', '/0/0e/a/b.png']) {
      assert.equal((await fetch(base + bad)).status, 404, bad);
    }
    assert.equal(calls.length, 1);
  } finally {
    server.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// --- HTTP -------------------------------------------------------------------

test('pages are served with security headers and no third-party sources', async () => {
  await withServer({ site: loadSite(PUBLIC_ENV) }, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('strict-transport-security'), /max-age/);
    const html = await res.text();
    assert.doesNotMatch(html, /<script>/, 'no inline scripts (blocked by the CSP)');
    assert.match(html, /\/legal#privacidad/);
  });
});

test('the legal page shows the owner, credits and licences, escaping configured values', async () => {
  const site = loadSite({ ...PUBLIC_ENV, OWNER_NAME: 'Ana <script>' });
  await withServer({ site }, async (base) => {
    const html = await (await fetch(`${base}/legal`)).text();
    assert.match(html, /Ana &lt;script&gt;/);
    assert.match(html, /contacto@example\.org/);
    assert.match(html, /Hosting SAS \(Francia\)/);
    assert.match(html, /CC BY-SA 4\.0/);
    assert.match(html, /PONOS Corporation/);
    assert.match(html, /Lin Jen-Shin/);
    assert.doesNotMatch(html, /id="apoyo"/, 'no support section without donations');
  });
});

test('the support section appears only when donations are fully configured', async () => {
  const site = loadSite({
    ...PUBLIC_ENV,
    DONATE_URL: 'https://ko-fi.com/example',
    DONATE_PLATFORM: 'Ko-fi',
    OWNER_NIF: '00000000T',
    OWNER_ADDRESS: 'Calle Falsa 1, Madrid',
  });
  await withServer({ site }, async (base) => {
    const html = await (await fetch(`${base}/legal`)).text();
    assert.match(html, /id="apoyo"/);
    assert.match(html, /href="https:\/\/ko-fi\.com\/example"/);
    assert.match(html, /00000000T/);
    assert.deepEqual(await (await fetch(`${base}/api/site`)).json(), { name: 'TBC Seed Router', donations: true, godfatEnabled: true });
  });
});

test('with godfat switched off, no search reaches the queue', async () => {
  let queued = 0;
  const queue = { run: async () => queued++ };
  await withServer({ site: loadSite({ GODFAT_ENABLED: 'false' }), queue }, async (base) => {
    const [msg] = await postRoutes(base);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /desactivada/);
  });
  assert.equal(queued, 0);
});

test('each visitor has a quota; invalid requests do not use it up', async () => {
  let queued = 0;
  const queue = { run: async () => queued++ };
  const rateLimit = createRateLimiter({ max: 1, windowMs: 60_000 });
  await withServer({ site: loadSite({}), queue, rateLimit }, async (base) => {
    const [bad] = await postRoutes(base, { ...VALID_BODY, url: 'https://example.org/' });
    assert.match(bad.message, /bc\.godfat\.org/);
    assert.deepEqual(await postRoutes(base), []);
    const [limited] = await postRoutes(base);
    assert.equal(limited.type, 'error');
    assert.match(limited.message, /límite por persona/);
  });
  assert.equal(queued, 1);
});
