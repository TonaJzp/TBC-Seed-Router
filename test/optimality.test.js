// Every route shown must be the cheapest one that exists for its criterion.
// An exhaustive search written apart from the optimizer settles it on small,
// reproducible cases: it visits every state the game allows, with no
// dominance, no shortcuts and nothing borrowed from optimizer.js, only the
// simulator (checked against bc.godfat.org every day) and the game's rules
// (02-DOCS game mechanics) written again here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gachaData, replayRoute } from './helpers.js';
import { selectEvents, resolveTargets, withAliases, catalogOf } from '../public/core/planner.js';
import { buildEvents } from '../public/core/gacha.js';
import { Simulator, parseKey } from '../public/core/simulator.js';
import { minuteOf } from '../public/core/time.js';
import { optimizeRoutes } from '../public/core/optimizer.js';
import { exhaustive, expected, CRITERIA } from './oracle.js';

const STEP_UPS = ['2026-10-13_1059', '2026-10-09_1043', '2026-10-18_1021'];
const data = structuredClone(gachaData);
for (const e of data.events) if (STEP_UPS.includes(e.id)) e.guaranteed = 15;
const catalog = catalogOf(data);

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

// Days a step-up banner of the cases closes (at 11:00).
const STEP_UP_LAST_DAYS = [11, 16, 20];

/**
 * A small search context: few rows, so that every state can be visited. Two
 * cases in three are tricky on purpose, where a search that merges states it
 * should keep apart goes wrong: many Rare Tickets with both discounts, more
 * banners, rows and targets («resources»), or the morning a step-up closes,
 * when waiting the 30 minutes for step 1 again runs past 11:00 («closing»).
 */
function makeCase(rand) {
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}`;
  const mode = pick(['plain', 'resources', 'closing']);
  const resources = mode === 'resources';
  const fromDay = mode === 'closing' ? pick(STEP_UP_LAST_DAYS) : int(5, 18);
  const from = day(fromDay);
  const to = day(Math.min(20, fromDay + (resources ? int(2, 4) : int(0, 4))));
  const now = mode === 'closing' ? new Date(2026, 9, fromDay, 10, int(20, 59)) : new Date(2026, 9, fromDay, int(0, 23), int(0, 59));
  const today = from;
  const rows = resources ? int(14, 18) : int(10, 18);
  const avoidLegend = rand() < 0.4;
  const { selected } = selectEvents(data, { from, to, today, now: minuteOf(now) });
  // With the protection on, a seed with a purple cell in these rows, and as a
  // target a cat that is not a legendary there: one from a banner without
  // legendaries, or the uber of a guaranteed draw ending on it. Purple cells
  // are rare (score 9970+): without this the protection would never matter.
  let seed, events, sim, onPurple;
  for (let tries = 0; ; tries++) {
    seed = int(1, 0xffffffff);
    events = buildEvents(data, selected, seed, rows);
    sim = new Simulator(seed, events, rows);
    const s = sim;
    const purple = [...s.legendColors.entries()].filter(([, c]) => c.has('legend')).map(([key]) => parseKey(key));
    onPurple = events.flatMap((ev) => purple.flatMap(({ n, track }) => {
      const raw = s.cell(ev, n, track);
      const ids = raw && ev.rarityOf.get(raw.id) !== 'legendary' ? [raw.id] : [];
      const uber = s.guaranteedUber(ev, n, track);
      if (ev.guaranteedSize && uber !== null) ids.push(uber);
      return ids;
    }));
    if (!avoidLegend || onPurple.length || tries > 200) break;
  }
  // Targets mostly among the cats of these rows (also the ubers of guaranteed
  // draws ending in them), so that most cases can be completed.
  const near = [...new Set(events.flatMap((ev) => Object.keys(ev.raw).flatMap((key) => {
    const { n, track } = parseKey(key);
    const uber = ev.guaranteedSize ? sim.guaranteedUber(ev, n, track) : null;
    return uber === null ? [ev.raw[key].id] : [ev.raw[key].id, uber];
  })))];
  const anywhere = [...new Set(events.flatMap((ev) => Object.values(ev.pools).flat()))];
  const queries = Array.from({ length: resources ? int(3, 4) : int(1, 4) }, () => String(rand() < 0.9 ? pick(near) : pick(anywhere)));
  if (avoidLegend && onPurple.length) queries[0] = String(pick(onPurple));
  const discount11 = resources || rand() < 0.4;
  return contextOf({
    from, to, now: `${from}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    seed, rows, targets: [...new Set(queries)],
    tickets: resources ? int(2, 5) : pick([0, 0, 1, 2, 4]), food: pick([0, 150, 300, 1500, 3000, 100000]),
    discount11, discount1: resources || rand() < 0.4, spend11: discount11 && rand() < 0.5, avoidLegend,
  });
}

/**
 * The search context of a case written as plain values (`now` is the local
 * time, YYYY-MM-DDTHH:MM), so that any case can be printed and kept as it is.
 */
function contextOf(form) {
  const [date, time] = form.now.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const now = minuteOf(new Date(y, m - 1, d, h, min));
  const { selected } = selectEvents(data, { from: form.from, to: form.to, today: date, now });
  const events = buildEvents(data, selected, form.seed, form.rows);
  const sim = new Simulator(form.seed, events, form.rows);
  const { resolved } = resolveTargets(withAliases(form.targets, catalog), events, sim.obtainableIds());
  return {
    form, sim, events, targets: resolved,
    inventory: { tickets: form.tickets, food: form.food, lastCat: 0 },
    discounts: { guaranteed: form.discount11, single: form.discount1, spendMulti: form.discount11 && form.spend11 },
    protect: { avoidLegend: form.avoidLegend, avoidLegendFest: false },
    from: form.from, now, to: form.to,
  };
}

