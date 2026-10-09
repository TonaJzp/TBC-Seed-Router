import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, replayRoute, makeSim, loadEvents, loadVariant, gachaData } from './helpers.js';
import { plan as planner, catalogOf } from '../public/core/planner.js';
import { eventWindow, rollSlot, toDay, totalCost } from '../public/core/optimizer.js';

// --- Time rules -------------------------------------------------------------

function windowOf(start, end) {
  const w = eventWindow(start, end);
  return { firstSlot: w.first, lastSlot: w.last };
}

test('time never goes back: the example of 3 overlapping events', () => {
  // Range 1-10 Oct; e1 1-3, e2 2-7, e3 7-10 (e2 is over once e3 starts).
  const e1 = windowOf('2026-10-01', '2026-10-03');
  const e2 = windowOf('2026-10-02', '2026-10-07');
  const e3 = windowOf('2026-10-07', '2026-10-10');
  const end = 2 * toDay('2026-10-10') + 1;
  let slot = 2 * toDay('2026-10-01');

  slot = rollSlot(slot, e1, end); // day 1 on e1
  assert.ok(slot !== null);
  slot = rollSlot(slot, e2, end); // day 2 on e2
  assert.ok(slot !== null);
  assert.ok(rollSlot(slot, e1, end) !== null, 'e1 and e2 share days: going back to e1 is fine');
  const afterE3 = rollSlot(slot, e3, end);
  assert.ok(afterE3 !== null);
  assert.equal(rollSlot(afterE3, e2, end), null, 'after rolling e3, e2 has already ended');
  assert.equal(rollSlot(afterE3, e1, end), null, 'after rolling e3, e1 has already ended');
});

test('an event ending on day D and one starting on day D are never simultaneous', () => {
  const old = windowOf('2026-10-05', '2026-10-09');
  const next = windowOf('2026-10-09', '2026-10-11');
  const end = 2 * toDay('2026-10-20') + 1;
  const start = 2 * toDay('2026-10-09');
  const s = rollSlot(start, old, end);
  assert.ok(s !== null, 'the old event can still be rolled on day 9 before the switch');
  assert.ok(rollSlot(s, next, end) !== null, 'then the new one');
  assert.equal(rollSlot(rollSlot(start, next, end), old, end), null, 'but never old after new');
});

test('events outside the date range cannot be rolled', () => {
  const ev = windowOf('2026-10-16', '2026-10-20');
  assert.equal(rollSlot(2 * toDay('2026-10-01'), ev, 2 * toDay('2026-10-15') + 1), null);
});

// --- Routes -----------------------------------------------------------------

function someUbers(count) {
  const sim = makeSim();
  const names = new Set();
  for (const ev of sim.events) for (const id of ev.pools.uber) names.add(ev.names[id]);
  return [...names].slice(0, count);
}

test('every route replays exactly through the simulator and respects all rules', () => {
  const scenarios = [
    { inventory: { tickets: 0, food: 50000 } },
    { inventory: { tickets: 20, food: 30000 }, discounts: { guaranteed: true, single: true } },
    { inventory: { tickets: 5, food: 3000 } },
    { inventory: { tickets: 10, food: 40000 }, protect: { avoidLegend: true, avoidLegendFest: true } },
  ];
  for (const options of scenarios) {
    const { ctx, routes } = plan(someUbers(3), options);
    assert.equal(routes.length, 4);
    assert.equal(routes[0].recommended, true);
    for (const route of routes.filter((r) => r.found)) replayRoute(assert, ctx, route);
  }
});

test('rare tickets are always spent before cat food on singles', () => {
  const { routes } = plan(someUbers(2), { inventory: { tickets: 8, food: 50000 } });
  for (const route of routes.filter((r) => r.found)) {
    let seenFoodSingle = false;
    for (const s of route.steps.filter((x) => x.type === 'single')) {
      if (s.ticketsSpent === 0) seenFoodSingle = true;
      else assert.equal(seenFoodSingle, false, `${route.label}: ticket used after paying a single with food`);
    }
  }
});

