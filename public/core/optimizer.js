import { keyOf, BANNER, MULTI_SIZE } from './simulator.js';
import { localMinute, localParts, nextDayMinute, startsAt, endsAt } from './time.js';

const COST = {
  single: 150,
  singleDiscount: 30,
  multi: 1500, // 11-draw, guaranteed or not
  multiDiscount: 750,
  // Step-up (official EN poster «Increasing Capsules»): step 1 = 3 draws for
  // 300, step 2 = 5 for 750, step 3 = 7 for 1050 with an uber as the 7th. The
  // route may stop after step 1 or 2; Rare Tickets cannot pay for steps.
  stepup1: 300,
  stepup12: 1050, // 300 + 750
  stepup: 2100, // 300 + 750 + 1050
};
// The step-up goes back to step 1 thirty minutes after step 1 is bought (or
// once step 3 is done): only then can the next step-up start.
const STEP_RESET_MINUTES = 30;
// `su` when no step-up has to wait: any time is later (a small integer keeps
// the state compact, where -Infinity would need a boxed number per state).
const NO_WAIT = 0;
const isStepUp = (type) => type.startsWith('stepup');
// As in the game, a Rare Ticket replaces exactly one 150 Cat Food single.
const TICKET_VALUE = COST.single;
const MAX_EXPANSIONS = 2_000_000;
// States one search may store. Memory grows with them (~0.35 KB each), and
// 1.2 M of them end within a 450 MB heap, as on a phone: past it, the search
// stops and says its route is not proven the best (02-DOCS, analysis-load T1).
const MAX_STATES = 1_200_000;
// With «Incluirlo siempre en la ruta», how far the search goes on after the
// first complete route looking for one that also spends it.
const SPEND_SEARCH = 400_000;

// Time is measured in local minutes (time.js). A banner can be rolled from
// the minute it opens to the one before it is gone, so a banner ending at the
// hour another one starts is never active together with it: once the new one
// is rolled, the old one is gone. The current time of a route never goes back.
function eventWindow(ev) {
  const first = startsAt(ev);
  return { first, last: Math.max(endsAt(ev) - 1, first) };
}

/** Slot at which `ev` can be rolled when the route is at `slot`, or null. */
function rollSlot(slot, ev, rangeEndSlot) {
  const s = Math.max(slot, ev.firstSlot);
  return s <= ev.lastSlot && s <= rangeEndSlot ? s : null;
}

/** Cat Food equivalent of a route: 1 Rare Ticket = 150 Cat Food. */
const totalCost = (c) => c.food + c.tickets * TICKET_VALUE;

// Each objective is a lexicographic order of costs. The first one is normally
// the recommended route (see pickRecommended); the others are alternatives
// that push one resource to the extreme.
// Ties go to the route with fewer banner changes, then to the one that can be
// done sooner (`switches` and `slot` are always the last two, see dominates).
const OBJECTIVES = {
  optimal: {
    label: 'Menor coste total',
    description: 'Menor gasto total de recursos (1 Rare Ticket = 150 Cat Food). A igual coste, gasta menos Cat Food.',
    priority: (c) => [totalCost(c), c.food, c.pulls, c.switches, c.slot],
  },
  saveFood: {
    label: 'Máximo ahorro de Cat Food',
    description: 'Gasta la mínima Cat Food posible, aunque use más Rare Tickets o más tiros.',
    priority: (c) => [c.food, c.tickets, c.pulls, c.switches, c.slot],
  },
  saveTickets: {
    label: 'Máximo ahorro de Rare Tickets',
    description: 'Conserva el máximo de Rare Tickets pagando con Cat Food (11-draws y garantizados).',
    priority: (c) => [c.tickets, c.food, c.pulls, c.switches, c.slot],
  },
  // Not shown as a route (it is almost always the recommended one); the
  // diagnostics use it to tell whether two targets can be reached together.
  fastest: {
    label: 'Menos tiros',
    description: 'Avanza lo mínimo en la semilla, cueste lo que cueste.',
    priority: (c) => [c.pulls, totalCost(c), c.switches, c.slot],
  },
};
const SHOWN_ROUTES = ['optimal', 'saveFood', 'saveTickets'];
const SWITCHES_FROM_END = 2; // position of `switches` in every priority, from the end

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

