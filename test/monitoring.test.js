// The daily pipeline: reading godfat's pages, checking godfat's data file,
// the wiki icons and the notifications to the owner.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseHTML } from 'linkedom';
import { parseEventList, parseTable, organize } from '../scripts/lib/godfat-html.js';
import { transform, eventHours } from '../scripts/lib/godfat-data.js';
import { buildIcons, missingIcons, iconUrls } from '../scripts/lib/wiki-icons.js';
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

test('the score colour is read as godfat computes it, also under an exclusive cat', () => {
  // Class pairs from a real page with highlighting=advanced.
  const cell = (key, classes) =>
    `<td class="position cat pick ${classes}" onclick="pick('${key}')"><span><a href="/?seed=1" title="x">Cat ${key}</a> <a href="/cats/${key.length}">i</a></span></td>`;
  const { document } = parseHTML(`<table><tr>
    ${cell('1A', 'minor_legend_fest major_exclusive')}
    ${cell('2A', 'major_legend_fest minor_uber')}
    ${cell('3A', 'major_uber_fest minor_uber')}
    ${cell('4A', 'minor_exclusive major_exclusive')}
    ${cell('5A', 'major_legend minor_legend')}
  </tr></table>`);
  const colors = Object.fromEntries(parseTable(document).cells.map((c) => [`${c.n}${c.track}`, c.colors]));
  assert.deepEqual(colors, {
    '1A': ['legend_fest'], // an exclusive cat on a lilac score: lilac, as the app says
    '2A': ['legend_fest'], // the minor class is the cat's rarity, not a score colour
    '3A': ['uber_fest'],
    '4A': ['exclusive'], // score colour rare, or hidden (default highlighting): never a legend colour
    '5A': ['legend'],
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

// The game's event file (gatya.tsv) for the same banners: date, hour, end
// date, end hour, ..., type 1 (rare gacha), pool 1, then the 15 pool fields.
const tsvRow = (start, startHour, end, endHour, id) =>
  [start, startHour, end, endHour, 150600, 999999, 0, 0, 1, 1, id, 0, 0, 0, 0, 0, 6970, 0, 2500, 0, 500, 0, 30, 0, 'x'].join('\t');
const tsvLike = () =>
  ['[start]', tsvRow('20260901', '1100', '20260903', '1100', 100), tsvRow('20261001', '1100', '20261020', '1100', 100),
    tsvRow('20261005', '1100', '20300101', '1100', 101), tsvRow('20261010', '1200', '20261025', '1100', 100),
    // Other kinds of rows are ignored.
    ['20261001', '1100', '20261030', '000', 150600, 999999, 0, 0, 4, 1, 55, 0].join('\t'), '[end]'].join('\r\n');

test('the hours of the banners are read from the game\'s event file', () => {
  const hours = eventHours(tsvLike());
  assert.equal(hours.size, 4);
  assert.deepEqual(hours.get('2026-10-10_100'), { start: '12:00', end: '11:00', endDate: '2026-10-25' });
});

test('the data file becomes compact banner data, with godfat\'s end dates', () => {
  const { data, errors, warnings } = transform(yamlLike(), { today: '2026-10-08', hours: eventHours(tsvLike()) });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(data.events.map((e) => e.id), ['2026-10-01_100', '2026-10-05_101', '2026-10-10_100'], 'past banners dropped');
  const first = data.events[0];
  assert.equal(first.end, '2026-10-10', 'a banner ends when the next one of its series starts');
  assert.equal(first.endTime, '12:00', '...at the hour that one starts');
  assert.deepEqual([data.events[2].startTime, data.events[2].endTime], ['12:00', '11:00']);
  assert.deepEqual([data.events[1].startTime, data.events[1].endTime], ['11:00', '11:00']);
  assert.equal(data.events[1].ticket, 'platinum');
  assert.equal(data.events[2].guaranteed, 11);
  assert.ok(data.cats[1] && data.cats[30] && !data.cats[31], 'gacha cats never in an English gacha are left out');
});

test('anything unexpected in the data file is reported, never guessed', () => {
  const check = (mutate) => {
    const raw = yamlLike();
    mutate(raw);
    return transform(raw, { today: '2026-10-08', hours: eventHours(tsvLike()) });
  };
  assert.match(check((r) => (r.events['2026-10-01_100'].new_mechanic = 1)).warnings.join(), /campos nuevos.*new_mechanic/);
  assert.match(check((r) => (r.events['2026-10-01_100'].rare = 9000)).errors.join(), /probabilidades no válidas/);
  assert.match(check((r) => (r.events['2026-10-01_100'].legend = 60)).warnings.join(), /no cuadra/);
  assert.match(check((r) => (r.events['2026-10-10_100'].step_up = true)).errors.join(), /garantizado y step-up/);
  assert.match(check((r) => r.gacha[100].cats.push(999)).errors.join(), /faltan o no son de gacha.*999/);
  assert.match(check((r) => (r.events['2026-10-01_100'].start_on = '2026-13-01')).errors.join(), /fechas no válidas/);
  assert.match(check((r) => (r.events['2026-10-05_101'].platinum = 'diamond')).warnings.join(), /ticket desconocido/);
  assert.match(check((r) => delete r.gacha).errors.join(), /no tiene las secciones/);
  // Hours: missing or not matching the event file is reported, with 11:00 meanwhile.
  const noFile = transform(yamlLike(), { today: '2026-10-08', hours: null });
  assert.match(noFile.warnings.join(), /No se ha podido leer la hora de los banners/);
  assert.ok(noFile.data.events.every((e) => e.startTime === '11:00' && e.endTime === '11:00'));
  const partial = eventHours(tsvLike());
  partial.delete('2026-10-05_101');
  assert.match(transform(yamlLike(), { today: '2026-10-08', hours: partial }).warnings.join(), /Banner 2026-10-05_101: no se encuentra su hora de inicio/);
  assert.match(check((r) => (r.events['2026-10-10_100'].end_on = '2026-10-26')).warnings.join(), /2026-10-10_100: la fecha de fin no coincide/);
  const stale = transform(yamlLike(), { today: '2026-10-24', hours: eventHours(tsvLike()) });
  assert.match(stale.warnings.join(), /No hay banners anunciados/);
});

// --- Wiki icons ----------------------------------------------------------------------

test('wiki icons are read from its file server, at the MD5 path of "<unit>_1.png" (unit = godfat id - 1)', () => {
  // Real URLs given by the wiki's API.
  assert.deepEqual(iconUrls(1), {
    thumb: 'https://static.wikitide.net/battlecatswiki/thumb/9/94/000_1.png/64px-000_1.png',
    original: 'https://static.wikitide.net/battlecatswiki/9/94/000_1.png',
  });
  assert.equal(iconUrls(730).original, 'https://static.wikitide.net/battlecatswiki/2/24/729_1.png');
});

const png = () => new Response(Buffer.from('PNG'), { headers: { 'content-type': 'image/png' } });
const html = (status) => new Response('<html>', { status, headers: { 'content-type': 'text/html' } });

test('icons are downloaded once, cached, and the cache is used if the wiki is down', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const cacheDir = path.join(dir, 'cache');
  const outDir = path.join(dir, 'out');
  const calls = [];
  const wiki = async (url) => {
    calls.push(url);
    if (url === iconUrls(851).thumb) return png();
    if (url === iconUrls(730).thumb) return html(400); // small image: no thumbnail
    if (url === iconUrls(730).original) return png();
    return html(404); // 1000: no such file
  };
  try {
    const first = await buildIcons([730, 851, 1000], { cacheDir, outDir, userAgent: 'test', fetchImpl: wiki });
    assert.deepEqual(first.icons, [730, 851]);
    assert.deepEqual(first.warnings, ['La wiki no tiene el icono de 1 gatos (1000).']);
    assert.equal(first.wikiError, null, 'a file the wiki does not have is not a failure');
    assert.ok(fs.existsSync(path.join(outDir, '851.png')) && fs.existsSync(path.join(outDir, '730.png')));
    const before = calls.length;
    const down = async () => {
      throw new Error('sin conexión');
    };
    const second = await buildIcons([730, 851, 1000], { cacheDir, outDir, userAgent: 'test', fetchImpl: down });
    assert.deepEqual(second.icons, [730, 851], 'cached icons still published');
    assert.match(second.warnings.join(), /se publican los que ya había/);
    assert.equal(second.wikiError, 'sin conexión');
    assert.equal(calls.length, before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('icons already published are reused, and the wiki is only asked for the rest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const cacheDir = path.join(dir, 'cache');
  const outDir = path.join(dir, 'out');
  const site = 'https://owner.github.io/repo/';
  const asked = [];
  const fetchImpl = async (url) => {
    url = String(url);
    if (url === `${site}data/gacha.json`) return Response.json({ icons: [851, 852, 853] });
    if (url === `${site}icons/851.png` || url === `${site}icons/852.png`) return png();
    if (url === `${site}icons/853.png`) return html(404);
    asked.push(url);
    return html(403); // the wiki refuses the build server
  };
  try {
    const r = await buildIcons([851, 852, 853, 854], { cacheDir, outDir, userAgent: 'test', siteUrl: site, fetchImpl });
    assert.deepEqual(r.icons, [851, 852], 'published icons kept even though the wiki refuses');
    assert.match(r.wikiError, /^HTTP 403/);
    assert.match(r.warnings.join(), /1 iconos de la web publicada no se pudieron copiar/);
    assert.deepEqual(asked, [iconUrls(853).thumb], 'a refusing wiki is asked once, not once per icon');
    assert.ok(fs.existsSync(path.join(cacheDir, '852.png')), 'published icons go to the cache too');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing icons need the owner if the wiki failed, or if their banner has started', () => {
  const data = {
    events: [
      { id: 'now', gacha: 100, start: '2026-10-01' },
      { id: 'later', gacha: 101, start: '2026-10-20' },
    ],
    gacha: { 100: [10, 11], 101: [11, 12] },
    cats: { 10: { names: ['Ten'] }, 11: { names: ['Eleven'] }, 12: { names: ['Twelve'] } },
    icons: [10],
  };
  assert.deepEqual(missingIcons(data, '2026-10-09', null).map((c) => c.id), [11], 'an upcoming cat may get its icon later');
  assert.match(missingIcons(data, '2026-10-09', null)[0].reason, /la wiki no tiene su icono/);
  const failed = missingIcons(data, '2026-10-09', 'HTTP 403');
  assert.deepEqual(failed.map((c) => c.id), [11, 12]);
  assert.match(failed[0].reason, /la wiki no respondió \(HTTP 403\)/);
  assert.deepEqual(missingIcons({ ...data, icons: [10, 11, 12] }, '2026-10-09', 'HTTP 403'), []);
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

  const iconsMissing = Array.from({ length: 12 }, (_, i) => ({ id: 900 + i, name: `Cat ${i}`, reason: 'la wiki no respondió (HTTP 403)' }));
  const icons = findProblems(ok, { ok: true, warnings: [], iconsMissing }, { result: 'ok', lastOk: now.toISOString(), differences: [] }, now).join();
  assert.match(icons, /Faltan iconos\n12 gatos.*Cat 0 \(900\): la wiki no respondió \(HTTP 403\).*y 2 más/s);
  assert.doesNotMatch(icons, /Cat 10 /, 'long lists are cut');

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
