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
import { localMinute, minuteOf, nextDayMinute, startsAt, endsAt } from '../public/core/time.js';
import { optimizeRoutes } from '../public/core/optimizer.js';

// Prices in Cat Food (official EN step-up poster; community wiki for the rest).
const PRICE = { single: 150, singleDiscount: 30, eleven: 1500, elevenDiscount: 750, step1: 300, step12: 1050, stepFull: 2100 };
const TICKET = 150; // 1 Rare Ticket = 150 Cat Food, to compare routes
const STEP_RESET = 30; // minutes until a step-up is back at step 1

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
  const { resolved } = resolveTargets(withAliases([...new Set(queries)], catalog), events, sim.obtainableIds());
  const discount11 = resources || rand() < 0.4;
  return {
    sim, events, targets: resolved,
    inventory: { tickets: resources ? int(2, 5) : pick([0, 0, 1, 2, 4]), food: pick([0, 150, 300, 1500, 3000, 100000]), lastCat: 0 },
    discounts: { guaranteed: discount11, single: resources || rand() < 0.4, spendMulti: discount11 && rand() < 0.5 },
    protect: { avoidLegend, avoidLegendFest: false },
    from, now: minuteOf(now), to,
  };
}

/** Every state the game allows from the start, each with the least Cat Food that reaches it. */
function exhaustive(ctx) {
  const { sim, events, targets, inventory, discounts, protect } = ctx;
  const startSlot = Math.max(localMinute(ctx.from), ctx.now);
  const endSlot = nextDayMinute(ctx.to) - 1;
  const windows = events.map((ev) => ({ first: startsAt(ev), last: Math.max(endsAt(ev) - 1, startsAt(ev)) }));
  const bitsOf = (cat, cell) => {
    if ((protect.avoidLegend || protect.avoidLegendFest) && cat.rarity !== 'legendary' && sim.isProtected(cell.n, cell.track, protect)) return 0;
    let bits = 0;
    targets.forEach((t, i) => {
      if (t.ids.has(cat.id)) bits |= 1 << i;
    });
    return bits;
  };
  // Rolls only move forward along the seed: states are visited in seed order.
  const order = (s) => 2 * s.n + (s.track === 'B' ? 1 : 0);
  const keyOf = (s) => [s.n, s.track, s.last, s.mask, s.tl, +s.d11, +s.d1, s.slot, s.su > s.slot ? s.su : 0].join('|');
  const buckets = [];
  const best = new Map();
  const reach = (s) => {
    const key = keyOf(s);
    const old = best.get(key);
    if (old && old.food <= s.food) return;
    best.set(key, s);
    (buckets[order(s)] ||= []).push(s);
  };
  reach({ n: sim.start.n, track: sim.start.track, last: inventory.lastCat, mask: 0, tl: inventory.tickets, d11: discounts.guaranteed, d1: discounts.single, slot: startSlot, su: 0, food: 0 });

  for (let p = 0; p < buckets.length; p++) {
    for (const s of buckets[p] || []) {
      if (best.get(keyOf(s)) !== s) continue; // beaten by a cheaper way to the same state
      events.forEach((ev, ei) => {
        const w = windows[ei];
        const options = [{ kind: 'single' }];
        if (ev.kind === 'standard') options.push({ kind: 'eleven', rolls: 11 });
        if (ev.kind === 'guaranteed') options.push({ kind: 'eleven', guaranteed: true });
        if (ev.kind === 'stepup') options.push({ kind: 'step', rolls: 3, price: PRICE.step1 }, { kind: 'step', rolls: 8, price: PRICE.step12 }, { kind: 'step', guaranteed: true, price: PRICE.stepFull });
        for (const o of options) {
          let slot = Math.max(s.slot, w.first);
          if (o.kind === 'step') slot = Math.max(slot, s.su);
          if (slot > w.last || slot > endSlot) continue;
          let roll;
          if (o.kind === 'single') {
            const r = sim.single(ev, s.n, s.track, s.last);
            roll = r && { cats: [r.cat], landed: r.landed, next: r.next };
          } else if (o.guaranteed) {
            const g = sim.guaranteed(ev, s.n, s.track, s.last);
            roll = g && { cats: [...g.cats, g.uber], landed: g.landed, next: g.next };
          } else roll = sim.multi(ev, s.n, s.track, s.last, o.rolls);
          if (!roll) continue;
          const next = { ...s, n: roll.next.n, track: roll.next.track, last: roll.cats.at(-1).id, slot };
          roll.cats.forEach((c, i) => {
            next.mask |= bitsOf(c, roll.landed[i]);
          });
          if (o.kind === 'single') {
            // Rare Tickets must be spent before Cat Food on singles.
            if (s.tl > 0) next.tl--;
            else if (s.d1) (next.d1 = false), (next.food += PRICE.singleDiscount);
            else next.food += PRICE.single;
          } else if (o.kind === 'eleven') {
            if (s.d11) (next.d11 = false), (next.food += PRICE.elevenDiscount);
            else next.food += PRICE.eleven;
          } else {
            next.food += o.price; // Rare Tickets cannot pay for step-up steps
            next.su = o.guaranteed ? 0 : slot + STEP_RESET;
          }
          reach(next);
        }
      });
    }
  }
  return [...best.values()];
}