class MinHeap {
  constructor() {
    this.p = [];
    this.v = [];
  }
  get size() {
    return this.p.length;
  }
  push(priority, value) {
    const { p, v } = this;
    let i = p.length;
    p.push(priority);
    v.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compare(p[parent], priority) <= 0) break;
      p[i] = p[parent];
      v[i] = v[parent];
      i = parent;
    }
    p[i] = priority;
    v[i] = value;
  }
  pop() {
    const { p, v } = this;
    const top = v[0];
    const lastP = p.pop();
    const lastV = v.pop();
    if (p.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= p.length) break;
        if (c + 1 < p.length && compare(p[c + 1], p[c]) < 0) c++;
        if (compare(p[c], lastP) >= 0) break;
        p[i] = p[c];
        v[i] = v[c];
        i = c;
      }
      p[i] = lastP;
      v[i] = lastV;
    }
    return top;
  }
}

function popcount(mask) {
  let n = 0;
  for (let m = mask; m; m >>= 1n) if (m & 1n) n++;
  return n;
}

// The targets mask is left out: states sharing everything else are compared by
// dominance instead (see push in findRoute).
// `su`: when the next step-up can start, if that is still to come.
const baseKey = (s) => `${s.n}${s.track}|${s.last}|${s.tl}|${+s.d11}${+s.d1}|${s.slot}|${s.su > s.slot ? s.su : ''}`;
const isSubset = (a, b) => (a & b) === a;

/**
 * True if state `a` (priority `pa`) is at least as good as `b` (priority `pb`)
 * for every continuation, both at the same base state. The banner each one is
 * in is not part of that state: from another banner, `a` may need one banner
 * change more than `b` to continue the same way, so it only wins counting it.
 */
function dominates(a, pa, b, pb) {
  if (!isSubset(b.mask, a.mask)) return false;
  if (a.ev === b.ev) return compare(pa, pb) <= 0;
  // `pa` with one banner change more, compared in place.
  const switches = pa.length - SWITCHES_FROM_END;
  for (let i = 0; i < pa.length; i++) {
    const x = i === switches ? pa[i] + 1 : pa[i];
    if (x !== pb[i]) return x < pb[i];
  }
  return true;
}

// From this many states at one base state on, they are indexed by target.
const INDEX_FROM = 64;

/** Positions of the targets in a mask. */
function targetsOf(mask) {
  const out = [];
  for (let m = mask, t = 0; m; m >>= 1n, t++) if (m & 1n) out.push(t);
  return out;
}

const doubled = (words) => {
  const out = new Uint32Array(words.length * 2);
  out.set(words);
  return out;
};

/**
 * The non-dominated states at one base state (indexes in `nodes`), in order
 * of arrival; -1 where one was beaten. Asking whether a state is dominated, or
 * which ones it dominates, gives the same answer as checking every state with
 * `dominates`: once there are many, an index by target leaves out only states
 * whose targets rule them out (a state can only be dominated by one with every
 * target it has, and only dominate one with no target it lacks), and
 * `dominates` decides on the rest.
 */
class LabelSet {
  constructor(targets, indexFrom) {
    this.targets = targets;
    this.indexFrom = indexFrom;
    this.slots = [];
    this.alive = null; // bit per slot: still in the set
    this.has = null; // per target, bit per slot: its state has that target
  }

  /** Adds state `nodes[idx]`. */
  add(nodes, idx) {
    const slot = this.slots.length;
    this.slots.push(idx);
    if (this.alive) this.index(slot, nodes[idx].mask);
    else if (this.slots.length >= this.indexFrom) {
      // Starts the index with the states still in the set.
      this.alive = new Uint32Array(1);
      this.has = Array.from({ length: this.targets }, () => new Uint32Array(1));
      this.slots.forEach((i, s) => {
        if (i >= 0) this.index(s, nodes[i].mask);
      });
    }
  }

  index(slot, mask) {
    const w = slot >>> 5;
    if (w >= this.alive.length) {
      this.alive = doubled(this.alive);
      this.has = this.has.map(doubled);
    }
    const bit = 1 << (slot & 31);
    this.alive[w] |= bit;
    for (const t of targetsOf(mask)) this.has[t][w] |= bit;
  }

  /** True if some state of the set dominates `node` (priority `pr`). */
  dominated(nodes, node, pr) {
    const { slots } = this;
    if (!this.alive) {
      for (const idx of slots) if (idx >= 0 && dominates(nodes[idx], nodes[idx].pr, node, pr)) return true;
      return false;
    }
    const need = targetsOf(node.mask).map((t) => this.has[t]);
    return this.someIn(need, false, (idx) => dominates(nodes[idx], nodes[idx].pr, node, pr));
  }

