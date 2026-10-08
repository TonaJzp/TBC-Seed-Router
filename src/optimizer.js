'use strict';

const { keyOf, BANNER, MULTI_SIZE } = require('./simulator');

const COST = {
  single: 150,
  singleDiscount: 50,
  multi: 1500, // 11-draw, guaranteed or not
  multiDiscount: 750,
  stepup: 2100, // 300 + 750 + 1050
};
// As in the game, a Rare Ticket replaces exactly one 150 Cat Food single.
const TICKET_VALUE = COST.single;
const MAX_EXPANSIONS = 2_000_000;
const DAY_MS = 86_400_000;

const toDay = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// Time is measured in half-day slots: 2d = day d before the daily event
// rollover, 2d + 1 = after it. An event "S ~ E" is active from the second half
// of S to the first half of E, so an event ending on day D and one starting on
// day D are never active together: once the new one is rolled, the old one is
// gone. The current slot never goes back.
function eventWindow(start, end) {
  const first = 2 * toDay(start) + 1;
  return { first, last: Math.max(2 * toDay(end), first) };
}

/** Slot at which `ev` can be rolled when the route is at `slot`, or null. */
function rollSlot(slot, ev, rangeEndSlot) {
  const s = Math.max(slot, ev.firstSlot);
  return s <= ev.lastSlot && s <= rangeEndSlot ? s : null;
}

/** Cat Food equivalent of a route: 1 Rare Ticket = 150 Cat Food. */
const totalCost = (c) => c.food + c.tickets * TICKET_VALUE;

// Each objective is a lexicographic order of costs. The first one is the main
// result; the others are alternatives that push one resource to the extreme.
const OBJECTIVES = {
  optimal: {
    label: 'Ruta recomendada',
    description: 'Menor gasto total de recursos (1 Rare Ticket = 150 Cat Food). A igual coste, gasta menos Cat Food.',
    priority: (c) => [totalCost(c), c.food, c.pulls, c.switches],
  },
  saveFood: {
    label: 'Máximo ahorro de Cat Food',
    description: 'Gasta la mínima Cat Food posible, aunque use más Rare Tickets o más tiros.',
    priority: (c) => [c.food, c.tickets, c.pulls, c.switches],
  },
  saveTickets: {
    label: 'Máximo ahorro de Rare Tickets',
    description: 'Conserva el máximo de Rare Tickets pagando con Cat Food (11-draws y garantizados).',
    priority: (c) => [c.tickets, c.food, c.pulls, c.switches],
  },
  fastest: {
    label: 'Menos tiros',
    description: 'Avanza lo mínimo en la semilla (deja más tiros futuros intactos), cueste lo que cueste.',
    priority: (c) => [c.pulls, totalCost(c), c.switches],
  },
};

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
const baseKey = (s) => `${s.n}${s.track}|${s.last}|${s.tl}|${+s.d11}${+s.d1}|${s.slot}`;
const isSubset = (a, b) => (a & b) === a;

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
      return ['stepup'];
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
    case 'stepup':
      return { food: COST.stepup, ticket: false, discount: false };
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
 */
