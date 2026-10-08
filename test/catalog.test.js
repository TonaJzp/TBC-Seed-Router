'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchCatalog, parseTitle } = require('../src/catalog');

// Minimal fake of the MediaWiki API, including split continuation batches.
function fakeWiki() {
  const pages1 = {
    1: { pageid: 1, title: 'Fuma Kotaro (Uber Rare Cat)', redirects: [{ title: 'Fuma Kotaro Ninja (Uber Rare Cat)' }] },
    2: { pageid: 2, title: 'Cat (Normal Cat)' },
    3: { pageid: 3, title: 'Tin Cat (Rare Cat)', thumbnail: { source: 'https://img/tin.png' } },
  };
  const pages2 = {
    1: { pageid: 1, title: 'Fuma Kotaro (Uber Rare Cat)', thumbnail: { source: 'https://img/fuma.png' } },
    4: { pageid: 4, title: 'Japan Only (Super Rare Cat)' },
    5: { pageid: 5, title: 'Musashi Miyamoto (Legend Rare Cat)', redirects: [{ title: 'Musashi Miyamoto (Legend Rare Cat)' }] },
  };
  return async (url) => {
    const p = new URL(url).searchParams;
    let body;
    if (p.get('list') === 'categorymembers') {
      body = { query: { categorymembers: [{ title: 'Japan Only (Super Rare Cat)' }] } };
    } else if (!p.get('gcmcontinue')) {
      body = { continue: { gcmcontinue: 'next', continue: 'gcmcontinue||' }, query: { pages: pages1 } };
    } else {
      body = { query: { pages: pages2 } };
    }
    return { ok: true, json: async () => body };
  };
}

test('parseTitle splits name and rarity', () => {
  assert.deepEqual(parseTitle('Fuma Kotaro (Uber Rare Cat)'), { name: 'Fuma Kotaro', rarity: 'Uber Rare' });
  assert.deepEqual(parseTitle('Mer-Cat (Rare Cat)'), { name: 'Mer-Cat', rarity: 'Rare' });
});

test('fetchCatalog merges continuation batches, keeps every rarity and drops JP exclusives', async () => {
  const realFetch = global.fetch;
  global.fetch = fakeWiki();
  try {
    const cats = await fetchCatalog();
    assert.deepEqual(cats.map((c) => c.name), ['Cat', 'Fuma Kotaro', 'Musashi Miyamoto', 'Tin Cat']);
    assert.deepEqual(cats.find((c) => c.name === 'Cat'), {
      key: 'Cat (Normal Cat)', name: 'Cat', rarity: 'normal', gacha: false, godfatId: null, aliases: [], image: null,
    });
    assert.equal(cats.find((c) => c.name === 'Fuma Kotaro').gacha, true);
    const fuma = cats.find((c) => c.name === 'Fuma Kotaro');
    assert.equal(fuma.rarity, 'uber');
    assert.equal(fuma.image, 'https://img/fuma.png', 'image arriving in a later batch is merged');
    assert.deepEqual(fuma.aliases, ['Fuma Kotaro Ninja']);
    assert.deepEqual(cats.find((c) => c.name === 'Musashi Miyamoto').aliases, [], 'self-redirect is not an alias');
    assert.equal(cats.find((c) => c.name === 'Tin Cat').rarity, 'rare');
  } finally {
    global.fetch = realFetch;
  }
});

test('the godfat id comes from the unit number in the icon file name', () => {
  const { godfatIdFromImage } = require('../src/catalog');
  assert.equal(godfatIdFromImage('https://static.wikitide.net/battlecatswiki/thumb/3/30/850_1.png/64px-850_1.png'), 851);
  assert.equal(godfatIdFromImage('https://static.wikitide.net/battlecatswiki/thumb/0/0e/244_1.png/64px-244_1.png'), 245);
  assert.equal(godfatIdFromImage('https://static.wikitide.net/battlecatswiki/thumb/1/10/M_000.png/64px-M_000.png'), null);
  assert.equal(godfatIdFromImage(null), null);
});