const found = (s) => {
  let n = 0;
  for (let m = s.mask; m; m >>= 1) n += m & 1;
  return n;
};
const CRITERIA = {
  optimal: (s, t) => [s.food + t * TICKET, s.food],
  saveFood: (s, t) => [s.food, t],
  saveTickets: (s, t) => [t, s.food],
};
const lexLess = (a, b) => a[0] - b[0] || a[1] - b[1];

/**
 * What each criterion must show, from first principles: the cheapest route
 * getting every target within the Cat Food there is; else the cheapest one
 * getting them all over it; else the cheapest getting the most targets. With
 * «Incluirlo siempre», a route that also spends the 11-draw discount if any can.
 */
function expected(ctx, states, criterion) {
  const full = (1 << ctx.targets.length) - 1;
  const used = (s) => ctx.inventory.tickets - s.tl;
  const cost = (s) => CRITERIA[criterion](s, used(s));
  const cheapest = (list) => list.reduce((a, s) => (!a || lexLess(cost(s), cost(a)) < 0 ? s : a), null);
  const complete = (list) => {
    const all = list.filter((s) => s.mask === full);
    const spent = all.filter((s) => !s.d11);
    return cheapest(ctx.discounts.spendMulti && spent.length ? spent : all);
  };
  const affordable = states.filter((s) => s.food <= ctx.inventory.food);
  const best = complete(affordable) || complete(states);
  if (best) return { complete: true, found: ctx.targets.length, cost: cost(best) };
  const most = (list) => Math.max(...list.map(found));
  const pool = most(states) > most(affordable) ? states : affordable;
  const top = most(pool);
  return { complete: false, found: top, cost: top ? cost(cheapest(pool.filter((s) => found(s) === top))) : null };
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

// OPTIMALITY_CASES and OPTIMALITY_SEED run more (or other) cases, for a deeper check by hand.
const CASES = Number(process.env.OPTIMALITY_CASES) || 400;
const SEED = Number(process.env.OPTIMALITY_SEED) || 20261017;

test(`every route shown costs exactly the least that the game allows (exhaustive search, ${CASES} cases)`, (t) => {
  let complete = 0;
  let partial = 0;
  for (const [i, ctx] of cases(SEED, CASES).entries()) {
    const states = exhaustive(ctx);
    const routes = optimizeRoutes(ctx);
    for (const criterion of Object.keys(CRITERIA)) {
      const want = expected(ctx, states, criterion);
      const route = routes.find((r) => r.key === criterion);
      const where = `case ${i} (${ctx.events.length} banners, ${ctx.sim.maxN} rows, ${ctx.targets.length} targets, ${JSON.stringify(ctx.inventory)}, ${JSON.stringify(ctx.discounts)}, legend ${ctx.protect.avoidLegend}), ${criterion}`;
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
      if (want.complete) complete++;
      else partial++;
    }
  }
  t.diagnostic(`${complete} complete and ${partial} partial routes checked`);
  // The cases must exercise both kinds of answer, or the test proves little.
  assert.ok(complete > CASES / 4 && partial > CASES / 4, `complete ${complete}, partial ${partial}`);
});
