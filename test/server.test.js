'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequest, resolveTargets, withAliases, userToday } = require('../server');

// A fixed "now" so date rules don't depend on when the tests run.
const NOW = new Date(2026, 9, 1, 12, 0); // 1 Oct 2026, local time
const base = { url: 'https://bc.godfat.org/?seed=1', targets: 'A', from: '2026-10-01', to: '2026-10-10', today: '2026-10-01' };
const parse = (body) => parseRequest(body, NOW);

test('parseRequest accepts any number of targets, comma or newline separated, deduplicated', () => {
  const many = Array.from({ length: 25 }, (_, i) => `Cat ${i}`).join(',\n');
  const r = parse({ ...base, targets: `${many}, Cat 0` });
  assert.equal(r.targets.length, 25);
});

test('parseRequest accepts the picker array of names', () => {
  const r = parse({ ...base, targets: ['Fuma Kotaro', ' Lasvoss ', 'Fuma Kotaro', ''] });
  assert.deepEqual(r.targets, ['Fuma Kotaro', 'Lasvoss']);
});

test('targets picked from the catalogue resolve by exact name first, then by another form', () => {
  const events = [{ names: { 1: 'Balaluga', 2: 'Betrothed Balaluga', 3: 'Sanada Yukimura' } }];
  const catalog = [
    { name: 'Balaluga', aliases: [] },
    { name: 'Betrothed Balaluga', aliases: ['Balaluga'] }, // alias shared with another cat
    { name: 'Wargod Yukimura', aliases: ['Sanada Yukimura', 'Immortal Yukimura'] }, // godfat uses another form
  ];
  const queries = withAliases(['Balaluga', 'Betrothed Balaluga', 'Wargod Yukimura'], catalog);
  const r = resolveTargets(queries, events, new Set([1, 2, 3]));
  assert.deepEqual(r.resolved.map((t) => t.names), [['Balaluga'], ['Betrothed Balaluga'], ['Sanada Yukimura']]);
});

test('the catalogue godfat id wins over names', () => {
  const events = [{ names: { 10: 'Kanna', 11: 'Adventurer Kanna' } }];
  const queries = [{ name: 'Adventurer Kanna', godfatId: 11, aliases: ['Kanna'] }];
  const r = resolveTargets(queries, events, new Set([10, 11]));
  assert.deepEqual(r.resolved[0].names, ['Adventurer Kanna']);
});

test('parseRequest defaults to 200 rolls and enforces the bounds', () => {
  assert.equal(parse(base).rolls, 200);
  assert.equal(parse({ ...base, rolls: 650 }).rolls, 650);
  assert.throws(() => parse({ ...base, rolls: 5 }), /Tiros a analizar/);
  assert.throws(() => parse({ ...base, rolls: 5000 }), /Tiros a analizar/);
});

test('parseRequest validates dates and inventory', () => {
  assert.throws(() => parse({ ...base, from: '2026-10-11' }), /posterior/);
  assert.throws(() => parse({ ...base, tickets: -1 }), /Rare Tickets/);
  assert.throws(() => parse({ ...base, targets: ' , ' }), /al menos un gato/);
});

test('resolveTargets matches by exact name, partial name or id', () => {
  const events = [{ names: { 1: 'Fuma Kotaro', 2: 'Kotatsu Cat', 3: 'Lasvoss', 4: 'Old Cat' } }];
  const obtainable = new Set([1, 2, 3]);
  const r = resolveTargets(['fuma kotaro', 'kota', '3', 'Old Cat', 'Nope'], events, obtainable);
  assert.deepEqual(r.resolved.map((t) => [t.query, t.names]), [
    ['fuma kotaro', ['Fuma Kotaro']],
    ['kota', ['Fuma Kotaro', 'Kotatsu Cat']],
    ['3', ['Lasvoss']],
  ]);
  assert.deepEqual(r.unavailable.map(({ query, reason }) => ({ query, reason })), [
    { query: 'Old Cat', reason: 'notInRolls' },
    { query: 'Nope', reason: 'unknownName' },
  ]);
  assert.deepEqual(r.unavailable[0].ids, [4], 'keeps the ids to look for it further ahead');
});

test('the start date can never be in the past (user time zone, within a day of this machine)', () => {
  assert.throws(() => parse({ ...base, from: '2026-06-02', to: '2026-08-20' }), /no puede ser anterior a hoy \(01\/10\/2026\)/);
  assert.throws(() => parse({ ...base, from: '2026-09-30' }), /anterior a hoy/);
  assert.equal(parse({ ...base, from: '2026-10-01' }).from, '2026-10-01');
  // The browser's date wins when it is a day ahead (another time zone)...
  assert.equal(userToday('2026-10-02', NOW), '2026-10-02');
  assert.throws(() => parse({ ...base, today: '2026-10-02', from: '2026-10-01' }), /anterior a hoy/);
  // ...but a bogus client date falls back to this machine's date.
  assert.equal(userToday('2020-01-01', NOW), '2026-10-01');
  assert.equal(userToday(undefined, NOW), '2026-10-01');
});

test('two cats with the same name are told apart by their catalogue key', () => {
  const events = [{ names: { 502: 'Cat Bros' } }];
  const catalog = [
    { key: 'Cat Bros (Special Cat)', name: 'Cat Bros', rarity: 'special', gacha: false, godfatId: 109, aliases: [] },
    { key: 'Cat Bros (Rare Cat)', name: 'Cat Bros', rarity: 'rare', gacha: true, godfatId: 502, aliases: [] },
  ];
  const byKey = resolveTargets(withAliases(['Cat Bros (Rare Cat)', 'Cat Bros (Special Cat)'], catalog), events, new Set([502]));
  assert.deepEqual(byKey.resolved.map((t) => t.names), [['Cat Bros']]);
  assert.deepEqual(byKey.unavailable.map((u) => u.reason), ['notGacha']);
  // Typed by name only, the gacha one is assumed.
  const byName = resolveTargets(withAliases(['Cat Bros'], catalog), events, new Set([502]));
  assert.equal(byName.resolved.length, 1);
});

test('cats outside the gacha are reported, never confused with similarly named ones', () => {
  const events = [{ names: { 1: 'Tin Cat', 2: 'Pirate Cat' } }];
  const catalog = [
    { name: 'Cat', rarity: 'normal', gacha: false, godfatId: 1, aliases: [] },
    { name: 'Tin Cat', rarity: 'rare', gacha: true, godfatId: 1, aliases: [] },
    { name: 'Kotaro', rarity: 'uber', gacha: true, godfatId: 99, aliases: [] },
  ];
  const r = resolveTargets(withAliases(['Cat', 'Kotaro', 'Tin Cat'], catalog), events, new Set([1, 2]));
  assert.deepEqual(r.resolved.map((t) => t.names), [['Tin Cat']]);
  assert.deepEqual(r.unavailable.map((u) => [u.query, u.reason]), [['Cat', 'notGacha'], ['Kotaro', 'notInBanners']]);
});