test('each one-shot discount is used at most once and only when allowed', () => {
  const { routes } = plan(someUbers(3), {
    inventory: { tickets: 3, food: 50000 },
    discounts: { guaranteed: true, single: true },
  });
  for (const route of routes.filter((r) => r.found)) {
    const discounted = route.steps.filter((s) => /descuento/.test(s.payment));
    assert.ok(discounted.filter((s) => s.type === 'single').length <= 1);
    assert.ok(discounted.filter((s) => s.type === 'guaranteed').length <= 1);
    const firstDiscountSingle = route.steps.findIndex((s) => s.type === 'single' && /descuento/.test(s.payment));
    if (firstDiscountSingle >= 0) {
      const ticketsBefore = route.steps.slice(0, firstDiscountSingle).reduce((a, s) => a + s.ticketsSpent, 0);
      assert.equal(ticketsBefore, 3, 'single discount only once all rare tickets are gone');
    }
  }
});

const byKey = (routes) => Object.fromEntries(routes.map((r) => [r.key, r]));

test('each route is the best one for its own criterion', () => {
  for (const tickets of [0, 5, 12, 40]) {
    const { routes } = plan(someUbers(3), { inventory: { tickets, food: 60000 } });
    const done = routes.filter((r) => r.found && r.complete);
    assert.equal(done.length, 4, 'fixture targets are reachable');
    const r = byKey(done);
    for (const other of done) {
      assert.ok(r.optimal.totals.totalCost <= other.totals.totalCost, `recommended is cheapest overall (${tickets} tickets)`);
      assert.ok(r.saveFood.totals.foodUsed <= other.totals.foodUsed, 'saveFood spends least Cat Food');
      assert.ok(r.saveTickets.totals.ticketsUsed <= other.totals.ticketsUsed, 'saveTickets spends least tickets');
      assert.ok(r.fastest.totals.pulls <= other.totals.pulls, 'fastest uses fewest pulls');
    }
    const t = r.optimal.totals;
    assert.equal(t.totalCost, totalCost({ food: t.foodUsed, tickets: t.ticketsUsed }), '1 ticket = 150 Cat Food');
    assert.equal(t.totalCost, t.foodUsed + 150 * t.ticketsUsed);
  }
});

// Banners without guaranteed draws only: the choice is singles vs plain 11-draws.
const standardOnly = () => loadEvents().filter((e) => !e.hasGuaranteed);

function farUber() {
  const sim = makeSim(standardOnly());
  for (const ev of sim.events) {
    for (const [key, c] of Object.entries(ev.raw)) {
      if (ev.rarityOf.get(c.id) === 'uber' && parseInt(key, 10) > 60) return c.name;
    }
  }
  throw new Error('fixture has no far uber');
}

const countByType = (route) => route.steps.reduce((a, s) => ((a[s.type] = (a[s.type] || 0) + s.count), a), {});

test('without tickets, rolling 11+ times uses 11-draws (1500) instead of food singles (1650)', () => {
  const { ctx, routes } = plan([farUber()], { events: standardOnly(), inventory: { tickets: 0, food: 80000 } });
  const r = byKey(routes).optimal;
  replayRoute(assert, ctx, r);
  assert.ok(countByType(r).multi > 0, 'uses plain 11-draws');
  let run = 0;
  let prev = null;
  for (const s of r.steps) {
    const plainFood = s.type === 'single' && s.ticketsSpent === 0 && s.foodSpent === 150 * s.count && !s.trackSwitch;
    const chained = prev && prev.eventId === s.eventId && prev.to === s.from;
    run = plainFood ? (chained ? run : 0) + s.count : 0;
    assert.ok(run < 11, `${run} food singles in a row where an 11-draw fits`);
    prev = plainFood ? s : null;
  }
});

test('saving Cat Food: ticket singles beat 11-draws until fewer than 11 tickets remain', () => {
  const { ctx, routes } = plan([farUber()], { events: standardOnly(), inventory: { tickets: 40, food: 80000 } });
  const r = byKey(routes).saveFood;
  replayRoute(assert, ctx, r);
  assert.ok(r.totals.ticketsUsed > 0);
  let tickets = 40;
  for (const s of r.steps) {
    if (s.type === 'multi') assert.ok(tickets < 11, 'an 11-draw only once fewer than 11 tickets remain');
    tickets -= s.ticketsSpent;
  }
});