  /**
   * Drops the states `node` (priority `pr`) dominates. One still waiting in
   * the heap is dropped from `nodes` too (nothing points to it yet); one
   * already expanded stays there: its successors point to it.
   */
  dropDominatedBy(nodes, node, pr) {
    const { slots } = this;
    const drop = (slot) => {
      const idx = slots[slot];
      if (!dominates(node, pr, nodes[idx], nodes[idx].pr)) return;
      if (!nodes[idx].done) nodes[idx] = null;
      slots[slot] = -1;
      if (this.alive) this.alive[slot >>> 5] &= ~(1 << (slot & 31));
    };
    if (!this.alive) {
      for (let slot = 0; slot < slots.length; slot++) if (slots[slot] >= 0) drop(slot);
      return;
    }
    const inMask = new Set(targetsOf(node.mask));
    const lacking = this.has.filter((_, t) => !inMask.has(t));
    this.someIn(lacking, true, (idx, slot) => drop(slot));
  }

  /**
   * Calls `check(idx, slot)` on every state still in the set that has all the
   * targets of `bits` (or, with `without`, none of them) until it returns true.
   */
  someIn(bits, without, check) {
    const words = (this.slots.length + 31) >>> 5;
    for (let w = 0; w < words; w++) {
      let x = this.alive[w];
      for (let i = 0; x && i < bits.length; i++) x &= without ? ~bits[i][w] : bits[i][w];
      while (x) {
        const low = x & -x;
        const slot = (w << 5) + 31 - Math.clz32(low);
        x ^= low;
        if (check(this.slots[slot], slot)) return true;
      }
    }
    return false;
  }
}

/**
 * Protected cells (purple, or lilac during double-legend events) are kept for
 * legendaries: rolls may land on them, but a target cat rolled there only
 * counts if it is itself a legendary.
 */
function countsAsTarget(sim, protect, cat, cell) {
  if (!(protect.avoidLegend || protect.avoidLegendFest)) return true;
  return cat.rarity === 'legendary' || !sim.isProtected(cell.n, cell.track, protect);
}

/** Legend-coloured cell worth flagging: purple always, lilac only with a double-legend event. */
function legendColorOf(sim, cell, doubleLegend) {
  const colors = sim.legendColorsAt(cell.n, cell.track);
  if (colors.has('legend')) return 'morada';
  if (doubleLegend && colors.has('legend_fest')) return 'lila';
  return null;
}

/** The rolls an action performs, recomputed from the state it starts in. */
function performAction(sim, ev, type, state) {
  const { n, track, last } = state;
  switch (type) {
    case 'single': {
      const s = sim.single(ev, n, track, last);
      return s && { cats: [{ ...s.cat, rerolled: s.rerolled }], landed: s.landed, next: s.next };
    }
    case 'multi':
      return sim.multi(ev, n, track, last, MULTI_SIZE);
    case 'stepup1':
      return sim.multi(ev, n, track, last, 3);
    case 'stepup12':
      return sim.multi(ev, n, track, last, 8);
    case 'guaranteed':
    case 'stepup': {
      const g = sim.guaranteed(ev, n, track, last);
      return g && { cats: [...g.cats, g.uber], landed: g.landed, next: g.next };
    }
    default:
      throw new Error(`Acción desconocida: ${type}`);
  }
}

/** Actions a banner offers, by kind. */
function actionsFor(ev) {
  switch (ev.kind) {
    case BANNER.standard:
      return ['single', 'multi'];
    case BANNER.guaranteed:
      return ['single', 'guaranteed'];
    case BANNER.stepup:
      // The step-up replaces the 11-draw; single draws stay.
      return ['single', 'stepup1', 'stepup12', 'stepup'];
    default:
      return [];
  }
}

/** Price of an action in a given state: { food, ticket, discount }. */
function priceOf(type, state) {
  switch (type) {
    case 'single':
      if (state.tl > 0) return { food: 0, ticket: true, discount: false };
      return state.d1
        ? { food: COST.singleDiscount, ticket: false, discount: true }
        : { food: COST.single, ticket: false, discount: false };
    case 'multi':
    case 'guaranteed':
      return state.d11
        ? { food: COST.multiDiscount, ticket: false, discount: true }
        : { food: COST.multi, ticket: false, discount: false };
    case 'stepup1':
    case 'stepup12':
    case 'stepup':
      return { food: COST[type], ticket: false, discount: false };
    default:
      throw new Error(`Acción desconocida: ${type}`);
  }
}

/**
 * Finds the cheapest route (for one objective) that obtains every target cat.
 * If no route gets all of them, returns the cheapest one getting the most.
 *
 * A node is the game state: seed position, last cat (only matters for duplicate
 * rares), targets obtained (bitmask, any number of targets), tickets left,
 * one-shot discounts left and the current time slot.
 *
 * `ctx.maxStates` (MAX_STATES by default) bounds the states stored: past it,
 * the search ends `exhausted`, like past MAX_EXPANSIONS.
 */
