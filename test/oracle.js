// The exhaustive search behind test/optimality.test.js: every state the game
// allows, with no dominance, no shortcuts and nothing borrowed from
// optimizer.js, only the simulator (checked against bc.godfat.org every day)
// and the game's rules (02-DOCS game mechanics) written again here.

import { localMinute, nextDayMinute, startsAt, endsAt } from '../public/core/time.js';

// Prices in Cat Food (official EN step-up poster; community wiki for the rest).
const PRICE = { single: 150, singleDiscount: 30, eleven: 1500, elevenDiscount: 750, step1: 300, step12: 1050, stepFull: 2100 };
const TICKET = 150; // 1 Rare Ticket = 150 Cat Food, to compare routes
const STEP_RESET = 30; // minutes until a step-up is back at step 1

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

export { exhaustive, expected, CRITERIA };
