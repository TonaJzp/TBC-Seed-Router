// The daily pipeline: reading godfat's pages, checking godfat's data file,
// the wiki icons and the notifications to the owner.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseHTML } from 'linkedom';
import { parseEventList, parseTable, organize } from '../scripts/lib/godfat-html.js';
import { transform } from '../scripts/lib/godfat-data.js';
import { buildIcons, fileTitle, idOfTitle } from '../scripts/lib/wiki-icons.js';
import { findProblems } from '../scripts/notify.js';

const fixtureHtml = fs.readFileSync(new URL('./fixtures/godfat-table.html', import.meta.url), 'utf8');

// --- godfat pages ----------------------------------------------------------------

test('godfat pages are read without a browser: cells, re-rolls, guaranteed, pools and banner list', () => {
  const { document } = parseHTML(fixtureHtml);
  const table = parseTable(document);
  const ev = organize({ id: 'x' }, [{ offset: 0, table }]);
  assert.ok(Object.keys(ev.raw).length >= 40);
  assert.ok(Object.keys(ev.guaranteed).length > 0);
  assert.ok(Object.keys(ev.alt).length > 0);
  assert.ok(ev.pools.rare.length > 10 && ev.pools.uber.length > 0);
  assert.equal(ev.raw['1A'].name, 'Mer-Cat');
  assert.ok(Object.values(ev.guaranteed).every((g) => /^\d+[AB]$/.test(g.dest)));
  const list = parseEventList(document);
  assert.equal(list.length, 18);
  assert.deepEqual(list[0], {
    id: '2026-07-24_1063',
    label: list[0].label,
    start: '2026-07-24',
    end: '2026-10-16',
    name: 'Get an Uber Rare Cat!! 100% Uber drop Rate in the PLATINUM CAPSULES!',
  });
});

test('a godfat page without the expected parts is noticed, not misread', () => {
  const { document } = parseHTML('<html><body><p>Mantenimiento</p></body></html>');
  assert.equal(parseEventList(document), null);
  assert.equal(parseTable(document).cells.length, 0);
});

// --- godfat's data file ------------------------------------------------------------

const yamlLike = () => ({
  cats: {
    1: { name: ['Cat', 'Macho Cat'], rarity: 0 },
    10: { name: ['Rare A'], rarity: 2 },
    11: { name: ['Rare B'], rarity: 2 },
    20: { name: ['Super A'], rarity: 3 },
    30: { name: ['Uber A'], rarity: 4 },
    31: { name: ['Uber Never In Gacha'], rarity: 4 },
    40: { name: ['Legend A'], rarity: 5 },
  },
  gacha: {
    100: { cats: [10, 11, 20, 30, 40], series_id: 1 },
    101: { cats: [30, 40], series_id: 2 },
  },
  // In date order, like godfat's file.
  events: {
    '2026-09-01_100': { start_on: '2026-09-01', end_on: '2026-09-03', name: 'Old', id: 100, rare: 6970, supa: 2500, uber: 500 },
    '2026-10-01_100': { start_on: '2026-10-01', end_on: '2026-10-20', name: 'A', id: 100, rare: 6970, supa: 2500, uber: 500, legend: 30 },
    '2026-10-05_101': { start_on: '2026-10-05', end_on: '2030-01-01', name: 'Plat', id: 101, rare: 0, supa: 0, uber: 10000, platinum: 'platinum' },
    '2026-10-10_100': { start_on: '2026-10-10', end_on: '2026-10-25', name: 'A again', id: 100, rare: 6970, supa: 2500, uber: 500, guaranteed: true },
  },
});

test('the data file becomes compact banner data, with godfat\'s end dates', () => {
  const { data, errors, warnings } = transform(yamlLike(), { today: '2026-10-08' });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(data.events.map((e) => e.id), ['2026-10-01_100', '2026-10-05_101', '2026-10-10_100'], 'past banners dropped');
  const first = data.events[0];
  assert.equal(first.end, '2026-10-10', 'a banner ends when the next one of its series starts');
  assert.equal(data.events[1].ticket, 'platinum');
  assert.equal(data.events[2].guaranteed, 11);
  assert.ok(data.cats[1] && data.cats[30] && !data.cats[31], 'gacha cats never in an English gacha are left out');
});