function findRoute(ctx, objectiveKey, { enforceBudget, indexFrom = INDEX_FROM }) {
  const { sim, events, targets, inventory, discounts, protect } = ctx;
  const maxStates = ctx.maxStates ?? MAX_STATES;
  const objective = OBJECTIVES[objectiveKey];
  const priorityOf = (node) => objective.priority(node, ctx);
  const fullMask = (1n << BigInt(targets.length)) - 1n;
  const maskById = new Map();
  targets.forEach((t, i) => {
    for (const id of t.ids) maskById.set(id, (maskById.get(id) || 0n) | (1n << BigInt(i)));
  });

  const nodes = [];
  const labels = new Map(); // baseKey -> LabelSet of the non-dominated states there
  const heap = new MinHeap();

  // The last cat only matters if it could be duplicated by the very next roll,
  // i.e. if some banner has it at the current position.
  const canonicalLast = (node) => (sim.rawIdsAt(node.n, node.track).has(node.last) ? node.last : 0);

  // A state is dominated by another at the same base state that already has a
  // superset of the targets for a lower or equal cost, counting the banner
  // change it may still need: the dominated one can never be strictly better.
  const push = (node) => {
    node.last = canonicalLast(node);
    const key = baseKey(node);
    const pr = priorityOf(node);
    let set = labels.get(key);
    if (!set) labels.set(key, (set = new LabelSet(targets.length, indexFrom)));
    if (set.dominated(nodes, node, pr)) return;
    set.dropDominatedBy(nodes, node, pr);
    node.pr = pr;
    nodes.push(node);
    set.add(nodes, nodes.length - 1);
    heap.push(pr, nodes.length - 1);
  };
  const withCats = (node, roll) => {
    let mask = node.mask;
    roll.cats.forEach((c, i) => {
      if (countsAsTarget(sim, protect, c, roll.landed[i])) mask |= maskById.get(c.id) || 0n;
    });
    return mask === node.mask ? { mask, found: node.found } : { mask, found: popcount(mask) };
  };

  push({
    n: sim.start.n, track: sim.start.track, last: inventory.lastCat, mask: 0n, found: 0,
    tl: inventory.tickets, d11: discounts.guaranteed, d1: discounts.single,
    su: NO_WAIT, slot: ctx.startSlot, food: 0, tickets: 0, pulls: 0, switches: 0, ev: -1, parent: -1, type: null,
    pr: null, done: false,
  });

  // «Incluirlo siempre en la ruta» (11-draw at 750): the game does not stack this discount
  // (a new one replaces the one you still have), so the route only counts as
  // finished once it has spent it. If no route can, the first complete one
  // is kept and the page says why the discount was not used.
  const mustSpend = !!(discounts.guaranteed && discounts.spendMulti);
  let firstComplete = -1;
  let completeAt = 0;
  // The result keeps only the path to the chosen node: the hundreds of
  // thousands of states explored are freed as soon as the search returns.
  const done = (idx, flags = {}) => {
    const path = [];
    for (let i = idx; i >= 0; i = nodes[i].parent) path.push(nodes[i]);
    path.reverse();
    // Each explored state keeps only its action; the path rebuilds the rest
    // of each step from the state before it.
    path[0].step = null;
    for (let i = 1; i < path.length; i++) {
      const node = path[i];
      const prev = path[i - 1];
      const multi = node.type === 'multi' || node.type === 'guaranteed';
      node.step = {
        ei: node.ev,
        type: node.type,
        useTicket: node.tickets > prev.tickets,
        useDiscount: (node.type === 'single' && prev.d1 && !node.d1) || (multi && prev.d11 && !node.d11),
        food: node.food - prev.food,
      };
    }
    return { path, expansions, budgetCut, ...flags };
  };
  const unspent = () => done(firstComplete, { complete: true, unspent: true });

  let bestPartial = 0;
  let expansions = 0;
  let budgetCut = false; // some roll was left out for costing more Cat Food than there is
  while (heap.size) {
    const idx = heap.pop();
    const node = nodes[idx];
    if (!node) continue; // beaten while it waited
    node.done = true;
    if (node.mask === fullMask) {
      if (!mustSpend || !node.d11) return done(idx, { complete: true });
      if (firstComplete < 0) {
        firstComplete = idx;
        completeAt = expansions;
      }
    }
    // Dijkstra pops in cost order: the first node reaching a new count is the cheapest one.
    if (node.found > nodes[bestPartial].found) bestPartial = idx;
    if (++expansions > MAX_EXPANSIONS || nodes.length > maxStates) {
      return firstComplete >= 0 ? unspent() : done(bestPartial, { exhausted: true });
    }
    if (firstComplete >= 0 && expansions - completeAt > SPEND_SEARCH) return unspent();

    // Try the banner already in use first so equal-cost ties keep it.
    const order = node.ev >= 0 ? [node.ev, ...events.keys()].filter((e, i, a) => a.indexOf(e) === i) : [...events.keys()];
    for (const ei of order) {
      const ev = events[ei];
      const now = rollSlot(node.slot, ev, ctx.endSlot);
      if (now === null) continue;
      for (const type of actionsFor(ev)) {
        // A step-up may have to wait until the previous one is back at step 1.
        const slot = isStepUp(type) && node.su > node.slot ? rollSlot(node.su, ev, ctx.endSlot) : now;
        if (slot === null) continue;
        const roll = performAction(sim, ev, type, node);
        if (!roll) continue;
        const price = priceOf(type, node);
        const next = {
          n: roll.next.n, track: roll.next.track, last: roll.cats[roll.cats.length - 1].id,
          ...withCats(node, roll),
          tl: price.ticket ? node.tl - 1 : node.tl,
          d11: (type === 'multi' || type === 'guaranteed') && price.discount ? false : node.d11,
          d1: type === 'single' && price.discount ? false : node.d1,
          su: type === 'stepup1' || type === 'stepup12' ? slot + STEP_RESET_MINUTES : type === 'stepup' ? NO_WAIT : node.su,
          slot, food: node.food + price.food, tickets: node.tickets + (price.ticket ? 1 : 0),
          pulls: node.pulls + roll.cats.length,
          switches: node.switches + (node.ev >= 0 && node.ev !== ei ? 1 : 0),
          ev: ei, parent: idx,
          type,
          pr: null, done: false,
        };
        if (!enforceBudget || next.food <= inventory.food) push(next);
        else budgetCut = true;
      }
    }
  }
  if (firstComplete >= 0) return unspent();
  return done(bestPartial);
}