function findRoute(ctx, objectiveKey, { enforceBudget }) {
  const { sim, events, targets, inventory, discounts, protect } = ctx;
  const objective = OBJECTIVES[objectiveKey];
  const priorityOf = (node) => objective.priority(node, ctx);
  const fullMask = (1n << BigInt(targets.length)) - 1n;
  const maskById = new Map();
  targets.forEach((t, i) => {
    for (const id of t.ids) maskById.set(id, (maskById.get(id) || 0n) | (1n << BigInt(i)));
  });

  const nodes = [];
  const labels = new Map(); // baseKey -> [{ mask, pr, idx }] non-dominated states
  const heap = new MinHeap();

  // The last cat only matters if it could be duplicated by the very next roll,
  // i.e. if some banner has it at the current position.
  const canonicalLast = (node) => (sim.rawIdsAt(node.n, node.track).has(node.last) ? node.last : 0);

  // A state is dominated by another at the same base state that already has a
  // superset of the targets for a lower or equal cost: every continuation costs
  // the same from both, so the dominated one can never be strictly better.
  const push = (node) => {
    node.last = canonicalLast(node);
    const key = baseKey(node);
    const pr = priorityOf(node);
    let list = labels.get(key);
    if (!list) labels.set(key, (list = []));
    for (const l of list) if (compare(l.pr, pr) <= 0 && isSubset(node.mask, l.mask)) return;
    const kept = [];
    for (const l of list) {
      if (compare(pr, l.pr) <= 0 && isSubset(l.mask, node.mask)) nodes[l.idx].dead = true;
      else kept.push(l);
    }
    nodes.push(node);
    kept.push({ mask: node.mask, pr, idx: nodes.length - 1 });
    labels.set(key, kept);
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
    n: 1, track: 'A', last: inventory.lastCat, mask: 0n, found: 0,
    tl: inventory.tickets, d11: discounts.guaranteed, d1: discounts.single,
    slot: ctx.startSlot, food: 0, tickets: 0, pulls: 0, switches: 0, ev: -1, parent: -1, step: null,
  });

  let bestPartial = 0;
  let expansions = 0;
  while (heap.size) {
    const idx = heap.pop();
    const node = nodes[idx];
    if (node.dead) continue;
    if (node.mask === fullMask) return { node: idx, nodes, expansions, complete: true };
    // Dijkstra pops in cost order: the first node reaching a new count is the cheapest one.
    if (node.found > nodes[bestPartial].found) bestPartial = idx;
    if (++expansions > MAX_EXPANSIONS) return { node: bestPartial, nodes, expansions, exhausted: true };

    // Try the banner already in use first so equal-cost ties keep it.
    const order = node.ev >= 0 ? [node.ev, ...events.keys()].filter((e, i, a) => a.indexOf(e) === i) : [...events.keys()];
    for (const ei of order) {
      const ev = events[ei];
      const slot = rollSlot(node.slot, ev, ctx.endSlot);
      if (slot === null) continue;
      for (const type of actionsFor(ev)) {
        const roll = performAction(sim, ev, type, node);
        if (!roll) continue;
        const price = priceOf(type, node);
        const next = {
          n: roll.next.n, track: roll.next.track, last: roll.cats[roll.cats.length - 1].id,
          ...withCats(node, roll),
          tl: price.ticket ? node.tl - 1 : node.tl,
          d11: (type === 'multi' || type === 'guaranteed') && price.discount ? false : node.d11,
          d1: type === 'single' && price.discount ? false : node.d1,
          slot, food: node.food + price.food, tickets: node.tickets + (price.ticket ? 1 : 0),
          pulls: node.pulls + roll.cats.length,
          switches: node.switches + (node.ev >= 0 && node.ev !== ei ? 1 : 0),
          ev: ei, parent: idx,
          step: { ei, type, useTicket: price.ticket, useDiscount: price.discount, food: price.food },
        };
        if (!enforceBudget || next.food <= inventory.food) push(next);
      }
    }
  }
  return { node: bestPartial, nodes, expansions };
}

function paymentLabel(step) {
  if (step.useTicket) return '1 Rare Ticket';
  const extra = step.useDiscount ? ' (descuento)' : step.type === 'stepup' ? ' (300+750+1050)' : '';
  return `${step.food} Cat Food${extra}`;
}