function cases(seed, count) {
  const rand = random(seed);
  const out = [];
  while (out.length < count) {
    const ctx = makeCase(rand);
    if (ctx.targets.length) out.push(ctx);
  }
  return out;
}

/**
 * Checks every shown route of a case against the exhaustive search. Returns
 * which kind of answer each criterion had. A failure prints the case as plain
 * values, ready to be added to HARD_CASES below.
 */
function checkCase(ctx, label) {
  const states = exhaustive(ctx);
  const routes = optimizeRoutes(ctx);
  const kinds = [];
  for (const criterion of Object.keys(CRITERIA)) {
    const want = expected(ctx, states, criterion);
    const route = routes.find((r) => r.key === criterion);
    const where = `${label} ${JSON.stringify(ctx.form)}, ${criterion}`;
    if (!want.found) {
      assert.equal(route.found, false, `${where}: no target can be reached`);
      continue;
    }
    assert.ok(route.found && !route.exhausted, `${where}: a route is found`);
    replayRoute(assert, ctx, route); // the costs it shows are the real ones
    const t = route.totals;
    assert.deepEqual(CRITERIA[criterion]({ food: t.foodUsed }, t.ticketsUsed), want.cost, `${where}: cost`);
    assert.equal(route.complete, want.complete, `${where}: complete`);
    assert.equal(route.targets.filter((x) => x.obtained).length, want.found, `${where}: targets obtained`);
    kinds.push(want.complete ? 'complete' : 'partial');
  }
  return kinds;
}

// OPTIMALITY_CASES and OPTIMALITY_SEED run more (or other) cases, for a deeper check by hand.
const CASES = Number(process.env.OPTIMALITY_CASES) || 400;
const SEED = Number(process.env.OPTIMALITY_SEED) || 20261017;

test(`every route shown costs exactly the least that the game allows (exhaustive search, ${CASES} cases)`, (t) => {
  const kinds = cases(SEED, CASES).flatMap((ctx, i) => checkCase(ctx, `case ${i}`));
  const complete = kinds.filter((k) => k === 'complete').length;
  const partial = kinds.length - complete;
  t.diagnostic(`${complete} complete and ${partial} partial routes checked`);
  // The cases must exercise both kinds of answer, or the test proves little.
  assert.ok(complete > CASES / 4 && partial > CASES / 4, `complete ${complete}, partial ${partial}`);
});

// Cases random ones almost never reach, each found by searching for it with
// the optimizer broken on purpose: the broken one fails it, the real one
// passes. They stay fixed, whatever the generator above does.
const HARD_CASES = [
  // Keeping the 11-draw discount for a later banner. On 15/10 at 20:00, 2
  // singles and step 1 of the Vornado step-up three times reach 12A; at 11:00
  // on 16/10 that step-up is gone and three guaranteed banners open: a single
  // on Mighty Morta-Loncha (Miter Saw Cat), then the discounted guaranteed draw
  // on Akane Tounji (Lesser Demon Cat), 2100 Cat Food. A search that does not
  // tell states apart by the discounts left pays 2400.
  { from: '2026-10-15', to: '2026-10-16', now: '2026-10-15T20:00', seed: 1013904226, rows: 26, targets: ['448', '45'], tickets: 0, food: 100000, discount11: true, discount1: false, spend11: false, avoidLegend: false },
  { from: '2026-10-15', to: '2026-10-16', now: '2026-10-15T20:00', seed: 3668339987, rows: 26, targets: ['60', '307'], tickets: 0, food: 100000, discount11: true, discount1: false, spend11: false, avoidLegend: false },
  // Rare Tickets left tell states apart (saving Cat Food: a search that forgets
  // them keeps a start that spent its tickets and pays singles later).
  { from: '2026-10-12', to: '2026-10-15', now: '2026-10-12T02:27', seed: 2614206586, rows: 15, targets: ['378', '87', '153', '737'], tickets: 4, food: 1500, discount11: false, discount1: false, spend11: false, avoidLegend: false },
  // The time tells states apart (a search that forgets it mixes up which
  // banners are still open).
  { from: '2026-10-13', to: '2026-10-17', now: '2026-10-13T05:13', seed: 3172493880, rows: 13, targets: ['626', '764', '200'], tickets: 1, food: 1500, discount11: false, discount1: false, spend11: false, avoidLegend: false },
  // The step-up wait tells states apart: at 10:51 on the day a step-up closes,
  // step 1 bought now cannot be bought again before 11:00.
  { from: '2026-10-16', to: '2026-10-19', now: '2026-10-16T10:51', seed: 3465252193, rows: 18, targets: ['661'], tickets: 0, food: 300, discount11: true, discount1: false, spend11: false, avoidLegend: true },
];

test('the cases found by searching for them are still solved at the least cost', () => {
  for (const [i, form] of HARD_CASES.entries()) {
    const ctx = contextOf(form);
    assert.equal(ctx.targets.length, form.targets.length, `hard case ${i}: every target in the rolls`);
    checkCase(ctx, `hard case ${i}`);
  }
});
