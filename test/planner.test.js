import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, parseRequest, parseSeedInput, resolveTargets, withAliases, catalogOf, selectEvents, UserError } from '../public/core/planner.js';
import { buildEvents } from '../public/core/gacha.js';
import { Simulator } from '../public/core/simulator.js';
import { buildSequence, raritySeed } from '../public/core/rng.js';
import { gachaData, fixture } from './helpers.js';

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

test('the start date can never be in the past (the visitor date)', () => {
  assert.throws(() => parse({ ...base, from: '2026-06-02', to: '2026-08-20' }), /no puede ser anterior a hoy \(01\/10\/2026\)/);
  assert.throws(() => parse({ ...base, from: '2026-09-30' }), /anterior a hoy/);
  assert.equal(parse({ ...base, from: '2026-10-01' }).from, '2026-10-01');
  assert.equal(parse(base).today, '2026-10-01');
});

test('two cats with the same name are told apart by their catalogue key', () => {
  const events = [{ names: { 502: 'Cat Bros' } }];
  const catalog = [
    { key: '109', id: 109, name: 'Cat Bros', rarity: 'special', gacha: false, aliases: [] },
    { key: '502', id: 502, name: 'Cat Bros', rarity: 'rare', gacha: true, aliases: [] },
  ];
  const byKey = resolveTargets(withAliases(['502', '109'], catalog), events, new Set([502]));
  assert.deepEqual(byKey.resolved.map((t) => t.names), [['Cat Bros']]);
  assert.deepEqual(byKey.unavailable.map((u) => u.reason), ['notGacha']);
  // Typed by name only, the gacha one is assumed.
  const byName = resolveTargets(withAliases(['Cat Bros'], catalog), events, new Set([502]));
  assert.equal(byName.resolved.length, 1);
});

test('cats outside the gacha are reported, never confused with similarly named ones', () => {
  const events = [{ names: { 1: 'Tin Cat', 2: 'Pirate Cat' } }];
  const catalog = [
    { key: '7', id: 7, name: 'Cat', rarity: 'normal', gacha: false, aliases: [] },
    { key: '1', id: 1, name: 'Tin Cat', rarity: 'rare', gacha: true, aliases: [] },
    { key: '99', id: 99, name: 'Kotaro', rarity: 'uber', gacha: true, aliases: [] },
  ];
  const r = resolveTargets(withAliases(['Cat', 'Kotaro', 'Tin Cat'], catalog), events, new Set([1, 2]));
  assert.deepEqual(r.resolved.map((t) => t.names), [['Tin Cat']]);
  assert.deepEqual(r.unavailable.map((u) => [u.query, u.reason]), [['Cat', 'notGacha'], ['Kotaro', 'notInBanners']]);
});

// --- Seed, banners and the whole analysis ---------------------------------------

test('the seed comes from a godfat URL (with the last cat) or a plain number', () => {
  assert.deepEqual(parseSeedInput('https://bc.godfat.org/?seed=1234567&last=150&event=x'), { seed: 1234567, last: 150, pos: null });
  assert.deepEqual(parseSeedInput(' 1234567 '), { seed: 1234567, last: 0, pos: null });
  assert.throws(() => parseSeedInput('https://example.org/?seed=1'), /bc\.godfat\.org/);
  assert.throws(() => parseSeedInput('https://bc.godfat.org/?event=x'), /falta el número de semilla/);
  assert.throws(() => parseSeedInput('4294967296'), /no es válido/);
  assert.throws(() => parseSeedInput('0'), /no es válido/);
  assert.throws(() => parseSeedInput('hola'), UserError);
});

test('banners of the dates are selected; Platinum/Legend ones are reported, not planned', () => {
  const { selected, skipped, upcoming } = selectEvents(gachaData, { from: '2026-10-16', to: '2026-10-20', today: '2026-10-08' });
  assert.ok(selected.length >= 5);
  assert.ok(selected.every((e) => !e.ticket && e.end >= '2026-10-16' && e.start <= '2026-10-20'));
  // The old Platinum/Legend banners end on the 16th, inside the dates too.
  assert.deepEqual(skipped.map((s) => s.id).sort(), ['2026-07-24_1063', '2026-07-24_1064', '2026-10-16_1071', '2026-10-16_1072']);
  assert.ok(upcoming.every((e) => e.end >= '2026-10-08'));
  // The Platinum banner that the next one replaces ends that day, as on godfat.
  assert.equal(gachaData.events.find((e) => e.id === '2026-07-24_1063').end, '2026-10-16');
});

test('no plannable banner in the dates gives the next banners to try', () => {
  assert.throws(
    () => selectEvents(gachaData, { from: '2030-01-01', to: '2030-01-02', today: '2026-10-08' }),
    /no hay ningún banner que se pueda planificar.*Todavía no se han anunciado más banners/
  );
});