test('anything unexpected in the data file is reported, never guessed', () => {
  const check = (mutate) => {
    const raw = yamlLike();
    mutate(raw);
    return transform(raw, { today: '2026-10-08' });
  };
  assert.match(check((r) => (r.events['2026-10-01_100'].new_mechanic = 1)).warnings.join(), /campos nuevos.*new_mechanic/);
  assert.match(check((r) => (r.events['2026-10-01_100'].rare = 9000)).errors.join(), /probabilidades no válidas/);
  assert.match(check((r) => (r.events['2026-10-01_100'].legend = 60)).warnings.join(), /no cuadra/);
  assert.match(check((r) => (r.events['2026-10-10_100'].step_up = true)).errors.join(), /garantizado y step-up/);
  assert.match(check((r) => r.gacha[100].cats.push(999)).errors.join(), /faltan o no son de gacha.*999/);
  assert.match(check((r) => (r.events['2026-10-01_100'].start_on = '2026-13-01')).errors.join(), /fechas no válidas/);
  assert.match(check((r) => (r.events['2026-10-05_101'].platinum = 'diamond')).warnings.join(), /ticket desconocido/);
  assert.match(check((r) => delete r.gacha).errors.join(), /no tiene las secciones/);
  const stale = transform(yamlLike(), { today: '2026-10-24' });
  assert.match(stale.warnings.join(), /No hay banners anunciados/);
});

// --- Wiki icons ----------------------------------------------------------------------

test('wiki icon names follow the unit number (godfat id - 1)', () => {
  assert.equal(fileTitle(851), 'File:850_1.png');
  assert.equal(fileTitle(80), 'File:079_1.png');
  assert.equal(idOfTitle('File:850 1.png'), 851);
  assert.equal(idOfTitle('File:M_000.png'), null);
});

test('icons are downloaded once, cached, and the cache is used if the wiki is down', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const cacheDir = path.join(dir, 'cache');
  const outDir = path.join(dir, 'out');
  const calls = [];
  const wiki = async (url) => {
    calls.push(url);
    if (url.includes('api.php')) {
      return new Response(JSON.stringify({
        query: { pages: { 1: { title: 'File:850 1.png', imageinfo: [{ thumburl: 'https://img/850.png' }] }, '-1': { title: 'File:999 1.png', missing: '' } } },
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(Buffer.from('PNG'), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const first = await buildIcons([851, 1000], { cacheDir, outDir, userAgent: 'test', fetchImpl: wiki });
    assert.deepEqual(first.icons, [851]);
    assert.deepEqual(first.warnings, []);
    assert.ok(fs.existsSync(path.join(outDir, '851.png')));
    const before = calls.length;
    const down = async () => {
      throw new Error('sin conexión');
    };
    const second = await buildIcons([851, 1000], { cacheDir, outDir, userAgent: 'test', fetchImpl: down });
    assert.deepEqual(second.icons, [851], 'cached icon still published');
    assert.match(second.warnings.join(), /se publican los que ya había/);
    assert.equal(calls.length, before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Notifications ---------------------------------------------------------------------

const ok = { BUILD_OUTCOME: 'success', DEPLOY_OUTCOME: 'success' };
const now = new Date('2026-10-10T06:00:00Z');

test('nothing to report when the data is fine and matches godfat', () => {
  const verify = { result: 'ok', lastOk: '2026-10-10T05:30:00Z', differences: [] };
  assert.deepEqual(findProblems(ok, { ok: true, warnings: [] }, verify, now), []);
});

test('every kind of problem is reported to the owner', () => {
  const build = { ok: true, warnings: ['Banner X: campos nuevos'] };
  const mismatch = { result: 'mismatch', seed: 5, banners: 3, rolls: 300, differences: [{ kind: 'Gato distinto en una casilla', count: 2, examples: ['a', 'b'] }] };
  const report = findProblems(ok, build, mismatch, now).join('\n');
  assert.match(report, /Avisos en los datos/);
  assert.match(report, /no coincide con bc\.godfat\.org/);
  assert.match(report, /Gato distinto en una casilla/);

  const failed = findProblems({ BUILD_OUTCOME: 'failure' }, { ok: false, errors: ['formato inesperado'] }, null, now).join();
  assert.match(failed, /No se han podido actualizar los datos.*formato inesperado/s);

  const deploy = findProblems({ ...ok, DEPLOY_OUTCOME: 'failure' }, { ok: true, warnings: [] }, { result: 'ok', lastOk: now.toISOString(), differences: [] }, now);
  assert.match(deploy.join(), /No se ha podido publicar/);

  const tests = findProblems({ TESTS_OUTCOME: 'failure', BUILD_OUTCOME: 'skipped' }, null, null, now);
  assert.equal(tests.length, 1, 'a failing test explains the rest, without follow-up noise');
  assert.match(tests[0], /Han fallado los tests/);
});

test('godfat being briefly unreachable is tolerated; for days, it is reported', () => {
  const recent = { result: 'unreachable', lastOk: '2026-10-09T05:00:00Z', error: 'HTTP 502' };
  assert.deepEqual(findProblems(ok, { ok: true, warnings: [] }, recent, now), []);
  const old = { result: 'unreachable', lastOk: '2026-10-05T05:00:00Z', error: 'HTTP 502' };
  assert.match(findProblems(ok, { ok: true, warnings: [] }, old, now).join(), /No se puede comprobar.*2026-10-05.*HTTP 502/s);
  assert.match(findProblems(ok, { ok: true, warnings: [] }, null, now).join(), /no llegó a ejecutarse/);
});