function paymentLabel(step) {
  if (step.useTicket) return '1 Rare Ticket';
  const extra = step.useDiscount ? ' (descuento)' : { stepup: ' (300+750+1050)', stepup12: ' (300+750)', stepup1: ' (paso 1)' }[step.type] || '';
  return `${step.food} Cat Food${extra}`;
}

/**
 * Whether the link to the roll at (n, track) after cat `last` must start
 * godfat's table at that cell, with `last`. godfat draws re-rolls along its
 * own table (`ev.alt`: a rare under a copy of itself, or where a re-roll
 * lands on one) and takes `last` only at 1A. After a guaranteed uber, a cat
 * from another banner or the start of a `pos` URL, it may draw a re-roll the
 * route does not do, or miss one it does.
 */
function needsLastLink(ev, n, track, last) {
  if (n === 1 && track === 'A') return false;
  const key = keyOf(n, track);
  const raw = ev.raw[key];
  const rerolls = !!raw && raw.id === last && ev.rarityOf.get(raw.id) === 'rare';
  return rerolls !== !!ev.alt[key];
}

function describeRoute(ctx, result) {
  const { sim, events, targets, inventory } = ctx;
  // path[0] is always the start node of the search.
  const chain = result.path.slice(1);

  const obtainedAt = new Map(); // target index -> action number
  const hitActions = targets.map(() => new Set()); // target index -> every action where it counts
  const crossings = []; // legend cells the route rolls on
  let prev = result.path[0];
  const steps = chain.map((node, i) => {
    const ev = events[node.step.ei];
    const roll = performAction(sim, ev, node.step.type, prev);
    const cats = roll.cats.map((c, ci) => {
      const cell = roll.landed[ci];
      const wanted = targets.some((t) => t.ids.has(c.id));
      const counts = countsAsTarget(sim, ctx.protect, c, cell);
      const hits = counts ? targets.flatMap((t, ti) => (t.ids.has(c.id) ? [ti] : [])) : [];
      hits.forEach((ti) => hitActions[ti].add(i));
      const firstTime = hits.filter((ti) => !obtainedAt.has(ti));
      firstTime.forEach((ti) => obtainedAt.set(ti, i));
      const color = legendColorOf(sim, cell, ctx.doubleLegend);
      if (color) crossings.push({ action: i, single: node.step.type === 'single', slot: node.slot, key: keyOf(cell.n, cell.track), color, eventName: ev.name, got: c });
      return {
        ...c,
        cell: keyOf(cell.n, cell.track),
        legendCell: color,
        target: hits.length > 0,
        newTarget: firstTime.length > 0,
        protectedSkip: wanted && !counts,
      };
    });
    const from = keyOf(prev.n, prev.track);
    const to = keyOf(node.n, node.track);
    // When the step can be done: from its time on, while the banner lasts.
    const at = localParts(node.slot);
    const gone = localParts(ev.lastSlot + 1);
    const step = {
      action: i,
      date: at.date,
      opensAt: node.slot === ev.firstSlot && node.slot > ctx.startSlot ? at.time : null,
      // Waits for the step-up to go back to step 1 (30 minutes after the previous step 1).
      stepUpFrom: isStepUp(node.step.type) && prev.su > prev.slot ? at.time : null,
      slot: node.slot,
      time: at.time,
      closesAt: gone.date === at.date ? gone.time : null,
      eventId: ev.id,
      eventName: ev.name,
      type: node.step.type,
      from,
      to,
      trackSwitch: prev.track !== node.track,
      dupeSwitch: cats.some((c) => c.rerolled),
      // Not started yet when calculating: a game update before it opens can add
      // cats to it, which changes the cells of their rarity (owner, 2026-10-13).
      upcoming: startsAt(ev) > (ctx.now ?? ctx.startSlot),
      // godfat would show the first roll otherwise: link the table from this cell, with `last`.
      godfatFromLast: needsLastLink(ev, prev.n, prev.track, prev.last),
      payment: paymentLabel(node.step),
      discount: !!node.step.useDiscount,
      ticketsSpent: node.step.useTicket ? 1 : 0,
      foodSpent: node.step.food,
      cats,
    };
    prev = node;
    return step;
  });

  const merged = mergeConsecutiveSingles(steps);
  const stepOfAction = new Map();
  for (const s of merged) for (const a of s.actions) stepOfAction.set(a, s.index);

  const end = result.path[result.path.length - 1];
  const count = (type) => steps.filter((s) => s.type === type).length;
  const discountStep = (types) => {
    const s = steps.find((x) => types.includes(x.type) && x.discount);
    return s ? stepOfAction.get(s.action) : null;
  };
  const multiStep = discountStep(['multi', 'guaranteed']);
  const singleStep = discountStep(['single']);
  // What each legend cell gives in every banner that can be rolled at that
  // moment of the route: the legendaries the route could take there instead.
  const activeAt = (slot) => new Set(events.filter((e) => e.firstSlot <= slot && slot <= e.lastSlot).map((e) => e.id));
  const byId = new Map(events.map((e) => [e.id, e]));
  const sameIds = (a, b) => a.cats.map((c) => c.id).join() === b.cats.map((c) => c.id).join() && a.next.n === b.next.n && a.next.track === b.next.track;
  // True if single action i can be rolled in banner `alt` instead, with the
  // rest of the route exactly as it is: same cell after it, and the next
  // action gives the same cats to the same cell (simulated, not assumed).
  const keepsRoute = (i, alt) => {
    const node = chain[i];
    const before = i === 0 ? result.path[0] : chain[i - 1];
    const s = sim.single(alt, before.n, before.track, before.last);
    if (!s || s.next.n !== node.n || s.next.track !== node.track) return false;
    const after = chain[i + 1];
    if (!after) return true;
    const evAfter = events[after.step.ei];
    const original = performAction(sim, evAfter, after.step.type, node);
    const changed = performAction(sim, evAfter, after.step.type, { ...node, last: s.cat.id });
    return !!(original && changed && sameIds(original, changed));
  };
  // A single that gives the route its only copy of a target: rolled in another
  // banner, that target is lost even if every other roll stays the same.
  const onlyTargetAt = (i) => hitActions.some((actions) => actions.size === 1 && actions.has(i));
  const legendCells = crossings.map((x) => {
    const active = activeAt(x.slot);
    const losesTarget = x.single && onlyTargetAt(x.action);
    return {
      key: x.key,
      color: x.color,
      step: stepOfAction.get(x.action),
      eventName: x.eventName,
      inDraw: !x.single,
      got: { id: x.got.id, name: x.got.name, rarity: x.got.rarity },
      legends: sim
        .legendsAt(parseInt(x.key, 10), x.key.at(-1))
        .filter((l) => active.has(l.eventId) && l.id !== x.got.id)
        .map((l) => ({ ...l, sameRoute: x.single && !losesTarget && keepsRoute(x.action, byId.get(l.eventId)), losesTarget })),
    };
  });
  return {
    complete: !!result.complete,
    legendCells,
    discounts: {
      multi: ctx.discounts.guaranteed && {
        step: multiStep,
        spend: !!ctx.discounts.spendMulti,
        reason: multiStep
          ? null
          : ctx.discounts.spendMulti
            ? 'no se ha podido gastar: ningún 11-draw cabe en esta ruta con tus fechas, tus tiros y tu Cat Food.'
            : 'la ruta no hace ningún 11-draw: le sale más barato sin él.',
      },
      single: ctx.discounts.single && {
        step: singleStep,
        reason: singleStep
          ? null
          : end.tl > 0
            ? `te quedan ${end.tl} Rare Tickets al terminar: todos los tiros simples se pagan con tickets.`
            : 'la ruta no hace tiros simples con Cat Food después de gastar los tickets.',
      },
    },
    targets: targets.map((t, ti) => ({
      query: t.query,
      names: t.names,
      obtained: obtainedAt.has(ti),
      step: obtainedAt.has(ti) ? stepOfAction.get(obtainedAt.get(ti)) : null,
    })),
    steps: merged,
    // Banners the route rolls before they open, with the step where it first does.
    upcoming: merged
      .filter((s, i) => s.upcoming && merged.findIndex((x) => x.eventId === s.eventId) === i)
      .map((s) => {
        const ev = events.find((e) => e.id === s.eventId);
        return { eventId: s.eventId, eventName: s.eventName, start: ev.start, startTime: ev.startTime, step: s.index };
      }),
    totals: {
      ticketsUsed: end.tickets,
      foodUsed: end.food,
      totalCost: totalCost(end),
      pulls: end.pulls,
      actions: steps.length,
      singles: count('single'),
      multiDraws: count('multi'),
      guaranteedDraws: count('guaranteed') + count('stepup'),
      stepUpParts: count('stepup1') + count('stepup12'),
      ticketsLeft: inventory.tickets - end.tickets,
      foodLeft: inventory.food - end.food,
      affordable: end.food <= inventory.food,
      shortfall: Math.max(0, end.food - inventory.food),
      usedDiscount11: ctx.discounts.guaranteed && !end.d11,
      usedDiscount1: ctx.discounts.single && !end.d1,
      finalPosition: keyOf(end.n, end.track),
    },
  };
}