test('the catalogue lists every cat once, gacha cats flagged, other forms as aliases', () => {
  const catalog = catalogOf(gachaData);
  assert.equal(new Set(catalog.map((c) => c.key)).size, catalog.length);
  const fuma = catalog.find((c) => c.name === 'Fuma Kotaro');
  assert.equal(fuma.id, 851);
  assert.equal(fuma.rarity, 'uber');
  assert.equal(fuma.gacha, true);
  assert.ok(fuma.aliases.length >= 1, 'other forms are searchable');
  assert.equal(catalog.find((c) => c.id === 1).gacha, false, 'the basic Cat is not a gacha cat');
});

test('plan() runs the whole analysis in the browser from the banner data', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const body = {
    url: `https://bc.godfat.org/?seed=${fixture.seed}`,
    targets: ['851', '1', 'Gato Inventado'],
    from: '2026-10-16',
    to: '2026-10-20',
    rolls: 200,
    food: 30000,
    tickets: 5,
    avoidLegend: true,
    avoidLegendFest: true,
  };
  const r = plan(body, gachaData, { now });
  assert.equal(r.seed, fixture.seed);
  assert.ok(r.events.length >= 5);
  assert.ok(r.events.every((e) => ['standard', 'guaranteed', 'stepup'].includes(e.kind)));
  assert.deepEqual(r.targets.map((t) => t.names), [['Fuma Kotaro']]);
  assert.deepEqual(r.unplanned, ['Cat', 'Gato Inventado']);
  assert.ok(r.routes.some((route) => route.recommended && route.found));
  assert.deepEqual(r.diagnostics.map((d) => d.target).slice(0, 2), ['Cat', 'Gato Inventado']);
  // Metal Maiden's raised legend rate turns lilac cells into legendaries, but
  // its last run ended on the 16th at 11:00: at 12:00 it no longer counts.
  assert.deepEqual(r.protection.doubleLegendEvents, []);
  assert.ok(r.skipped.some((e) => e.id === '2026-10-09_1077' && e.reason === 'terminó hoy a las 11:00'));
  // That morning it is still on (and the run that ended on the 9th is not).
  const morning = plan(body, gachaData, { now: new Date(2026, 9, 16, 8, 0) });
  assert.deepEqual(morning.protection.doubleLegendEvents.map((e) => e.id), ['2026-10-09_1077']);
  assert.ok(morning.events.some((e) => e.id === '2026-10-09_1077'));
});

test('plan() tells each phase as it starts, and the result does not depend on listening', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const body = { url: `https://bc.godfat.org/?seed=${fixture.seed}`, targets: ['851'], from: '2026-10-16', to: '2026-10-20', rolls: 200, food: 30000, tickets: 5 };
  const phases = [];
  const heard = plan(body, gachaData, { now, onProgress: (p) => phases.push(p) });
  assert.deepEqual(phases, [
    { phase: 'prepare' },
    { phase: 'route', index: 1, total: 3, label: 'Menor coste total' },
    { phase: 'route', index: 2, total: 3, label: heard.routes.find((r) => r.key === 'saveFood').label },
    { phase: 'route', index: 3, total: 3, label: heard.routes.find((r) => r.key === 'saveTickets').label },
  ]);
  const strip = (r) => ({ ...r, routes: r.routes.map(({ ms, ...route }) => route) }); // timings differ
  assert.deepEqual(strip(heard), strip(plan(body, gachaData, { now })));

  // Too few rolls for every cat: the diagnostics run last, and say so.
  const short = [];
  plan({ ...body, targets: ['851', '34', '35', '36', '37'], rolls: 20 }, gachaData, { now, onProgress: (p) => short.push(p.phase) });
  assert.deepEqual(short, ['prepare', 'route', 'route', 'route', 'diagnose']);
});

test('plan() reports invalid input as UserError, never as a crash', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const ok = { url: '1', targets: ['851'], from: '2026-10-16', to: '2026-10-20' };
  assert.throws(() => plan({ ...ok, url: '' }, gachaData, { now }), UserError);
  assert.throws(() => plan({ ...ok, targets: [] }, gachaData, { now }), UserError);
  assert.throws(() => plan({ ...ok, from: '2030-01-01', to: '2030-01-02' }, gachaData, { now }), UserError);
});