function describeRoute(ctx, result) {
  const { sim, events, targets, inventory } = ctx;
  const chain = [];
  // nodes[0] is always the start node of the search.
  for (let i = result.node; i > 0; i = result.nodes[i].parent) chain.push(result.nodes[i]);
  chain.reverse();

  const obtainedAt = new Map(); // target index -> action number
  const crossings = []; // legend cells the route rolls on
  let prev = result.nodes[0];
  const steps = chain.map((node, i) => {
    const ev = events[node.step.ei];
    const roll = performAction(sim, ev, node.step.type, prev);
    const cats = roll.cats.map((c, ci) => {
      const cell = roll.landed[ci];
      const wanted = targets.some((t) => t.ids.has(c.id));
      const counts = countsAsTarget(sim, ctx.protect, c, cell);
      const hits = counts ? targets.flatMap((t, ti) => (t.ids.has(c.id) ? [ti] : [])) : [];
      const firstTime = hits.filter((ti) => !obtainedAt.has(ti));
      firstTime.forEach((ti) => obtainedAt.set(ti, i));
      const color = legendColorOf(sim, cell, ctx.doubleLegend);
      if (color) crossings.push({ action: i, key: keyOf(cell.n, cell.track), color, eventName: ev.name, got: c });
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
    const step = {
      action: i,
      date: fromDay(Math.floor(node.slot / 2)),
      eventId: ev.id,
      eventName: ev.name,
      type: node.step.type,
      from,
      to,
      trackSwitch: prev.track !== node.track,
      dupeSwitch: cats.some((c) => c.rerolled),
      payment: paymentLabel(node.step),
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

  const end = result.nodes[result.node];
  const count = (type) => steps.filter((s) => s.type === type).length;
  const discountStep = (types) => {
    const s = steps.find((x) => types.includes(x.type) && x.payment.includes('descuento'));
    return s ? stepOfAction.get(s.action) : null;
  };
  const multiStep = discountStep(['multi', 'guaranteed']);
  const singleStep = discountStep(['single']);
  const legendCells = crossings.map((x) => ({
    key: x.key,
    color: x.color,
    step: stepOfAction.get(x.action),
    eventName: x.eventName,
    got: { name: x.got.name, rarity: x.got.rarity },
    legends: sim.legendsAt(parseInt(x.key, 10), x.key.at(-1)),
  }));
  return {
    complete: !!result.complete,
    legendCells,
    discounts: {
      multi: ctx.discounts.guaranteed && {
        step: multiStep,
        reason: multiStep ? null : 'la ruta no hace ningún 11-draw: le sale más barato sin él.',
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
    totals: {
      ticketsUsed: end.tickets,
      foodUsed: end.food,
      totalCost: totalCost(end),
      pulls: end.pulls,
      actions: steps.length,
      singles: count('single'),
      multiDraws: count('multi'),
      guaranteedDraws: count('guaranteed') + count('stepup'),
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
function mergeConsecutiveSingles(steps) {
  const out = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (
      last && last.type === 'single' && s.type === 'single' &&
      last.eventId === s.eventId && last.date === s.date && !last.trackSwitch && !s.trackSwitch &&
      !last.cats.some((c) => c.newTarget) && last.payment === s.payment
    ) {
      last.to = s.to;
      last.count += 1;
      last.ticketsSpent += s.ticketsSpent;
      last.foodSpent += s.foodSpent;
      last.cats.push(...s.cats);
      last.actions.push(s.action);
      continue;
    }
    out.push({ ...s, count: 1, actions: [s.action] });
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

/** Time limits of the plan and of every banner, in half-day slots. */
function prepareContext(ctx) {
  ctx.startSlot = 2 * toDay(ctx.from);
  ctx.endSlot = 2 * toDay(ctx.to) + 1;
  for (const ev of ctx.events) {
    const w = eventWindow(ev.start, ev.end);
    ev.firstSlot = w.first;
    ev.lastSlot = w.last;
  }
  return ctx;
}

/** Runs every objective: the recommended route first, then the alternatives. */
function optimizeRoutes(ctx) {
  prepareContext(ctx);

  const routes = [];
  for (const key of Object.keys(OBJECTIVES)) {
    const t0 = Date.now();
    let result = findRoute(ctx, key, { enforceBudget: true });
    let overBudget = false;
    if (!result.complete && !result.exhausted) {
      const unlimited = findRoute(ctx, key, { enforceBudget: false });
      // Prefer a complete route over budget to an affordable partial one.
      if (unlimited.complete || unlimited.nodes[unlimited.node].found > result.nodes[result.node].found) {
        result = unlimited;
        overBudget = true;
      }
    }
    const base = {
      key,
      recommended: key === 'optimal',
      label: OBJECTIVES[key].label,
      description: OBJECTIVES[key].description,
    };
    if (result.node <= 0) {
      routes.push({
        ...base,
        found: false,
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
      overBudget: overBudget && result.nodes[result.node].food > ctx.inventory.food,
      ...describeRoute(ctx, result),
      ms: Date.now() - t0,
    };
    const twin = routes.find((r) => sameRoute(r, route));
    if (twin) route.sameAs = twin.label;
    else {
      const costTwin = routes.find((r) => r.found && sameOutcome(r, route));
      if (costTwin) route.sameCostAs = costTwin.label;
    }
    routes.push(route);
  }
  return routes;
}

module.exports = {
  optimizeRoutes,
  prepareContext,
  findRoute,
  performAction,
  actionsFor,
  countsAsTarget,
  legendColorOf,
  eventWindow,
  rollSlot,
  toDay,
  totalCost,
  COST,
  OBJECTIVES,
  TICKET_VALUE,
};
