// The version stamped on the published scripts (scripts/stamp-version.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { stampJs, stampHtml, stampDir } from '../scripts/stamp-version.js';
import { gachaData } from './helpers.js';
import { plan } from '../public/core/planner.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
// Any relative .js or .css reference left in a file, stamped or not.
const REF = /(['"])(\.{0,2}\/?[\w./-]+\.(?:js|css))(\?v=[\w.-]+)?\1/g;

test('relative modules, worker URLs and page scripts get the version; nothing else does', () => {
  const js = [
    "import { a } from './a.js';",
    'import {\n  b,\n  c,\n} from "../core/b.js";',
    "import './side.js';",
    "export { d } from './d.js';",
    "const W = new URL('./calc-worker.js', import.meta.url);",
    "const k = key === 'from' || x === './not-a-module.js';",
    "fetch('data/gacha.json');",
    "import x from 'https://example.org/x.js';",
  ].join('\n');
  const out = stampJs(js, 'abc123');
  assert.match(out, /from '\.\/a\.js\?v=abc123'/);
  assert.match(out, /from "\.\.\/core\/b\.js\?v=abc123"/);
  assert.match(out, /import '\.\/side\.js\?v=abc123'/);
  assert.match(out, /from '\.\/d\.js\?v=abc123'/);
  assert.match(out, /new URL\('\.\/calc-worker\.js\?v=abc123'/);
  assert.match(out, /=== '\.\/not-a-module\.js'/, 'a plain string is not a module');
  assert.match(out, /fetch\('data\/gacha\.json'\)/);
  assert.match(out, /'https:\/\/example\.org\/x\.js'/);
  assert.equal(stampJs(out, 'abc123'), out, 'stamping twice changes nothing');

  const html = '<script src="theme-init.js"></script><link rel="stylesheet" href="style.css"><link rel="icon" href="favicon.svg">' +
    '<a href="credits.html">c</a><script src="https://x.org/y.js"></script><script type="module" src="app.js"></script>';
  const page = stampHtml(html, 'abc123');
  assert.match(page, /src="theme-init\.js\?v=abc123"/);
  assert.match(page, /href="style\.css\?v=abc123"/);
  assert.match(page, /src="app\.js\?v=abc123"/);
  assert.match(page, /href="favicon\.svg"/);
  assert.match(page, /href="credits\.html"/);
  assert.match(page, /src="https:\/\/x\.org\/y\.js"/);
  assert.equal(stampHtml(page, 'abc123'), page);
  assert.throws(() => stampDir(PUBLIC, 'bad version'), /no válida/);
});

test('the stamped site leaves no module unversioned and calculates the same', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  try {
    fs.cpSync(PUBLIC, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}data`) });
    const changed = stampDir(dir, 'v42');
    for (const file of ['app.js', 'calc-client.js', 'calc-worker.js', 'core/planner.js', 'core/optimizer.js', 'index.html', 'credits.html']) {
      assert.ok(changed.includes(file), `${file} is stamped`);
    }
    // Every reference to a local script or style, in every file, carries the version.
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(js|html)$/.test(f));
    let refs = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(REF)) {
        if (/^(data|\.\/not)/.test(m[2])) continue;
        const local = fs.existsSync(path.join(dir, path.dirname(f), m[2]));
        if (!local) continue; // a word in a comment, not a file of the site
        refs++;
        assert.equal(m[3], '?v=v42', `${f}: ${m[0]}`);
      }
    }
    assert.ok(refs > 30, `the references were found (${refs})`);
    // The stamped modules load and give the same result.
    const stamped = await import(pathToFileURL(path.join(dir, 'core', 'planner.js')).href + '?v=v42');
    const body = { url: '1234567', targets: ['870'], from: '2026-10-16', to: '2026-10-20', rolls: '60', tickets: '2', food: '100000' };
    const now = new Date(2026, 9, 16, 12, 0);
    // Without the time each search took, which changes from one run to the next.
    const timeless = (result) => ({ ...result, routes: result.routes.map(({ ms, ...r }) => r) });
    assert.deepEqual(timeless(stamped.plan(body, gachaData, { now })), timeless(plan(body, gachaData, { now })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