test('each input error names the form field to fix, so the page can take you there', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const ok = { url: '1', targets: ['851'], from: '2026-10-16', to: '2026-10-20', rolls: '200', tickets: '0', food: '0' };
  const fieldOf = (body) => {
    try {
      parseRequest(body, now);
    } catch (err) {
      assert.ok(err instanceof UserError);
      return err.field;
    }
    return null;
  };
  assert.equal(fieldOf(ok), null);
  assert.equal(fieldOf({ ...ok, url: '' }), 'url');
  assert.equal(fieldOf({ ...ok, url: 'https://example.com/?seed=1' }), 'url');
  assert.equal(fieldOf({ ...ok, url: 'https://bc.godfat.org/' }), 'url');
  assert.equal(fieldOf({ ...ok, url: '99999999999' }), 'url');
  assert.equal(fieldOf({ ...ok, targets: [] }), 'targets');
  assert.equal(fieldOf({ ...ok, from: '' }), 'from');
  assert.equal(fieldOf({ ...ok, to: '' }), 'to');
  assert.equal(fieldOf({ ...ok, from: '2026-10-21' }), 'to');
  assert.equal(fieldOf({ ...ok, from: '2026-10-15' }), 'from');
  assert.equal(fieldOf({ ...ok, rolls: '5000' }), 'rolls');
  assert.equal(fieldOf({ ...ok, tickets: '-1' }), 'tickets');
  assert.equal(fieldOf({ ...ok, food: '1.5' }), 'food');
});

// --- Where the plan starts: godfat's `pos`, other versions --------------------

test('the URL may mark the next roll with pos (godfat), with R when it re-rolls a duplicate', () => {
  const at = (query) => parseSeedInput(`https://bc.godfat.org/?seed=1234567${query}`);
  assert.deepEqual(at('&pos=12B').pos, { n: 12, track: 'B', rerolled: false, event: null });
  assert.deepEqual(at('&pos=12BR&event=2026-10-16_1068').pos, { n: 12, track: 'B', rerolled: true, event: '2026-10-16_1068' });
  assert.deepEqual(at('&pos=7').pos, { n: 7, track: 'A', rerolled: false, event: null }, 'the track defaults to A, as on godfat');
  // At 1A the last cat of the URL is what decides a duplicate.
  assert.deepEqual(at('&last=150&pos=1A'), { seed: 1234567, last: 150, pos: null });
  for (const bad of ['zz', '0A', '12C', '99999A']) assert.throws(() => at(`&pos=${bad}`), /no es una casilla válida/);
});

test('URLs of other versions of the game are refused; a URL without https:// is accepted', () => {
  assert.throws(() => parseSeedInput('https://bc.godfat.org/?seed=1&lang=jp'), /versión japonesa/);
  assert.throws(() => parseSeedInput('https://bc.godfat.org/?seed=1&lang=tw'), /versión taiwanesa/);
  assert.throws(() => parseSeedInput('https://bc.godfat.org/?seed=1&lang=kr'), /versión coreana/);
  assert.equal(parseSeedInput('https://bc.godfat.org/?seed=1&lang=en').seed, 1);
  assert.equal(parseSeedInput('bc.godfat.org/?seed=77&last=3').last, 3);
  assert.equal(parseSeedInput('http://bc.godfat.org/?seed=77').seed, 77);
});

const START_NOW = new Date(2026, 9, 16, 12, 0);
function anyRareOf(eventId) {
  const ev = gachaData.events.find((e) => e.id === eventId);
  return String(gachaData.gacha[ev.gacha].find((id) => gachaData.cats[id].rarity === 2));
}
const startBody = (url, extra = {}) => ({
  url, targets: [anyRareOf('2026-10-16_1068')], from: '2026-10-16', to: '2026-10-20', rolls: '60', tickets: '0', food: '100000', ...extra,
});
/** A cell from row `from` on where `eventId` gives a rare (`rare`) or not, for the fixture seed. */
function cellOf(eventId, from, rare) {
  const [ev] = buildEvents(gachaData, [gachaData.events.find((e) => e.id === eventId)], fixture.seed, from + 40);
  for (let n = from; n < from + 40; n++) {
    for (const track of ['A', 'B']) {
      const c = ev.raw[`${n}${track}`];
      if (c && ev.pools.rare.includes(c.id) === rare) return { key: `${n}${track}`, id: c.id };
    }
  }
  throw new Error('no such cell in the fixture');
}

test('with pos the routes start there, and the rolls to analyse count from it', () => {
  const url = `https://bc.godfat.org/?seed=${fixture.seed}&pos=40B`;
  const result = plan(startBody(url), gachaData, { now: START_NOW });
  assert.equal(result.start, '40B');
  assert.equal(result.last, 0, 'godfat leaves the last cat out of a pos URL');
  const found = result.routes.filter((r) => r.found);
  assert.ok(found.length > 0);
  for (const r of found) {
    assert.equal(r.steps[0].from, '40B');
    r.steps.slice(1).forEach((s, i) => assert.equal(s.from, r.steps[i].to, 'steps follow each other'));
  }
  // 60 rolls from row 40: rows 40 to 99, nothing behind the start.
  assert.ok(result.legendCells.every((c) => parseInt(c.key, 10) >= 40 && parseInt(c.key, 10) <= 99));
  assert.equal(plan(startBody(`https://bc.godfat.org/?seed=${fixture.seed}`), gachaData, { now: START_NOW }).start, null);
});

