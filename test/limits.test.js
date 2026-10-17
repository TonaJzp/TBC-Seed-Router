// A search stops once it stores a set number of states, so even a huge
// analysis ends in bounded memory: it says so (exhausted) and still returns
// routes that hold roll by roll. Below that number nothing changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, replayRoute, makeSim } from './helpers.js';
import { findRoute, optimizeRoutes, MAX_STATES } from '../public/core/optimizer.js';

function someUbers(count) {
  const sim = makeSim();
  const names = new Set();
  for (const ev of sim.events) for (const id of ev.pools.uber) names.add(ev.names[id]);
  return [...names].slice(0, count);
}

const pathOf = (r) =>
  JSON.stringify({
    complete: !!r.complete, exhausted: !!r.exhausted,
    path: r.path.map((s) => [s.n, s.track, s.last, String(s.mask), s.slot, s.food, s.tickets, s.pulls, s.switches, s.ev, s.type]),
  });

test('a search that stores too many states stops and says its route is not proven', () => {
  const { ctx } = plan(someUbers(8), { inventory: { tickets: 0, food: 100000 } });
  const whole = findRoute(ctx, 'optimal', { enforceBudget: false });
  assert.equal(!!whole.exhausted, false, 'the whole search fits');
  const cut = findRoute({ ...ctx, maxStates: 200 }, 'optimal', { enforceBudget: false });
  assert.equal(cut.exhausted, true);
});

test('the routes of a search cut by the limit still hold roll by roll', () => {
  const { ctx } = plan(someUbers(8), { inventory: { tickets: 3, food: 20000 } });
  const small = { ...ctx, maxStates: 200 };
  const routes = optimizeRoutes(small);
  assert.ok(routes.some((r) => r.found && r.exhausted), 'some shown route hit the limit');
  for (const route of routes.filter((r) => r.found)) replayRoute(assert, small, route);
});

test('below the limit the search is the very same', () => {
  const { ctx } = plan(someUbers(6), { inventory: { tickets: 5, food: 30000 } });
  for (const key of ['optimal', 'saveFood', 'saveTickets']) {
    const usual = findRoute(ctx, key, { enforceBudget: true });
    const unbounded = findRoute({ ...ctx, maxStates: Infinity }, key, { enforceBudget: true });
    assert.equal(pathOf(usual), pathOf(unbounded), key);
  }
});

test('the limit is the one measured to stay near 500 MB with a phone-sized memory', () => {
  // 02-DOCS progress analysis-load T1: 1.2 M stored states end within a 450 MB heap.
  assert.equal(MAX_STATES, 1_200_000);
});
