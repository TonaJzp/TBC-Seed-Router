// The route search must stay exactly the same search however it is sped up:
// the same states expanded and the same path, state by state. Cases are
// generated from a fixed seed over the fixture data, with some banners turned
// into step-ups, so every run checks the very same cases.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gachaData } from './helpers.js';
import { parseRequest, selectEvents, resolveTargets, withAliases, catalogOf } from '../public/core/planner.js';
import { buildEvents } from '../public/core/gacha.js';
import { Simulator } from '../public/core/simulator.js';
import { findRoute, prepareContext } from '../public/core/optimizer.js';

const OBJECTIVES = ['optimal', 'saveFood', 'saveTickets', 'fastest'];
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

/** A varied, reproducible form: seed, targets, rows, inventory, discounts, protection and dates. */
function makeCase(rand, overrides = {}) {
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}`;
  const from = int(5, 18);
  const to = Math.min(20, from + int(0, 6));
  const ids = [...new Set(data.events
    .filter((e) => !e.ticket && e.start <= day(to) && e.end >= day(from))
    .flatMap((e) => data.gacha[e.gacha].map(String)))];
  const many = rand() < 0.25;
  return {
    now: new Date(2026, 9, from, int(0, 23), int(0, 59)),
    body: {
      url: `https://bc.godfat.org/?seed=${int(1, 0xffffffff)}`,
      targets: Array.from({ length: many ? int(8, 12) : int(1, 5) }, () => pick(ids)),
      from: day(from),
      to: day(to),
      rolls: many ? int(25, 45) : int(20, 90),
      food: pick([0, 300, 1500, 4500, int(0, 40000)]),
      tickets: pick([0, 0, 2, int(0, 15)]),
      discount11: rand() < 0.3,
      discount1: rand() < 0.3,
      spend11: rand() < 0.5,
      avoidLegend: rand() < 0.4,
      ...overrides,
    },
  };
}

/** The search context of a form, as plan() builds it. */
function contextOf({ body, now }) {
  const input = parseRequest(body, now);
  const { seed } = input.seed;
  const { selected } = selectEvents(data, input);
  const events = buildEvents(data, selected, seed, input.rolls);
  const sim = new Simulator(seed, events, input.rolls);
  const { resolved } = resolveTargets(withAliases(input.targets, catalog), events, sim.obtainableIds());
  return prepareContext({
    sim, events, targets: resolved,
    inventory: { tickets: input.tickets, food: input.food, lastCat: 0 },
    discounts: input.discounts,
    protect: { avoidLegend: input.protect.avoidLegend, avoidLegendFest: false },
    from: input.from, now: input.now, to: input.to,
  });
}

/** Everything a search did: how many states it expanded and every state of its path. */
function signature(r) {
  return JSON.stringify({
    expansions: r.expansions, complete: !!r.complete, exhausted: !!r.exhausted, unspent: !!r.unspent,
    path: r.path.map((s) => [s.n, s.track, s.last, String(s.mask), s.found, s.tl, s.d11, s.d1, s.su, s.slot, s.food, s.tickets, s.pulls, s.switches, s.ev, s.type]),
  });
}

function cases(seed, count, overrides) {
  const rand = random(seed);
  const out = [];
  while (out.length < count) {
    const c = makeCase(rand, overrides);
    const ctx = contextOf(c);
    if (ctx.targets.length) out.push({ ...c, ctx });
  }
  return out;
}

test('the dominance index finds the same states as comparing with every one', () => {
  for (const [i, c] of cases(20261013, 12).entries()) {
    for (const key of OBJECTIVES) {
      for (const enforceBudget of [true, false]) {
        const plain = signature(findRoute(c.ctx, key, { enforceBudget, indexFrom: Infinity }));
        const where = `case ${i} (${JSON.stringify(c.body)}), ${key}, budget ${enforceBudget}`;
        assert.equal(signature(findRoute(c.ctx, key, { enforceBudget, indexFrom: 1 })), plain, `${where}: always indexed`);
        assert.equal(signature(findRoute(c.ctx, key, { enforceBudget })), plain, `${where}: indexed when large`);
      }
    }
  }
});

test('a search says whether the Cat Food left some roll out', () => {
  const [poor] = cases(7, 1, { food: 0, tickets: 0 });
  assert.equal(findRoute(poor.ctx, 'optimal', { enforceBudget: true }).budgetCut, true);
  for (const [i, c] of cases(8, 8, { food: 10_000_000 }).entries()) {
    const capped = findRoute(c.ctx, 'optimal', { enforceBudget: true });
    assert.equal(capped.budgetCut, false, `case ${i}`);
    // Nothing was left out: without the budget it is the very same search.
    assert.equal(signature(findRoute(c.ctx, 'optimal', { enforceBudget: false })), signature(capped), `case ${i}`);
  }
});

test('without Rare Tickets the three shown routes are the same search', () => {
  for (const [i, c] of cases(9, 12, { tickets: 0 }).entries()) {
    for (const enforceBudget of [true, false]) {
      const optimal = signature(findRoute(c.ctx, 'optimal', { enforceBudget }));
      assert.equal(signature(findRoute(c.ctx, 'saveFood', { enforceBudget })), optimal, `case ${i}, saveFood`);
      assert.equal(signature(findRoute(c.ctx, 'saveTickets', { enforceBudget })), optimal, `case ${i}, saveTickets`);
    }
  }
});