// Consecutive singles on the same banner without any jump read better as one block.
// Repeated singles, and repeated steps 1 of a step-up (one every 30 minutes),
// are one row: «3 tiros simples», «paso 1, 4 veces». A row ends where it gets
// a target, so the page shows which roll gives it.
function mergeConsecutiveSingles(steps) {
  const out = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (
      last && (s.type === 'single' || s.type === 'stepup1') && last.type === s.type &&
      last.eventId === s.eventId && last.date === s.date && !last.trackSwitch && !s.trackSwitch &&
      !last.cats.some((c) => c.newTarget) && last.payment === s.payment &&
      (s.type === 'single' || s.slot === last.lastSlot + STEP_RESET_MINUTES)
    ) {
      last.to = s.to;
      last.count += 1;
      last.lastSlot = s.slot;
      last.untilTime = s.time;
      last.dupeSwitch ||= s.dupeSwitch;
      last.ticketsSpent += s.ticketsSpent;
      last.foodSpent += s.foodSpent;
      last.cats.push(...s.cats);
      last.actions.push(s.action);
      continue;
    }
    out.push({ ...s, count: 1, actions: [s.action], lastSlot: s.slot, untilTime: null });
  }
  out.forEach((s, i) => (s.index = i + 1));
  return out;
}

function sameRoute(a, b) {
  if (!a || !b || !a.found || !b.found || a.steps.length !== b.steps.length) return false;
  return a.steps.every(
    (s, i) => s.eventId === b.steps[i].eventId && s.type === b.steps[i].type && s.from === b.steps[i].from
  );
}

