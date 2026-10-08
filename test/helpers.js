'use strict';

const fixture = require('./fixtures/events.json');
const variants = require('./fixtures/variants.json');
const { Simulator } = require('../src/simulator');
const { optimizeRoutes, eventWindow, COST, countsAsTarget } = require('../src/optimizer');
const { resolveTargets } = require('../server');

/** Fresh copies: the simulator and optimizer annotate the event objects. */
function loadEvents() {
  return JSON.parse(JSON.stringify(fixture.events));
}

/** A banner rendered by godfat as a step-up (15) or 7-guaranteed one. */
function loadVariant(size, overrides = {}) {
  return { ...JSON.parse(JSON.stringify(variants[size])), id: `variant-${size}`, ...overrides };
}

function makeSim(events = loadEvents()) {
  return new Simulator(fixture.seed, events, fixture.rolls);
}

function plan(queries, options = {}) {
  const sim = makeSim(options.events || loadEvents());
  const { resolved, unavailable } = resolveTargets(queries, sim.events, sim.obtainableIds());
  const ctx = {
    sim,
    events: sim.events,
    targets: resolved,
    inventory: { tickets: 0, food: 100000, lastCat: 0, ...options.inventory },
    discounts: { guaranteed: false, single: false, ...options.discounts },
    protect: { avoidLegend: false, avoidLegendFest: false, ...options.protect },
    from: options.from || fixture.from,
    to: options.to || fixture.to,
  };
  return { ctx, routes: optimizeRoutes(ctx), unavailable };
}

/**
 * Replays a route through the simulator from scratch and checks every rule the
 * optimizer must respect. Throws (via assert) on the first violation.
 */
function replayRoute(assert, ctx, route) {
  const { sim, inventory, discounts, protect } = ctx;
  const byId = new Map(sim.events.map((e) => [e.id, e]));
  let pos = { n: 1, track: 'A' };
  let last = inventory.lastCat;
  let tickets = inventory.tickets;
  let d1 = discounts.single;
  let d11 = discounts.guaranteed;
  let slot = ctx.startSlot;
  let food = 0;
  let ticketsUsed = 0;
  const obtained = new Set();

  // Rolls may land on protected cells, but a non-legendary cat rolled there
  // doesn't count as obtained.
  const collect = (cats, landed) => {
    cats.forEach((c, i) => {
      if (countsAsTarget(sim, protect, c, landed[i])) obtained.add(c.id);
    });
  };

  for (const step of route.steps) {
    const ev = byId.get(step.eventId);
    assert.equal(`${pos.n}${pos.track}`, step.from, `step ${step.index} starts where the previous ended`);

    // Time only moves forward and the banner must be active at that time.
    const w = eventWindow(ev.start, ev.end);
    slot = Math.max(slot, w.first);
    assert.ok(slot <= w.last && slot <= ctx.endSlot, `step ${step.index}: ${ev.name} is not active`);

    const rolled = [];
    if (step.type === 'single') {
      assert.notEqual(ev.kind, 'stepup', 'step-up banners only allow the full step-up');
      for (let i = 0; i < step.count; i++) {
        const s = sim.single(ev, pos.n, pos.track, last);
        assert.ok(s, `step ${step.index}: single roll must exist`);
        collect([s.cat], s.landed);
        if (tickets > 0) {
          tickets--;
          ticketsUsed++;
        } else if (d1) {
          d1 = false;
          food += COST.singleDiscount;
        } else {
          food += COST.single;
        }
        rolled.push(s.cat.id);
        last = s.cat.id;
        pos = s.next;
      }
    } else {
      let r;
      if (step.type === 'multi') {
        assert.equal(ev.kind, 'standard', 'plain 11-draws only on banners without guaranteed');
        r = sim.multi(ev, pos.n, pos.track, last, 11);
        assert.ok(r, `step ${step.index}: 11-draw must exist`);
        assert.equal(r.cats.length, 11);
        food += d11 ? COST.multiDiscount : COST.multi;
        d11 = false;
      } else {
        assert.equal(ev.kind, step.type, `${step.type} only on ${step.type} banners`);
        const g = sim.guaranteed(ev, pos.n, pos.track, last);
        assert.ok(g, `step ${step.index}: ${step.type} must exist`);
        r = { cats: [...g.cats, g.uber], landed: g.landed, next: g.next };
        if (step.type === 'stepup') {
          assert.equal(r.cats.length, 15);
          food += COST.stepup;
        } else {
          assert.equal(r.cats.length, 11);
          food += d11 ? COST.multiDiscount : COST.multi;
          d11 = false;
        }
      }
      collect(r.cats, r.landed);
      rolled.push(...r.cats.map((c) => c.id));
      last = rolled[rolled.length - 1];
      pos = r.next;
    }
    assert.deepEqual(rolled, step.cats.map((c) => c.id), `step ${step.index}: cats match`);
    assert.equal(`${pos.n}${pos.track}`, step.to, `step ${step.index}: ends at ${step.to}`);
  }

  assert.equal(route.totals.foodUsed, food, 'food total');
  assert.equal(route.totals.ticketsUsed, ticketsUsed, 'tickets total');
  for (const t of route.targets) {
    const { ids } = ctx.targets.find((x) => x.query === t.query);
    assert.equal(t.obtained, [...ids].some((id) => obtained.has(id)), `target ${t.query} status`);
  }
  assert.equal(route.complete, route.targets.every((t) => t.obtained), 'complete flag');
}

module.exports = { fixture, loadEvents, loadVariant, makeSim, plan, replayRoute };
