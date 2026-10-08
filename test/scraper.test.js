'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseSeedUrl, extractTable, organize, DOUBLE_LEGEND_EVENT } = require('../src/scraper');

test('parseSeedUrl keeps seed and last (tables are always read in English)', () => {
  assert.deepEqual(parseSeedUrl('https://bc.godfat.org/?seed=1234567&last=150&lang=jp'), { seed: 1234567, last: 150 });
  assert.deepEqual(parseSeedUrl('https://bc.godfat.org/?seed=42'), { seed: 42, last: 0 });
});

test('parseSeedUrl rejects other hosts and missing seeds', () => {
  assert.throws(() => parseSeedUrl('https://evil.example/?seed=1'), /bc\.godfat\.org/);
  assert.throws(() => parseSeedUrl('https://bc.godfat.org/?event=x'), /seed/);
  assert.throws(() => parseSeedUrl('no es una url'), /no es válida/);
});

test('double legend events are recognised by name', () => {
  assert.ok(DOUBLE_LEGEND_EVENT.test('ROYAL FEST! Legend Rare drop rates up'));
  assert.ok(DOUBLE_LEGEND_EVENT.test('Double the chance of Legend Rares!'));
  assert.ok(!DOUBLE_LEGEND_EVENT.test('Get a Guaranteed Uber or Legend Rare from the Legend Capsules!'));
  assert.ok(!DOUBLE_LEGEND_EVENT.test('Fuma Kotaro added! Masters of battle join the Cat cause!'));
});

test('extractTable reads results, guaranteed and alt cells and ignores score cells', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'godfat-table.html'), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const table = await page.evaluate(extractTable);
    const data = organize({ id: 'x', name: 'x', start: '', end: '' }, [{ offset: 0, table }]);

    assert.equal(Object.keys(data.raw).length, 80, '40 rows x 2 tracks');
    assert.ok(data.hasGuaranteed);
    assert.match(data.guaranteed['1A'].dest, /^11B$/, 'guaranteed from 1A lands on 11B');
    assert.match(data.guaranteed['1B'].dest, /^12A$/, 'guaranteed from 1B lands on 12A ("<-" form)');
    for (const [key, alt] of Object.entries(data.alt)) assert.ok(alt.dest, `${key} alt has a destination`);
    assert.ok(data.pools.rare.length > 0 && data.pools.uber.length > 0);
    for (const c of Object.values(data.raw)) assert.ok(c.name && Number.isInteger(c.id));
  } finally {
    await browser.close();
  }
});

test('organize shifts positions of later godfat pages', () => {
  const cell = { n: 1, track: 'A', alt: false, guaranteed: false, id: 1, name: 'c', dest: null, colors: [] };
  const alt = { ...cell, alt: true, dest: '2B' };
  const table = { cells: [cell, alt], pools: { rare: [{ id: 1, name: 'c' }] } };
  const data = organize({ id: 'x' }, [{ offset: 0, table }, { offset: 300, table }]);
  assert.ok(data.raw['1A'] && data.raw['301A']);
  assert.equal(data.alt['301A'].dest, '302B');
});

test('network and browser failures become explanations for the user', () => {
  const { friendlyError } = require('../src/scraper');
  const say = (m) => friendlyError(new Error(m)).message;
  assert.match(say('page.goto: net::ERR_INTERNET_DISCONNECTED at https://bc.godfat.org/'), /No se pudo conectar con bc\.godfat\.org/);
  assert.match(say('page.goto: net::ERR_PROXY_CONNECTION_FAILED'), /No se pudo conectar/);
  assert.match(say('page.goto: Timeout 90000ms exceeded.'), /tardó demasiado en responder/);
  assert.match(say("browserType.launch: Executable doesn't exist at C:/x"), /npx playwright install chromium/);
});