function sameOutcome(a, b) {
  const keys = ['ticketsUsed', 'foodUsed', 'pulls'];
  return (
    keys.every((k) => a.totals[k] === b.totals[k]) &&
    a.targets.every((t, i) => t.obtained === b.targets[i].obtained)
  );
}

/**
 * Time limits of the plan and of every banner, in local minutes: from the
 * start of "from" (or now, if later: `ctx.now`) to the end of "to".
 */
function prepareContext(ctx) {
  ctx.startSlot = Math.max(localMinute(ctx.from), ctx.now ?? -Infinity);
  ctx.endSlot = nextDayMinute(ctx.to) - 1;
  for (const ev of ctx.events) {
    const w = eventWindow(ev);
    ev.firstSlot = w.first;
    ev.lastSlot = w.last;
  }
  return ctx;
}

/**
 * The route of one objective: { result, overBudget }. Within the Cat Food
 * there is, or over it if that gets more targets (or all of them).
 */
function search(ctx, key) {
  const result = findRoute(ctx, key, { enforceBudget: true });
  // Without the budget the search only differs if the budget left some roll out.
  if (result.complete || result.exhausted || !result.budgetCut) return { result, overBudget: false };
  const unlimited = findRoute(ctx, key, { enforceBudget: false });
  // Prefer a complete route over budget to an affordable partial one.
  if (unlimited.complete || unlimited.path.at(-1).found > result.path.at(-1).found) return { result: unlimited, overBudget: true };
  // Cut beyond the budget: a route over it with more targets is not ruled out.
  return { result: unlimited.exhausted ? { ...result, exhausted: true } : result, overBudget: false };
}

