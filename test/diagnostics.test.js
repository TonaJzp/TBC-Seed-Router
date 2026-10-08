'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, makeSim, loadEvents } = require('./helpers');
const { diagnose, explore } = require('../src/diagnostics');
const { optimizeRoutes, prepareContext } = require('../src/optimizer');
const { describeUnavailable } = require('../src/unavailable');
const { matchIds } = require('../server');

const META = { seed: 1234567, rolls: 200 };
const someUbers = (n) => {
  const names = new Set();
  for (const ev of makeSim().events) for (const id of ev.pools.uber) names.add(ev.names[id]);
  return [...names].slice(0, n);
};
// Replaces one cell with a made-up cat that appears nowhere else.
const fake = (ev, key, id, name) => {
  ev.raw[key] = { ...ev.raw[key], id, name };
  ev.names[id] = name;
};
const text = (item) => [item.headline, ...item.details, item.fix].join(' ');

test('protected cells never block the way: routes roll over them', () => {
  const targets = someUbers(3);
  const { ctx } = plan(targets, { inventory: { food: 1e5 }, protect: { avoidLegendFest: true } });
  ctx.sim.legendColors.set('2A', new Set(['legend_fest']));
  ctx.sim.legendColors.set('2B', new Set(['legend_fest']));
  const routes = optimizeRoutes(ctx);
  assert.ok(routes.every((r) => r.found && r.complete), 'lilac cells on 2A and 2B do not stop the plan');
  assert.deepEqual(diagnose(ctx, routes, META), []);
});

test('every route lists the legend cells it rolls on, protected or not, with the legendaries available there', () => {
  for (const protect of [{}, { avoidLegend: true, avoidLegendFest: true }]) {
    const { ctx } = plan(someUbers(2), { inventory: { food: 1e5 }, protect });
    ctx.doubleLegend = true; // lilac cells count as legend cells
    ctx.sim.legendColors.set('2A', new Set(['legend_fest']));
    const routes = optimizeRoutes(ctx);
    for (const r of routes) {
      const rolledOn2A = r.steps.some((s) => s.cats.some((c) => c.cell === '2A'));
      const flagged = r.legendCells.find((c) => c.key === '2A');
      assert.equal(!!flagged, rolledOn2A, `${r.label}: 2A flagged iff the route rolls on it`);
      if (flagged) {
        assert.equal(flagged.color, 'lila');
        assert.ok(Array.isArray(flagged.legends));
        assert.ok(flagged.got.name);
      }
    }
  }
});

test('a legendary target counts on its (protected) cell; banners without legendaries give no legend there', () => {
  const sim = makeSim();
  const cells = [...sim.legendColors.keys()];
  const withLegend = cells.map((k) => ({ k, legends: sim.legendsAt(parseInt(k, 10), k.at(-1)) })).find((c) => c.legends.length);
  assert.ok(withLegend, 'fixture has a purple cell that gives a legendary in some banner');
  for (const l of withLegend.legends) {
    const ev = sim.events.find((e) => e.id === l.eventId);
    assert.equal(ev.rarityOf.get(l.id), 'legendary');
  }
  const noLegend = sim.events.filter((e) => !withLegend.legends.some((l) => l.eventId === e.id));
  for (const ev of noLegend) assert.notEqual(ev.rarityOf.get(ev.raw[withLegend.k].id), 'legendary');

  const { ctx, routes } = plan([withLegend.legends[0].name], { inventory: { food: 1e6 }, protect: { avoidLegend: true } });
  assert.ok(routes[0].complete, 'the legendary itself is obtained on the protected cell');
  const cell = routes[0].legendCells.find((c) => c.key === withLegend.k);
  assert.equal(cell.got.rarity, 'legendary');
  assert.deepEqual(diagnose(ctx, routes, META), []);
});

// A made-up non-legendary cat placed on a purple cell of a banner that gives
// no legendary there (as an uber would be), and nowhere else.
function catOnPurpleCell() {
  const events = loadEvents();
  const sim = makeSim(loadEvents());
  const key = [...sim.legendColors.keys()].find((k) => sim.legendColors.get(k).has('legend'));
  // In this banner the purple cell now holds a normal (non-legendary) cat, as in
  // banners without legendaries.
  const ev = events[0];
  fake(ev, key, 990010, 'Gato Morado');
  return { events, key, name: 'Gato Morado' };
}

test('a cat that only appears on protected cells says so and names those cells', () => {
  const { events, key, name } = catOnPurpleCell();
  const free = plan([name], { events: JSON.parse(JSON.stringify(events)), inventory: { food: 1e6 } });
  assert.ok(free.routes[0].complete, 'without protection the route gets it on the purple cell');
  const { ctx, routes } = plan([name], { events, inventory: { food: 1e6 }, protect: { avoidLegend: true } });
  assert.ok(!routes[0].found || !routes[0].complete);
  const [item] = diagnose(ctx, routes, META);
  assert.match(item.headline, /Con la protección de casillas moradas, Gato Morado no se puede conseguir: solo sale en casillas protegidas/);
  assert.ok(text(item).includes(`${key} (morada)`));
  assert.match(text(item), /las rutas pueden pasar por ellas, pero un gato objetivo que salga ahí no cuenta/);
});