// Every single's price, in roll order, as paid by the route.
function singlePrices(route) {
  const prices = [];
  for (const s of route.steps.filter((x) => x.type === 'single')) {
    for (let i = 0; i < s.count; i++) prices.push(s.ticketsSpent ? 'ticket' : null);
    if (!s.ticketsSpent) {
      // A merged block is paid at one price; a discounted single is always alone.
      prices.splice(prices.length - s.count, s.count, ...Array(s.count).fill(s.foodSpent / s.count));
    }
  }
  return prices;
}

test('when the tickets run out, singles cost Cat Food (and the first one 50 with the discount)', () => {
  const TICKETS = 3;
  const sim = makeSim(standardOnly());
  const names = [...new Set(sim.events.flatMap((e) => Object.values(e.raw).filter((c) => e.rarityOf.get(c.id) !== 'rare').map((c) => c.name)))];
  let checked = 0;
  for (const name of names.slice(0, 40)) {
    for (const discount of [false, true]) {
      const { ctx, routes } = plan([name], {
        events: standardOnly(),
        inventory: { tickets: TICKETS, food: 80000 },
        discounts: { single: discount },
      });
      for (const r of routes.filter((x) => x.found)) {
        const prices = singlePrices(r);
        if (prices.length <= TICKETS) continue;
        replayRoute(assert, ctx, r);
        assert.deepEqual(prices.slice(0, TICKETS), Array(TICKETS).fill('ticket'), 'the first singles use every ticket');
        assert.equal(prices[TICKETS], discount ? 50 : 150, 'the next single has no ticket left');
        assert.ok(prices.slice(TICKETS + 1).every((p) => p === 150), 'later singles cost 150');
        assert.equal(r.totals.ticketsLeft, 0);
        checked++;
      }
    }
  }
  assert.ok(checked >= 4, `exercised ${checked} routes that run out of tickets`);
});

test('each marked discount reports where it is used or why not', () => {
  const both = { guaranteed: true, single: true };
  const rich = plan(someUbers(2), { inventory: { tickets: 200, food: 80000 }, discounts: both });
  for (const r of rich.routes.filter((x) => x.found)) {
    if (r.totals.ticketsLeft > 0) {
      assert.equal(r.discounts.single.step, null);
      assert.match(r.discounts.single.reason, /te quedan \d+ Rare Tickets/);
    }
    const multi = r.steps.find((s) => s.type === 'multi' || s.type === 'guaranteed');
    if (multi) assert.equal(r.discounts.multi.step, multi.index, 'the first 11-draw takes the 750 discount');
    else assert.match(r.discounts.multi.reason, /ningún 11-draw/);
  }
  const none = plan(someUbers(2), { inventory: { tickets: 0, food: 80000 } });
  for (const r of none.routes.filter((x) => x.found)) assert.deepEqual(r.discounts, { multi: false, single: false });
});

test('step-up banners are used only as full 3+5+7 step-ups (2100 Cat Food)', () => {
  const window = { start: '2026-10-16', end: '2026-10-20' };
  const events = () => standardOnly().concat(loadVariant(15, window));
  const sim = makeSim(events());
  const stepup = sim.events.find((e) => e.kind === 'stepup');
  const elsewhere = new Set(sim.events.filter((e) => e !== stepup).flatMap((e) => Object.values(e.raw).map((c) => c.id)));
  // An uber that only a step-up guaranteed slot can give.
  const exclusive = Object.keys(stepup.raw)
    .map((key) => sim.guaranteed(stepup, parseInt(key, 10), key.at(-1), 0))
    .find((g) => g && !elsewhere.has(g.uber.id));
  assert.ok(exclusive, 'fixture has an uber only reachable through the step-up');

  const { ctx, routes } = plan([exclusive.uber.name], { events: events(), inventory: { tickets: 0, food: 50000 } });
  for (const route of routes.filter((r) => r.found)) replayRoute(assert, ctx, route);
  const r = byKey(routes).optimal;
  assert.ok(r.complete);
  assert.ok(countByType(r).stepup >= 1, 'the step-up is used to reach its uber');
  assert.ok(r.steps.every((s) => s.type === 'stepup' || s.eventId !== stepup.id));
});

