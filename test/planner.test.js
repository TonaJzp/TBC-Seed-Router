import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, parseRequest, parseSeedInput, resolveTargets, withAliases, catalogOf, selectEvents, UserError } from '../public/core/planner.js';
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
  assert.deepEqual(parseSeedInput('https://bc.godfat.org/?seed=1234567&last=150&event=x'), { seed: 1234567, last: 150 });
  assert.deepEqual(parseSeedInput(' 1234567 '), { seed: 1234567, last: 0 });
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

test('plan() reports invalid input as UserError, never as a crash', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const ok = { url: '1', targets: ['851'], from: '2026-10-16', to: '2026-10-20' };
  assert.throws(() => plan({ ...ok, url: '' }, gachaData, { now }), UserError);
  assert.throws(() => plan({ ...ok, targets: [] }, gachaData, { now }), UserError);
  assert.throws(() => plan({ ...ok, from: '2030-01-01', to: '2030-01-02' }, gachaData, { now }), UserError);
});