test('two targets that exclude each other are reported as a conflict, with where each one is', () => {
  const events = loadEvents();
  const early = events.find((e) => e.end === '2026-10-16');
  const late = events.find((e) => e.start === '2026-10-16');
  fake(early, '8A', 990001, 'Gato Temprano');
  fake(late, '5A', 990002, 'Gato Tardío');
  const { ctx, routes } = plan(['Gato Temprano', 'Gato Tardío'], { events, inventory: { food: 1e6 } });
  const items = diagnose(ctx, routes, META);
  assert.equal(items.length, 1);
  assert.match(items[0].headline, /no se puede conseguir en la misma ruta que/);
  assert.match(text(items[0]), /Gato Temprano solo sale en: .*8A/);
  assert.match(text(items[0]), /Gato Tardío solo sale en: .*5A/);
  assert.match(text(items[0]), /no puede volver a una fila anterior/);
});

test('cells only reachable through banners that start too late are blamed on the dates', () => {
  const events = loadEvents();
  const std = events.find((e) => !e.hasGuaranteed && e.end === '2026-10-16');
  fake(std, '13A', 990003, 'Gato Detrás');
  const { ctx, routes } = plan(['Gato Detrás'], { events, inventory: { food: 1e6 } });
  const [item] = diagnose(ctx, routes, META);
  assert.match(item.headline, /fechas de los banners impiden llegar/);
  assert.match(text(item), /En 11A sale siempre el mismo rare que en 10A/, 'explains the forced track switch');
});

test('a cell no sequence of rolls can reach is explained as such', () => {
  const events = loadEvents();
  fake(events[0], '1B', 990004, 'Gato Imposible'); // every plan starts at 1A
  const { ctx, routes } = plan(['Gato Imposible'], { events, inventory: { food: 1e6 } });
  const [item] = diagnose(ctx, routes, META);
  assert.match(item.headline, /Ninguna combinación de tiros llega/);
  assert.match(text(item), /1B/);
});

test('the explorer covers what the optimizer can reach and records protected cells', () => {
  const sim = makeSim();
  const ctx = prepareContext({
    sim, events: sim.events, targets: [], inventory: { lastCat: 0 }, protect: {}, from: '2026-10-16', to: '2026-10-20',
  });
  const all = explore(ctx, {});
  const blocked = explore(ctx, { avoidLegend: true });
  assert.ok(all.obtained.size > 50);
  assert.ok(all.maxRow > 150);
  assert.ok(blocked.blocked.size > 0, 'protected cells are recorded when they stop a roll');
});

test('nothing to explain when the recommended route gets every target', () => {
  const { ctx, routes } = plan(someUbers(2), { inventory: { food: 1e6 } });
  assert.ok(routes[0].complete);
  assert.deepEqual(diagnose(ctx, routes, META), []);
});

// --- Targets that can't enter the plan ---------------------------------------

const ENV = (overrides = {}) => ({
  seed: 1,
  input: { from: '2026-10-08', to: '2026-10-12', rolls: 200 },
  events: [],
  upcoming: [],
  matchIds,
  onProgress: () => {},
  scrapeEvents: async () => [],
  ...overrides,
});
const FUMA = { query: 'Fuma Kotaro', reason: 'notInBanners', match: { name: 'Fuma Kotaro', godfatId: 851, aliases: [], inCatalog: true } };

test('a cat outside the date range says which banner has it and how to change the dates', async () => {
  const later = { id: 'later', name: 'Banner Futuro', start: '2026-10-20', end: '2026-10-24', names: { 851: 'Fuma Kotaro' }, raw: {} };
  const [item] = await describeUnavailable([FUMA], ENV({ upcoming: [later], scrapeEvents: async () => [later] }));
  assert.match(item.headline, /no está en ningún banner entre el 08\/10\/2026 y el 12\/10\/2026/);
  assert.match(text(item), /Sí sale en: «Banner Futuro» \(20\/10–24\/10\)/);
  assert.match(item.fix, /Pon «Hasta» en el 20\/10\/2026 o después/);
});

test('a cat only in Platinum/Legend banners is told apart', async () => {
  const plat = { id: 'p', name: 'Get an Uber Rare Cat!! PLATINUM CAPSULES!', start: '2026-10-20', end: '2030-01-01', names: { 851: 'Fuma Kotaro' }, raw: {} };
  const [item] = await describeUnavailable([FUMA], ENV({ upcoming: [plat], scrapeEvents: async () => [plat] }));
  assert.match(text(item), /tickets Platinum\/Legend/);
});

test('a cat in no upcoming banner at all says so', async () => {
  const other = { id: 'o', name: 'Otro', start: '2026-10-20', end: '2026-10-24', names: { 1: 'Tin Cat' }, raw: {} };
  const [item] = await describeUnavailable([FUMA], ENV({ upcoming: [other], scrapeEvents: async () => [other] }));
  assert.match(text(item), /ningún banner Upcoming de godfat lo incluye/);
});

test('a cat beyond the analysed rolls says in which row it first appears', async () => {
  const ev = { id: 'e', name: 'Banner', start: '2026-10-08', end: '2026-10-12', names: { 7: 'Gato Lejano' }, raw: {} };
  const deep = { ...ev, raw: { '450A': { id: 7 }, '312B': { id: 7 } } };
  const [item] = await describeUnavailable(
    [{ query: 'Gato Lejano', reason: 'notInRolls', ids: [7] }],
    ENV({ events: [ev], scrapeEvents: async () => [deep] })
  );
  assert.match(item.headline, /aparece por primera vez en la fila 312/);
  assert.match(item.fix, /a 330 o más/);
  assert.match(item.links[0].url, /#N312B$/);
});

test('a non-gacha cat is explained', async () => {
  const [item] = await describeUnavailable([{ query: 'Cat', reason: 'notGacha', rarity: 'normal' }], ENV());
  assert.match(item.headline, /Cat no sale en el gacha/);
  assert.match(text(item), /Es un gato Normal/);
});