test('many targets (more than 32) are supported', () => {
  const sim = makeSim();
  const names = new Set();
  for (const ev of sim.events) for (const c of Object.values(ev.raw).slice(0, 60)) names.add(c.name);
  const queries = [...names].slice(0, 40);
  assert.ok(queries.length > 32);
  const { ctx, routes } = plan(queries, { inventory: { tickets: 0, food: 200000 } });
  assert.equal(ctx.targets.length, queries.length);
  const route = routes.find((r) => r.found);
  assert.ok(route, 'some route is returned');
  replayRoute(assert, ctx, route);
});

// A cat that only ever appears on a purple cell: protecting purple cells makes
// it unobtainable while it still exists in the horizon.
// A made-up non-legendary cat that only appears on a purple cell (of a banner
// that gives no legendary there): protecting purple cells makes it impossible.
function eventsWithCatOnPurpleCell() {
  const events = loadEvents();
  const sim = makeSim(loadEvents());
  const key = [...sim.legendColors.keys()].find((k) => sim.legendColors.get(k).has('legend'));
  // In this banner the purple cell now holds a normal (non-legendary) cat, as in
  // banners without legendaries.
  const ev = events[0];
  ev.raw[key] = { ...ev.raw[key], id: 990010, name: 'Gato Morado' };
  ev.names[990010] = 'Gato Morado';
  return events;
}

test('when not every target is reachable the best partial route is returned and flagged', () => {
  const lonely = 'Gato Morado';
  const easy = someUbers(1)[0];
  const options = { inventory: { food: 1e6 } };

  const free = plan([lonely, easy], { ...options, events: eventsWithCatOnPurpleCell() });
  assert.ok(free.routes.every((r) => r.complete), 'without protection both are reachable');

  const { ctx, routes } = plan([lonely, easy], { ...options, events: eventsWithCatOnPurpleCell(), protect: { avoidLegend: true } });
  for (const route of routes) {
    assert.ok(route.found);
    assert.equal(route.complete, false);
    assert.deepEqual(route.targets.map((t) => t.obtained), [false, true]);
    replayRoute(assert, ctx, route);
  }
});

// --- Ties ------------------------------------------------------------------

test('at equal cost, one banner today beats switching banners later (real case, seed 1530415490)', () => {
  // Raiden is at 30A of the Metal Maiden banner. Getting there in the same
  // banner costs the same as through Vornado (13-16 Oct) first; the search used
  // to drop the single-banner route as a duplicate of a state in another banner.
  const raiden = String(catalogOf(gachaData).find((c) => c.name === 'Raiden').key);
  const body = {
    url: 'https://bc.godfat.org/?seed=1530415490&last=53', targets: [raiden], from: '2026-10-09', to: '2026-10-23',
    rolls: 200, tickets: 100, food: 5000, avoidLegend: true, avoidLegendFest: true,
  };
  const result = planner(body, gachaData, { now: new Date('2026-10-09T12:00:00') });
  for (const r of result.routes) {
    assert.ok(r.complete, r.label);
    assert.deepEqual([...new Set(r.steps.map((s) => s.eventId))], ['2026-10-09_1077'], `${r.label}: a single banner`);
    assert.ok(r.steps.every((s) => s.date === '2026-10-09'), `${r.label}: today`);
    assert.equal(r.totals.finalPosition, r.label === 'Máximo ahorro de Rare Tickets' ? '34A' : '31A');
  }
  const best = result.routes[0];
  assert.deepEqual([best.totals.ticketsUsed, best.totals.foodUsed], [8, 3000]);
  assert.equal(best.steps.at(-1).cats.at(-1).name, 'Raiden');
  // Banners ending today may already be gone in the game: never planned.
  const endingToday = result.skipped.filter((s) => s.end === '2026-10-09');
  assert.deepEqual(endingToday.map((s) => s.id), ['2026-10-05_1061', '2026-10-05_1077', '2026-10-05_942']);
  assert.ok(endingToday.every((s) => /termina hoy/.test(s.reason)));
  assert.ok(result.events.every((e) => e.end > '2026-10-09'));
});