test('with pos R the last cat is the rare of that cell in the banner of the URL', () => {
  const eventId = '2026-10-16_1068';
  const rare = cellOf(eventId, 30, true);
  const url = `https://bc.godfat.org/?seed=${fixture.seed}&pos=${rare.key}R&event=${eventId}`;
  const result = plan(startBody(url), gachaData, { now: START_NOW });
  assert.equal(result.start, rare.key);
  assert.equal(result.last, rare.id);
  // Rolled in that banner, the first roll re-rolls the duplicate.
  const [table] = buildEvents(gachaData, [gachaData.events.find((e) => e.id === eventId)], fixture.seed, 80);
  const sim = new Simulator(fixture.seed, [table], 80);
  const { n, track } = { n: parseInt(rare.key, 10), track: rare.key.at(-1) };
  assert.equal(sim.single(table, n, track, result.last).rerolled, true);

  // Without a known banner, or on a cell that is not a rare, the last cat can't be known.
  const fails = (u) =>
    assert.throws(() => plan(startBody(u), gachaData, { now: START_NOW }), (err) => err instanceof UserError && err.field === 'url');
  fails(`https://bc.godfat.org/?seed=${fixture.seed}&pos=${rare.key}R`);
  fails(`https://bc.godfat.org/?seed=${fixture.seed}&pos=${rare.key}R&event=2019-01-01_1`);
  fails(`https://bc.godfat.org/?seed=${fixture.seed}&pos=${cellOf(eventId, 30, false).key}R&event=${eventId}`);
});

test('a pos URL warns that the last cat is unknown only where a rare could duplicate it', () => {
  const ids = ['2026-10-16_1068', '2026-10-16_979', '2026-10-16_986'];
  const tables = buildEvents(gachaData, ids.map((id) => gachaData.events.find((e) => e.id === id)), fixture.seed, 120);
  const rows = Array.from({ length: 100 }, (_, i) => 20 + i).flatMap((n) => [`${n}A`, `${n}B`]);
  const anyRare = (key) => tables.some((ev) => ev.pools.rare.includes(ev.raw[key]?.id));
  const withRare = rows.find(anyRare);
  const without = rows.find((key) => !anyRare(key));
  assert.ok(withRare && without, 'the fixture has both kinds of cell');
  const to = '2026-10-17'; // only those three banners
  const noticesAt = (key) =>
    plan(startBody(`https://bc.godfat.org/?seed=${fixture.seed}&pos=${key}`, { to }), gachaData, { now: START_NOW }).notices;
  assert.equal(noticesAt(withRare).length, 1);
  assert.match(noticesAt(withRare)[0], /no dice cuál fue tu último gato/);
  assert.deepEqual(noticesAt(without), []);
});

// --- Lilac cells of banners with an even higher legend rate -------------------

/** A seed with a cell scoring `lo`..`hi` in its first 30 rows: { seed, key }. */
function seedWithScore(lo, hi) {
  for (let seed = 1; ; seed++) {
    const seq = buildSequence(seed, 32);
    for (let n = 1; n <= 30; n++) {
      for (const track of ['A', 'B']) {
        const score = raritySeed(seq, n, track) % 10000;
        if (score >= lo && score < hi) return { seed, key: `${n}${track}` };
      }
    }
  }
}

test('a banner with 0.7 % legend makes its cells from 9930 lilac, though godfat paints them uber', () => {
  const { seed, key } = seedWithScore(9930, 9940);
  // 2026-10-09_1077 (Metal Maiden, 120M DL) gives Legendaries from score 9930.
  const now = new Date(2026, 9, 10, 12, 0);
  const body = {
    url: String(seed), targets: [anyRareOf('2026-10-09_1077')], from: '2026-10-10', to: '2026-10-12',
    rolls: '40', tickets: '0', food: '100000', avoidLegendFest: true,
  };
  const result = plan(body, gachaData, { now });
  assert.equal(result.protection.legendFestFrom, 9930);
  assert.equal(result.protection.legendFest, true);
  const cell = result.legendCells.find((c) => c.key === key);
  assert.ok(cell, `${key} is listed as a legend cell`);
  assert.equal(cell.color, 'lila');
  assert.ok(cell.legends.some((l) => l.eventId === '2026-10-09_1077'), 'that banner gives a Legendary there');

  // Once that banner is over, 9940 is the limit again: the cell is a normal one.
  const later = plan(
    { ...body, targets: [anyRareOf('2026-10-16_1068')], from: '2026-10-17', to: '2026-10-20' },
    gachaData,
    { now: new Date(2026, 9, 17, 12, 0) }
  );
  assert.equal(later.protection.legendFestFrom, 9940);
  assert.ok(!later.legendCells.some((c) => c.key === key));
});
