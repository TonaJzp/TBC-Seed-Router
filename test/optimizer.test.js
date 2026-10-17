import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, replayRoute, makeSim, loadEvents, loadVariant, gachaData } from './helpers.js';
import { plan as planner, catalogOf } from '../public/core/planner.js';
import { eventWindow, rollSlot, totalCost, optimizeRoutes } from '../public/core/optimizer.js';
import { localMinute, nextDayMinute } from '../public/core/time.js';
import { buildEvents } from '../public/core/gacha.js';
import { Simulator } from '../public/core/simulator.js';

/** Simulator over the given banners of the fixture data. */
const makeSimFor = (seed, ids, rolls) =>
  new Simulator(seed, buildEvents(gachaData, ids.map((id) => gachaData.events.find((e) => e.id === id)), seed, rolls), rolls);

// --- Time rules -------------------------------------------------------------
// Banners open and close at 11:00 local time, as in the game data.

function windowOf(start, end) {
  const w = eventWindow({ start, end, startTime: '11:00', endTime: '11:00' });
  return { firstSlot: w.first, lastSlot: w.last };
}
const at = (iso, hhmm = '00:00') => localMinute(iso, hhmm);

test('time never goes back: the example of 3 overlapping events', () => {
  // Range 1-10 Oct; e1 1-3, e2 2-7, e3 7-10 (e2 is over once e3 starts).
  const e1 = windowOf('2026-10-01', '2026-10-03');
  const e2 = windowOf('2026-10-02', '2026-10-07');
  const e3 = windowOf('2026-10-07', '2026-10-10');
  const end = nextDayMinute('2026-10-10') - 1;
  let slot = at('2026-10-01');

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

test('a banner ending at 11:00 and one starting at 11:00 are never simultaneous', () => {
  const old = windowOf('2026-10-05', '2026-10-09');
  const next = windowOf('2026-10-09', '2026-10-11');
  const end = nextDayMinute('2026-10-20') - 1;
  const morning = at('2026-10-09', '03:42');
  const s = rollSlot(morning, old, end);
  assert.equal(s, morning, 'at 03:42 the old banner can still be rolled');
  assert.equal(rollSlot(s, next, end), at('2026-10-09', '11:00'), 'then the new one, from 11:00');
  assert.equal(rollSlot(rollSlot(morning, next, end), old, end), null, 'but never old after new');
  assert.equal(rollSlot(at('2026-10-09', '10:59'), old, end), at('2026-10-09', '10:59'), 'last minute of the old one');
  assert.equal(rollSlot(at('2026-10-09', '11:00'), old, end), null, 'at 11:00 it is gone');
});

test('events outside the date range cannot be rolled', () => {
  const ev = windowOf('2026-10-16', '2026-10-20');
  assert.equal(rollSlot(at('2026-10-01'), ev, nextDayMinute('2026-10-15') - 1), null);
  assert.equal(rollSlot(at('2026-10-01'), ev, nextDayMinute('2026-10-16') - 1), at('2026-10-16', '11:00'), 'from 11:00 of its first day');
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
    assert.deepEqual(routes.map((r) => r.key).sort(), ['optimal', 'saveFood', 'saveTickets']);
    assert.equal(routes[0].recommended, true, 'the recommended route goes first');
    assert.equal(routes.filter((r) => r.recommended).length, 1);
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
    assert.equal(done.length, 3, 'fixture targets are reachable');
    const r = byKey(done);
    for (const other of done) {
      assert.ok(r.optimal.totals.totalCost <= other.totals.totalCost, `optimal is cheapest overall (${tickets} tickets)`);
      assert.ok(r.saveFood.totals.foodUsed <= other.totals.foodUsed, 'saveFood spends least Cat Food');
      assert.ok(r.saveTickets.totals.ticketsUsed <= other.totals.ticketsUsed, 'saveTickets spends least tickets');
    }
    assert.equal(r.optimal.recommended, true, 'with enough Cat Food the cheapest route is recommended');
    assert.equal(r.optimal.recommendedFor, 'cheapest');
    const t = r.optimal.totals;
    assert.equal(t.totalCost, totalCost({ food: t.foodUsed, tickets: t.ticketsUsed }), '1 ticket = 150 Cat Food');
    assert.equal(t.totalCost, t.foodUsed + 150 * t.ticketsUsed);
  }
});

test('when no route fits the Cat Food, the one asking for the least extra Cat Food is recommended', () => {
  const { routes } = plan(someUbers(3), { inventory: { tickets: 40, food: 0 } });
  const r = byKey(routes);
  assert.ok(r.optimal.found && !r.optimal.totals.affordable, 'fixture: the cheapest route needs Cat Food');
  assert.ok(r.saveFood.totals.foodUsed < r.optimal.totals.foodUsed, 'fixture: tickets save Cat Food');
  assert.equal(routes[0], r.saveFood, 'it goes first');
  assert.equal(r.saveFood.recommended, true);
  assert.equal(r.saveFood.recommendedFor, 'leastFood');
  assert.equal(r.optimal.recommended, false);
  for (const other of routes.filter((x) => x.found)) {
    assert.ok(r.saveFood.totals.shortfall <= other.totals.shortfall, 'no route asks for less Cat Food');
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

test('when the tickets run out, singles cost Cat Food (and the first one 30 with the discount)', () => {
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
        assert.equal(prices[TICKETS], discount ? 30 : 150, 'the next single has no ticket left');
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

test('a step-up banner still gives its guaranteed uber through the full 3+5+7 (2100 Cat Food)', () => {
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
});

// The step-up banner alone, rolled from 1A: Mer-Cat is the 1st cat, Rocker Cat
// the 3rd, Psychocat the 4th and Nerd Cat the 9th (none earlier, none on B).
const stepUpOnly = () => [loadVariant(15, { start: '2026-10-16', end: '2026-10-20' })];
const stepUpRoute = (name, inventory, key = 'optimal') => {
  const { ctx, routes } = plan([name], { events: stepUpOnly(), inventory: { tickets: 0, food: 50000, ...inventory } });
  for (const route of routes.filter((r) => r.found)) replayRoute(assert, ctx, route);
  const r = byKey(routes)[key];
  assert.ok(r.complete, name);
  return r;
};
const shape = (r) => r.steps.map((s) => (s.count > 1 || s.type === 'single' ? `${s.type}×${s.count}` : s.type));

test('step 1 of a step-up alone (3 draws for 300) when it is the cheapest way', () => {
  // Official EN poster «Increasing Capsules»: step 1 = 3 draws for 300 Cat Food.
  const rocker = stepUpRoute('Rocker Cat');
  assert.deepEqual(shape(rocker), ['stepup1']);
  assert.equal(rocker.totals.foodUsed, 300);
  assert.equal(rocker.steps[0].payment, '300 Cat Food (paso 1)');
  // One draw is enough: a single, not a step.
  assert.deepEqual(shape(stepUpRoute('Mer-Cat')), ['single×1']);
  // Four draws: step 1 and a single (450, either order), not two steps 1 (600) nor four singles (600).
  const psycho = stepUpRoute('Psychocat');
  assert.deepEqual(shape(psycho).sort(), ['single×1', 'stepup1']);
  assert.equal(psycho.totals.foodUsed, 450);
});

test('after step 1 alone, the next step-up waits 30 minutes, until it is back at step 1', () => {
  const nerd = stepUpRoute('Nerd Cat');
  // 9 draws: three steps 1 (900) beat steps 1-2 and a single (1200) and nine singles (1350),
  // shown as one row: step 1, three times, one every 30 minutes.
  assert.deepEqual(shape(nerd), ['stepup1×3']);
  assert.equal(nerd.totals.foodUsed, 900);
  const [row] = nerd.steps;
  assert.equal(row.cats.length, 9);
  assert.equal(row.lastSlot - row.slot, 60);
  assert.equal(row.stepUpFrom, null, 'nothing to wait for at first');
  assert.ok(row.untilTime, 'the time of the last one is told');
});

test('Rare Tickets pay singles on a step-up banner, never its steps', () => {
  // Saving Cat Food: 3 tickets as singles, then two steps 1 for the other 6 draws.
  const nerd = stepUpRoute('Nerd Cat', { tickets: 3 }, 'saveFood');
  assert.equal(nerd.totals.ticketsUsed, 3);
  assert.equal(nerd.totals.foodUsed, 600);
  assert.ok(nerd.steps.filter((s) => s.type.startsWith('stepup')).every((s) => s.ticketsSpent === 0));
  assert.ok(nerd.steps.some((s) => s.type === 'single' && s.ticketsSpent > 0));
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
  // At 12:00 the banners that ended today at 11:00 are gone.
  const endedToday = result.skipped.filter((s) => s.end === '2026-10-09');
  assert.deepEqual(endedToday.map((s) => s.id), ['2026-10-05_1061', '2026-10-05_1077', '2026-10-05_942']);
  assert.ok(endedToday.every((s) => s.reason === 'terminó hoy a las 11:00'));
  assert.ok(result.events.every((e) => e.end > '2026-10-09'));
});

test('before 11:00, a banner ending today is still planned, to be done before 11:00', () => {
  // The same case at 03:42: the copy of Metal Maiden ending at 11:00 has the
  // same table and can be rolled now, so the route is done now in it.
  const raiden = String(catalogOf(gachaData).find((c) => c.name === 'Raiden').key);
  const body = {
    url: 'https://bc.godfat.org/?seed=1530415490&last=53', targets: [raiden], from: '2026-10-09', to: '2026-10-23',
    rolls: 200, tickets: 100, food: 5000, avoidLegend: true, avoidLegendFest: true,
  };
  const result = planner(body, gachaData, { now: new Date(2026, 9, 9, 3, 42) });
  assert.ok(result.events.some((e) => e.id === '2026-10-05_1061'), 'Squire Luno (ends at 11:00) is planned');
  assert.ok(!result.skipped.some((s) => s.end === '2026-10-09'));
  const best = result.routes[0];
  assert.deepEqual([best.totals.ticketsUsed, best.totals.foodUsed], [8, 3000]);
  assert.ok(best.steps.every((s) => s.eventId === '2026-10-05_1077' && s.date === '2026-10-09' && s.closesAt === '11:00' && !s.opensAt));
  // ...but the same banner carries on from 11:00, so there is no hurry; Squire Luno does not.
  const byId = new Map(result.events.map((e) => [e.id, e]));
  assert.deepEqual(byId.get('2026-10-05_1077').continuedBy, { id: '2026-10-09_1077', end: '2026-10-16', endTime: undefined });
  assert.equal(byId.get('2026-10-05_1061').continuedBy, null);
  // A banner that opens later today is marked with its hour.
  const fuma = String(catalogOf(gachaData).find((c) => c.name === 'Fuma Kotaro').key);
  const later = planner({ ...body, targets: [fuma] }, gachaData, { now: new Date(2026, 9, 9, 3, 42) });
  const steps = later.routes.flatMap((r) => r.steps);
  assert.equal(steps.find((s) => s.eventId === '2026-10-09_1043')?.opensAt, '11:00', 'Fuma Kotaro opens today at 11:00');
  assert.ok(steps.filter((s) => s.eventId === '2026-10-18_1043').every((s) => s.date === '2026-10-18' && s.opensAt === '11:00'));
});

test('a legend cell lists every legendary of the banners active at that moment of the route', () => {
  // Seed 4102194373 rolls its purple 2A in Metal Maiden (Musashi Miyamoto).
  // What else 2A gives depends on which banners are open when it is rolled.
  const oda = String(catalogOf(gachaData).find((c) => c.name === 'Oda Nobunaga').key);
  const body = (from) => ({
    url: 'https://bc.godfat.org/?seed=4102194373&last=39', targets: [oda], from, to: '2026-10-15',
    rolls: 200, tickets: 0, food: 100000, avoidLegend: true, avoidLegendFest: true,
  });
  const cellAt = (from, now) => {
    const r = planner(body(from), gachaData, { now });
    return r.routes[0].legendCells.find((c) => c.key === '2A');
  };
  const names = (cell) => cell.legends.map((l) => l.name).sort();
  const early = cellAt('2026-10-09', new Date(2026, 9, 9, 3, 42));
  assert.equal(early.got.name, 'Musashi Miyamoto');
  assert.deepEqual(names(early), ['Daybreaker Izanagi', 'Wonder MOMOCO'], 'banners closing at 11:00 are still on');
  assert.deepEqual(names(cellAt('2026-10-09', new Date(2026, 9, 9, 12, 0))), ['Emperor Cat'], 'after 11:00, the new ones');
  const later = cellAt('2026-10-13', new Date(2026, 9, 13, 12, 0));
  assert.deepEqual(names(later), ['Gaia the Creator', 'High Lord Babel']);
  assert.ok(later.legends.every((l) => l.id !== later.got.id), 'the legendary already obtained is not offered again');
});

test('a legendary of another banner is "without leaving the route" only if the route really stays the same', () => {
  const key = (name) => String(catalogOf(gachaData).find((c) => c.name === name).key);
  const run = (seed, target, from, now) =>
    planner({ url: `https://bc.godfat.org/?seed=${seed}&last=39`, targets: [key(target)], from, to: '2026-10-15', rolls: 200, tickets: 0, food: 100000 }, gachaData, { now });

  // 2A is a single roll: doing it in Squire Luno or Conjurer instead changes nothing else.
  const single = run(4102194373, 'Oda Nobunaga', '2026-10-09', new Date(2026, 9, 9, 3, 42));
  const route = single.routes[0];
  const cell = route.legendCells.find((c) => c.key === '2A');
  assert.equal(cell.inDraw, false);
  assert.ok(cell.legends.length === 2 && cell.legends.every((l) => l.sameRoute));
  // Replay the whole route with that roll in the other banner: every other cat is the same.
  const sim = makeSimFor(4102194373, single.events.map((e) => e.id), 200);
  for (const alt of cell.legends) {
    let pos = { n: 1, track: 'A' };
    let last = 39;
    const got = [];
    for (const step of route.steps) {
      for (const c of step.cats) {
        const ev = sim.events.find((e) => e.id === (c.cell === '2A' ? alt.eventId : step.eventId));
        const s = sim.single(ev, pos.n, pos.track, last);
        got.push(s.cat.name);
        last = s.cat.id;
        pos = s.next;
      }
    }
    const expected = route.steps.flatMap((s) => s.cats.map((c) => (c.cell === '2A' ? alt.name : c.name)));
    assert.deepEqual(got, expected, `in ${alt.eventName}`);
    assert.equal(`${pos.n}${pos.track}`, route.totals.finalPosition);
  }

  // 64B is inside an 11-draw: its banner can't change for that roll alone.
  const draw = run(8085299, 'Hevijak the Wicked', '2026-10-09', new Date(2026, 9, 9, 12, 0));
  const inDraw = draw.routes[0].legendCells.find((c) => c.key === '64B');
  assert.equal(inDraw.inDraw, true);
  assert.equal(inDraw.got.name, 'Megidora');
  assert.deepEqual(inDraw.legends.map((l) => [l.name, l.sameRoute]), [['Lumina', false]]);
});

test('a cell where the route gets a target is never "the same route" in another banner: the target would be lost', () => {
  const key = (name) => String(catalogOf(gachaData).find((c) => c.name === name).key);
  // Musashi Miyamoto (legendary) is only taken at 2A, a single roll. A
  // legendary counts even on a protected cell, so protecting changes nothing.
  for (const avoid of [false, true]) {
    const r = planner({
      url: 'https://bc.godfat.org/?seed=4102194373&last=39', targets: [key('Musashi Miyamoto')], from: '2026-10-09', to: '2026-10-15',
      rolls: 200, tickets: 0, food: 100000, avoidLegend: avoid, avoidLegendFest: avoid,
    }, gachaData, { now: new Date(2026, 9, 9, 3, 42) });
    const route = r.routes[0];
    assert.equal(route.targets[0].obtained, true);
    const cell = route.legendCells.find((c) => c.key === '2A');
    assert.equal(cell.got.name, 'Musashi Miyamoto');
    assert.equal(cell.inDraw, false);
    assert.ok(cell.legends.length >= 2, 'fixture: other banners give another legendary there');
    for (const l of cell.legends) {
      assert.equal(l.sameRoute, false, `${l.name} (protect ${avoid}) would lose Musashi Miyamoto`);
      assert.equal(l.losesTarget, true, `${l.name} (protect ${avoid}) says why`);
    }
  }
});

test('a target the route gets again later does not stop its legend cell from being "the same route"', () => {
  // Made-up cats on two banners open at once: the target «Doble» at 2A (a
  // purple cell) and, depending on the case, again at 4A; «Final» at 5A. The
  // other banner gives a legendary at 2A.
  const run = (again) => {
    const events = loadEvents();
    const [main, other] = events;
    const put = (ev, key, id, name) => {
      ev.raw[key] = { ...ev.raw[key], id, name };
      ev.names[id] = name;
    };
    put(main, '2A', 990010, 'Gato Doble');
    if (again) put(main, '4A', 990010, 'Gato Doble');
    put(main, '5A', 990011, 'Gato Final');
    put(other, '2A', 990012, 'Leyenda Falsa');
    const { ctx } = plan(['Gato Doble', 'Gato Final'], { events });
    other.rarityOf.set(990012, 'legendary'); // the simulator builds rarityOf
    ctx.sim.legendColors.set('2A', new Set(['legend']));
    const route = optimizeRoutes(ctx)[0];
    assert.ok(route.complete, 'fixture: both targets');
    const cell = route.legendCells.find((c) => c.key === '2A');
    assert.equal(cell.got.name, 'Gato Doble');
    assert.equal(cell.inDraw, false, 'fixture: 2A is a single roll');
    const legend = cell.legends.find((l) => l.name === 'Leyenda Falsa');
    assert.ok(legend, 'fixture: the other banner is open there');
    if (again) {
      const hits = route.steps.flatMap((s) => s.cats).filter((c) => c.name === 'Gato Doble' && c.target);
      assert.deepEqual(hits.map((c) => c.cell), ['2A', '4A'], 'fixture: the route gets it twice');
    }
    return legend;
  };
  assert.deepEqual(run(true), { ...run(true), sameRoute: true, losesTarget: false }, 'got again at 4A: nothing is lost');
  assert.deepEqual(run(false), { ...run(false), sameRoute: false, losesTarget: true }, 'only at 2A: the target would be lost');
});

test('a cell whose cat is not a target can still be rolled in another banner', () => {
  const key = (name) => String(catalogOf(gachaData).find((c) => c.name === name).key);
  // Oda Nobunaga's route rolls 2A on a single and gets Musashi Miyamoto there,
  // who is not a target: the other banners keep the route (as before).
  const r = planner({
    url: 'https://bc.godfat.org/?seed=4102194373&last=39', targets: [key('Oda Nobunaga')], from: '2026-10-09', to: '2026-10-15',
    rolls: 200, tickets: 0, food: 100000,
  }, gachaData, { now: new Date(2026, 9, 9, 3, 42) });
  const cell = r.routes[0].legendCells.find((c) => c.key === '2A');
  assert.ok(cell.legends.length && cell.legends.every((l) => l.sameRoute && !l.losesTarget));
});

// --- «Incluirlo siempre en la ruta» (11-draw at 750) ---------------------------

test('spending the 11-draw discount in any case: every route uses it, at the lowest cost for its criterion', () => {
  const targets = someUbers(1);
  const options = { inventory: { tickets: 30, food: 60000 } };
  const free = byKey(plan(targets, { ...options, discounts: { guaranteed: true } }).routes);
  const { ctx, routes } = plan(targets, { ...options, discounts: { guaranteed: true, spendMulti: true } });
  for (const route of routes.filter((r) => r.found)) {
    replayRoute(assert, ctx, route);
    assert.equal(route.complete, true, route.label);
    assert.ok(route.discounts.multi.step, `${route.label}: the discount is spent`);
    assert.equal(route.discounts.multi.spend, true);
    const before = free[route.key].totals;
    // Forcing it can never make a route better for its own criterion.
    if (route.key === 'optimal') assert.ok(route.totals.totalCost >= before.totalCost);
    if (route.key === 'saveFood') assert.ok(route.totals.foodUsed >= before.foodUsed);
    if (route.key === 'saveTickets') assert.ok(route.totals.ticketsUsed >= before.ticketsUsed);
  }
});

test('if the 11-draw discount cannot be paid, the route is still given and says why', () => {
  const { routes } = plan(someUbers(1), { inventory: { tickets: 200, food: 0 }, discounts: { guaranteed: true, spendMulti: true } });
  const found = routes.filter((r) => r.found && r.complete);
  assert.ok(found.length, 'the target is reachable with tickets alone');
  for (const route of found) {
    assert.equal(route.discounts.multi.step, null);
    assert.match(route.discounts.multi.reason, /no se ha podido gastar/);
  }
});

test('a step is linked from its own cell when godfat would draw its first roll otherwise', async () => {
  // godfat draws re-rolls along its own table (ev.alt) and takes `last` only
  // at 1A. Checked on bc.godfat.org on 2026-10-13: seed 2286, 12A of
  // 2026-10-16_979 after a guaranteed uber (800) drew «Wushu Cat -> re-roll»,
  // which the route does not do; the table from 12A as 1A, with last=800, did not.
  const { needsLastLink } = await import('../public/core/optimizer.js');
  const ev = {
    raw: { '1A': { id: 10 }, '1B': { id: 10 }, '5A': { id: 10 }, '7A': { id: 11 }, '9B': { id: 20 } },
    alt: { '5A': { id: 12 } }, // godfat draws a re-roll at 5A
    rarityOf: new Map([[10, 'rare'], [11, 'rare'], [20, 'uber']]),
  };
  assert.equal(needsLastLink(ev, 5, 'A', 10), false, 'both re-roll it');
  assert.equal(needsLastLink(ev, 5, 'A', 99), true, 'godfat draws a re-roll the route does not do');
  assert.equal(needsLastLink(ev, 7, 'A', 11), true, 'the route re-rolls it, godfat does not draw it');
  assert.equal(needsLastLink(ev, 7, 'A', 99), false, 'neither re-rolls it');
  assert.equal(needsLastLink(ev, 9, 'B', 20), false, 'only rares re-roll');
  assert.equal(needsLastLink(ev, 1, 'B', 10), true, '1B: godfat takes `last` only at 1A');
  assert.equal(needsLastLink(ev, 1, 'A', 10), false, 'at 1A the link already passes `last`');
});

test('every step says whether godfat shows its first roll as the route rolls it', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  const r = planner({ url: 'https://bc.godfat.org/?seed=1234567', targets: ['851', '34', '35', '36', '37'], from: '2026-10-16', to: '2026-10-20', rolls: 200, food: 30000, tickets: 20 }, gachaData, { now });
  const steps = r.routes.filter((x) => x.found).flatMap((x) => x.steps);
  assert.ok(steps.length > 0);
  assert.ok(steps.every((s) => typeof s.godfatFromLast === 'boolean'));
  assert.ok(steps.filter((s) => s.from === '1A').every((s) => !s.godfatFromLast));
  // Seed 409: step 4 of «saveTickets» rolls Gardener Cat at 25A of 2026-10-16_979
  // without a re-roll, where godfat's own table draws one.
  const other = planner({ url: '409', targets: ['68', '148', '408'], from: '2026-10-16', to: '2026-10-20', rolls: 100, food: 30000, tickets: 20 }, gachaData, { now });
  const step = other.routes.find((x) => x.key === 'saveTickets').steps.find((s) => s.godfatFromLast);
  assert.deepEqual([step.from, step.eventId, step.cats[0].name, step.cats[0].rerolled], ['25A', '2026-10-16_979', 'Gardener Cat', false]);
});

test('a route lists the banners it rolls before they open, and marks their steps', () => {
  // A game update before a banner opens can add cats to it, which changes the
  // cells of their rarity (confirmed by the owner, 2026-10-13).
  const body = { url: 'https://bc.godfat.org/?seed=1234567', targets: ['851', '34', '35', '36', '37'], from: '2026-10-16', to: '2026-10-20', rolls: 200, food: 30000, tickets: 20 };
  const morning = planner(body, gachaData, { now: new Date(2026, 9, 16, 8, 0) }).routes.find((x) => x.key === 'optimal');
  assert.deepEqual(morning.upcoming.map((u) => [u.eventId, u.start, u.step]), [
    ['2026-10-16_986', '2026-10-16', 7],
    ['2026-10-18_1043', '2026-10-18', 10],
  ]);
  assert.deepEqual(morning.steps.map((s) => s.upcoming), [false, false, false, false, false, false, true, true, true, true]);
  // At noon the banners of the 16th are open: only the one of the 18th is still to come.
  const noon = planner(body, gachaData, { now: new Date(2026, 9, 16, 12, 0) }).routes.find((x) => x.key === 'optimal');
  assert.deepEqual(noon.upcoming.map((u) => u.eventId), ['2026-10-18_1043']);
  assert.ok(noon.steps.filter((s) => s.eventId === '2026-10-16_986').every((s) => !s.upcoming));
  // Nothing to come: nothing listed.
  const later = planner({ ...body, from: '2026-10-18', to: '2026-10-19' }, gachaData, { now: new Date(2026, 9, 18, 12, 0) });
  assert.ok(later.routes.filter((x) => x.found).every((x) => x.upcoming.length === 0 && x.steps.every((s) => !s.upcoming)));
});

test('a step says by a field, not by its wording, whether it takes a discount', () => {
  const both = { guaranteed: true, single: true };
  const { routes } = plan(someUbers(2), { inventory: { tickets: 0, food: 80000 }, discounts: both });
  for (const r of routes.filter((x) => x.found)) {
    for (const s of r.steps) assert.equal(typeof s.discount, 'boolean', `${r.key} step ${s.index}`);
    const discounted = r.steps.filter((s) => s.discount);
    assert.ok(discounted.length > 0, `${r.key} uses a discount`);
    // The discount summary points at the steps that carry the field.
    for (const d of [r.discounts.multi, r.discounts.single]) if (d?.step) assert.ok(r.steps[d.step - 1].discount, `${r.key} step ${d.step}`);
  }
});

test('the recommended route is always one that was found', async () => {
  const { pickRecommended } = await import('../public/core/optimizer.js');
  const route = (key, found, extra = {}) => ({ key, found, targets: [{ obtained: found }], totals: { affordable: true, foodUsed: 0, totalCost: 0 }, ...extra });
  // The cheapest search ran out without a route; another one found it.
  const routes = [route('optimal', false), route('saveFood', true), route('saveTickets', true)];
  const [first] = pickRecommended(routes);
  assert.equal(first.key, 'saveFood');
  assert.ok(first.recommended && !routes[0].recommended);
  // Nothing found anywhere: nothing is recommended.
  const none = [route('optimal', false), route('saveFood', false), route('saveTickets', false)];
  pickRecommended(none);
  assert.ok(none.every((r) => !r.recommended));
});

test('a route that gets more targets is recommended over a cheaper one whose search was cut', async () => {
  const { pickRecommended } = await import('../public/core/optimizer.js');
  // Targets got (of 3), total cost, Cat Food and whether it is affordable.
  const route = (key, got, cost, { food = cost, affordable = true, exhausted = true } = {}) => ({
    key, found: true, exhausted,
    targets: [0, 1, 2].map((i) => ({ obtained: i < got })),
    totals: { totalCost: cost, foodUsed: food, affordable },
  });
  // The real case (seed 1234567, 16 cats): the cheapest two were cut short.
  const cut = [route('optimal', 2, 9000), route('saveFood', 2, 9000), route('saveTickets', 3, 12000, { exhausted: false })];
  const ordered = pickRecommended(cut);
  assert.equal(ordered[0].key, 'saveTickets', 'it goes first');
  assert.ok(ordered[0].recommended && cut.filter((r) => r.recommended).length === 1);
  assert.equal(ordered[0].recommendedFor, 'mostTargets');
  // Among the ones getting the most, the lowest total spend.
  const two = pickRecommended([route('optimal', 1, 3000), route('saveFood', 3, 9000), route('saveTickets', 3, 8000)]);
  assert.equal(two[0].key, 'saveTickets');
  // As many targets: the cheapest stays recommended even if its search was cut.
  const tie = pickRecommended([route('optimal', 3, 5000), route('saveFood', 3, 6000), route('saveTickets', 3, 7000)]);
  assert.equal(tie[0].key, 'optimal');
  assert.equal(tie[0].recommendedFor, 'cheapest');
  // Short of Cat Food: the least extra Cat Food, as before, only among the ones getting the most.
  const short = { affordable: false };
  const lean = pickRecommended([route('optimal', 3, 5000, short), route('saveFood', 3, 6000, { ...short, food: 1000 }), route('saveTickets', 2, 9000)]);
  assert.equal(lean[0].key, 'saveFood');
  assert.equal(lean[0].recommendedFor, 'leastFood');
  const notLean = pickRecommended([route('optimal', 3, 5000, short), route('saveFood', 2, 6000, { ...short, food: 1000 }), route('saveTickets', 2, 9000)]);
  assert.equal(notLean[0].key, 'optimal', 'never one with fewer targets');
});