/** Runs every objective and returns the routes, the recommended one first. */
function optimizeRoutes(ctx) {
  prepareContext(ctx);

  const routes = [];
  // Without Rare Tickets no route spends any, so the shown objectives order
  // every pair of states alike: the same search, done once.
  const searches = new Map();
  for (const [i, key] of SHOWN_ROUTES.entries()) {
    ctx.onProgress?.({ phase: 'route', index: i + 1, total: SHOWN_ROUTES.length, label: OBJECTIVES[key].label });
    const t0 = Date.now();
    const same = ctx.inventory.tickets === 0 ? 'noTickets' : key;
    if (!searches.has(same)) searches.set(same, search(ctx, key));
    const { result, overBudget } = searches.get(same);
    const base = {
      key,
      label: OBJECTIVES[key].label,
      description: OBJECTIVES[key].description,
    };
    if (result.path.length <= 1) {
      routes.push({
        ...base,
        found: false,
        exhausted: !!result.exhausted,
        reason: result.exhausted
          ? 'Búsqueda demasiado grande: reduce el rango de fechas, los tiros a analizar o los gatos objetivo.'
          : 'Ningún gato objetivo es alcanzable con estas restricciones.',
      });
      continue;
    }
    const route = {
      ...base,
      found: true,
      exhausted: !!result.exhausted,
      overBudget: overBudget && result.path.at(-1).food > ctx.inventory.food,
      ...describeRoute(ctx, result),
      ms: Date.now() - t0,
    };
    routes.push(route);
  }
  const ordered = pickRecommended(routes);
  // Each route points to an earlier one it repeats (same rolls) or ties with
  // (same figures), by key, so the page can name it.
  ordered.forEach((route, i) => {
    if (!route.found) return;
    const earlier = ordered.slice(0, i);
    const twin = earlier.find((r) => r.found && sameRoute(r, route));
    if (twin) route.sameAs = twin.key;
    else {
      const costTwin = earlier.find((r) => r.found && sameOutcome(r, route));
      if (costTwin) route.sameCostAs = costTwin.key;
    }
  });
  return ordered;
}

/**
 * The recommended route is the cheapest overall (1 Rare Ticket = 150 Cat
 * Food). But when even that one needs more Cat Food than you have, the one
 * that asks for the least extra Cat Food is recommended instead: it spends
 * your Rare Tickets first. It must get as many targets. Marks it with
 * `recommended` and `recommendedFor` ('cheapest' or 'leastFood') and puts it
 * first.
 */
function pickRecommended(routes) {
  const got = (r) => r.targets.filter((t) => t.obtained).length;
  const cheapest = routes.find((r) => r.key === 'optimal');
  const leanest = routes.find((r) => r.key === 'saveFood');
  const switchToLeanest =
    cheapest?.found && !cheapest.totals.affordable &&
    leanest?.found && got(leanest) >= got(cheapest) &&
    leanest.totals.foodUsed < cheapest.totals.foodUsed;
  // Never a route that was not found: if the cheapest search ran out, the
  // first one found; if none was, none is recommended.
  let pick = switchToLeanest ? leanest : cheapest;
  if (!pick?.found) pick = routes.find((r) => r.found) || null;
  for (const r of routes) r.recommended = r === pick;
  if (pick) pick.recommendedFor = switchToLeanest ? 'leastFood' : pick === cheapest ? 'cheapest' : 'found';
  return [pick, ...routes.filter((r) => r !== pick)].filter(Boolean);
}

export {
  optimizeRoutes,
  pickRecommended,
  needsLastLink,
  prepareContext,
  findRoute,
  performAction,
  actionsFor,
  countsAsTarget,
  legendColorOf,
  eventWindow,
  rollSlot,
  totalCost,
  COST,
  MAX_STATES,
  OBJECTIVES,
  TICKET_VALUE,
};
