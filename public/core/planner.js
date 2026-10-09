// The whole analysis, in the browser: validates the form, picks the banners of
// the dates, builds their tables for the seed (gacha.js), resolves the target
// cats and computes the routes and the explanations.

import { buildEvents, rarityName, raisesLegend } from './gacha.js';
import { Simulator } from './simulator.js';
import { optimizeRoutes, legendColorOf } from './optimizer.js';
import { diagnose } from './diagnostics.js';
import { describeUnavailable } from './unavailable.js';
import { MIN_ROLLS, DEFAULT_ROLLS, MAX_ROLLS } from './config.js';
import { localMinute, minuteOf, nextDayMinute, startsAt, endsAt, localParts } from './time.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXAMPLE_URL = 'https://bc.godfat.org/?seed=123456789';

const formatDate = (iso) => iso.split('-').reverse().join('/');
const localIsoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Errors meant for the user, in Spanish, as opposed to bugs. */
class UserError extends Error {}

/** Seed (and last cat) from a godfat URL or a plain seed number. */
function parseSeedInput(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d+$/.test(text)) return checkSeed(Number(text), 0);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new UserError(`Pega la URL de tu semilla en godfat (por ejemplo ${EXAMPLE_URL}) o solo el número de semilla.`);
  }
  if (url.hostname !== 'bc.godfat.org') {
    throw new UserError(`La URL debe ser de bc.godfat.org (la web donde ves tu semilla), por ejemplo ${EXAMPLE_URL}`);
  }
  if (!url.searchParams.get('seed')) {
    throw new UserError(`A la URL le falta el número de semilla («?seed=…»). Ábrela en godfat y copia la dirección completa, por ejemplo ${EXAMPLE_URL}`);
  }
  return checkSeed(Number(url.searchParams.get('seed')), Number(url.searchParams.get('last')) || 0);
}

function checkSeed(seed, last) {
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff) {
    throw new UserError('El número de semilla no es válido: debe ser un entero entre 1 y 4294967295.');
  }
  return { seed, last: Number.isInteger(last) && last > 0 ? last : 0 };
}

function parseRequest(body, now = new Date()) {
  const nonNegInt = (v, label) => {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new UserError(`${label} debe ser un entero >= 0.`);
    return n;
  };
  // The picker sends an array of catalogue keys; plain text (comma or line
  // separated) is still accepted.
  const list = Array.isArray(body.targets) ? body.targets : String(body.targets || '').split(/[,\n]/);
  const targets = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  if (!targets.length) throw new UserError('Indica al menos un gato objetivo.');
  if (!ISO_DATE.test(body.from || '') || !ISO_DATE.test(body.to || '')) {
    throw new UserError('El rango de fechas no es válido.');
  }
  if (body.from > body.to) throw new UserError('La fecha inicial es posterior a la final.');
  // Past banners can't be rolled any more: the plan always starts today.
  const today = localIsoDate(now);
  if (body.from < today) {
    throw new UserError(`La fecha inicial no puede ser anterior a hoy (${formatDate(today)}).`);
  }
  const rolls = nonNegInt(body.rolls ?? DEFAULT_ROLLS, 'Tiros a analizar');
  if (rolls < MIN_ROLLS || rolls > MAX_ROLLS) {
    throw new UserError(`Tiros a analizar debe estar entre ${MIN_ROLLS} y ${MAX_ROLLS}.`);
  }
  return {
    seed: parseSeedInput(body.url),
    targets,
    from: body.from,
    to: body.to,
    today,
    now: minuteOf(now),
    rolls,
    tickets: nonNegInt(body.tickets, 'Rare Tickets'),
    food: nonNegInt(body.food, 'Cat Food'),
    discounts: { guaranteed: !!body.discount11, single: !!body.discount1 },
    protect: { avoidLegend: !!body.avoidLegend, avoidLegendFest: !!body.avoidLegendFest },
  };
}

/**
 * Every cat of the data as the picker and the planner see it: the first form
 * names the cat, the other forms are alternative names.
 */
function catalogOf(data) {
  return Object.entries(data.cats)
    .map(([id, c]) => {
      const names = c.names.filter(Boolean);
      const name = names[0] || `#${id}`;
      const rarity = rarityName(c.rarity);
      return {
        key: id,
        id: Number(id),
        name,
        rarity,
        gacha: c.rarity >= 2,
        aliases: [...new Set(names.slice(1))].filter((a) => a.toLowerCase() !== name.toLowerCase()),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/**
 * Looks each query up in the catalogue: by key (the cat id, what the picker
 * sends), else by name (a gacha cat wins if two share the name), else by
 * another form's name.
 */
function withAliases(queries, catalog) {
  const byKey = new Map(catalog.map((c) => [String(c.key), c]));
  const byName = new Map();
  const byAlias = new Map();
  for (const c of catalog) {
    const k = c.name.toLowerCase();
    if (!byName.has(k) || (byName.get(k).gacha === false && c.gacha !== false)) byName.set(k, c);
    for (const a of c.aliases) if (!byAlias.has(a.toLowerCase())) byAlias.set(a.toLowerCase(), c);
  }
  return queries.map((q) => {
    const lower = q.toLowerCase();
    const cat = byKey.get(q) || byName.get(lower) || byAlias.get(lower);
    if (!cat) return { name: q, inCatalog: false, gacha: true, godfatId: null, aliases: [] };
    return { name: cat.name, inCatalog: true, gacha: cat.gacha, rarity: cat.rarity, godfatId: cat.id ?? null, aliases: cat.aliases };
  });
}

/** Cat names (id -> name) of a list of banners. */
function namesOf(events) {
  const names = new Map();
  for (const ev of events) {
    for (const [id, name] of Object.entries(ev.names)) names.set(Number(id), name);
  }
  return names;
}

// Matching order: the catalogue id, exact name, exact alternative name (another
// form of the cat), id typed as text, then partial name (free text only: a
// catalogue cat must never be confused with another one that merely contains
// its name).
function matchIds(query, names) {
  const { name: q, aliases = [], godfatId = null, inCatalog = false } = typeof query === 'string' ? { name: query } : query;
  const all = [...names.keys()];
  const exact = (text) => all.filter((id) => names.get(id).toLowerCase() === text.toLowerCase());
  let ids = godfatId !== null && names.has(godfatId) ? [godfatId] : [];
  if (!ids.length && godfatId === null) ids = exact(q);
  if (!ids.length && godfatId === null) ids = [...new Set(aliases.flatMap(exact))];
  if (!ids.length) ids = all.filter((id) => String(id) === q);
  if (!ids.length && !inCatalog) ids = all.filter((id) => names.get(id).toLowerCase().includes(q.toLowerCase()));
  return ids;
}

// Every target that can't be rolled ends up in `unavailable` with its reason:
//   notGacha     not a gacha cat (Normal / Special)
//   unknownName  free text that matches no known cat
//   notInBanners no banner in the date range has it
//   notInRolls   in some banner, but not within the analysed rolls
function resolveTargets(queries, events, obtainable) {
  const names = namesOf(events);
  const resolved = [];
  const unavailable = [];
  for (const query of queries) {
    const match = typeof query === 'string' ? { name: query } : query;
    const { name: q, inCatalog = false, gacha = true, rarity = null } = match;
    if (!gacha) {
      unavailable.push({ query: q, reason: 'notGacha', rarity });
      continue;
    }
    const ids = matchIds(match, names);
    if (!ids.length) {
      unavailable.push({ query: q, reason: inCatalog ? 'notInBanners' : 'unknownName', match });
      continue;
    }
    const reachable = ids.filter((id) => obtainable.has(id));
    if (!reachable.length) unavailable.push({ query: q, reason: 'notInRolls', ids, match });
    else resolved.push({ query: q, ids: new Set(reachable), names: reachable.map((id) => names.get(id)) });
  }
  return { resolved, unavailable };
}

/**
 * Every legend cell in the analysed rows (purple; lilac only with a double
 * legend event) and the legendaries the banners of the dates give there.
 */
function legendCellsOf(sim, doubleLegend) {
  const cells = [];
  for (const key of sim.legendColors.keys()) {
    const n = parseInt(key, 10);
    const track = key.at(-1);
    const color = legendColorOf(sim, { n, track }, doubleLegend);
    if (color) cells.push({ key, color, legends: sim.legendsAt(n, track) });
  }
  return cells.sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10) || a.key.localeCompare(b.key));
}

// Lilac cells are only Legendary in banners with a raised legend rate
// (Royalfest, double legend...), so protecting them only matters when such a
// banner can still be rolled: one of the dates, or any later announced one.
function detectDoubleLegend(events, upcoming, sim, start) {
  const found = new Map(upcoming.filter((e) => !e.ticket && endsAt(e) > start && raisesLegend(e)).map((e) => [e.id, e]));
  for (const ev of events) {
    for (const [key, c] of Object.entries(ev.raw)) {
      const m = /^(\d+)([AB])$/.exec(key);
      if (sim.legendColorsAt(Number(m[1]), m[2]).has('legend_fest') && ev.rarityOf.get(c.id) === 'legendary') {
        found.set(ev.id, ev);
      }
    }
  }
  return [...found.values()]
    .map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/**
 * The banner that carries on `e` with the very same table (same gacha, rates
 * and kind) from the minute it closes, if any: a step "before 11:00" in `e`
 * can just as well be done later in it. Returns { id, end, endTime } or null.
 */
function continuationOf(data, e) {
  const next = data.events.find(
    (x) => x.id !== e.id && x.gacha === e.gacha && startsAt(x) === endsAt(e) && !x.ticket &&
      x.rare === e.rare && x.supa === e.supa && x.uber === e.uber && x.guaranteed === e.guaranteed
  );
  return next ? { id: next.id, end: next.end, endTime: next.endTime } : null;
}

/** When the plan starts: the start of "from", or now if that is later. */
const planStart = ({ from, now }) => Math.max(localMinute(from), now);

/**
 * Banners of the dates that can be planned, the ones skipped and every
 * upcoming one that can still be rolled. Banners open and close at their hour
 * (11:00) in the player's local time, like in the game: one that ends today
 * is planned until that hour, and is gone after it.
 */
function selectEvents(data, { from, to, today, now = localMinute(today) }) {
  const start = planStart({ from, now });
  const end = nextDayMinute(to) - 1;
  const upcoming = data.events.filter((e) => endsAt(e) > now);
  const selected = [];
  const skipped = [];
  for (const e of data.events) {
    const skip = (reason) => skipped.push({ id: e.id, name: e.name, start: e.start, end: e.end, startTime: e.startTime, endTime: e.endTime, reason });
    if (endsAt(e) <= now) {
      // Ended earlier today: say so, it was still in the game this morning.
      if (e.end === today) skip(`terminó hoy a las ${localParts(endsAt(e)).time}`);
      continue;
    }
    if (endsAt(e) <= start || startsAt(e) > end) continue;
    if (e.ticket) skip('se paga con tickets Platinum/Legend');
    else selected.push(e);
  }
  if (!selected.length) {
    const later = upcoming.filter((e) => endsAt(e) > start && !e.ticket).slice(0, 6);
    throw new UserError(
      `Entre el ${formatDate(from)} y el ${formatDate(to)} no hay ningún banner que se pueda planificar` +
        (skipped.length
          ? ` (${[
              skipped.some((e) => e.reason.startsWith('terminó')) && 'alguno ya ha terminado hoy',
              skipped.some((e) => !e.reason.startsWith('terminó')) && 'hay banners Platinum/Legend, que se pagan con otros tickets',
            ].filter(Boolean).join('; ')})`
          : '') +
        '.' +
        (later.length
          ? ` Próximos banners: ${later.map((e) => `«${e.name}» (${formatDate(e.start)} – ${formatDate(e.end)})`).join('; ')}. Ajusta las fechas para incluir alguno.`
          : ' Todavía no se han anunciado más banners; vuelve a probar más adelante.')
    );
  }
  const byDate = (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id);
  return { selected: selected.sort(byDate), skipped, upcoming: upcoming.sort(byDate) };
}

/**
 * Runs the analysis for the form values `body` with the banner data `data`.
 * Returns the result shown by the page; throws UserError for invalid input.
 */
function plan(body, data, { now = new Date() } = {}) {
  const input = parseRequest(body, now);
  const { seed, last } = input.seed;
  const { selected, skipped, upcoming } = selectEvents(data, input);
  const tablesFor = (list, rolls) => buildEvents(data, list, seed, rolls);

  const events = tablesFor(selected, input.rolls);
  const sim = new Simulator(seed, events, input.rolls);
  const queries = withAliases(input.targets, catalogOf(data));
  const { resolved, unavailable } = resolveTargets(queries, events, sim.obtainableIds());
  const unavailableItems = describeUnavailable(unavailable, { seed, input, events, upcoming, matchIds, tablesFor });

  const doubleLegend = detectDoubleLegend(events, upcoming, sim, planStart(input));
  const protect = {
    avoidLegend: input.protect.avoidLegend,
    avoidLegendFest: input.protect.avoidLegendFest && doubleLegend.length > 0,
  };
  const ctx = {
    sim,
    events,
    targets: resolved,
    inventory: { tickets: input.tickets, food: input.food, lastCat: last },
    discounts: input.discounts,
    protect,
    doubleLegend: doubleLegend.length > 0,
    from: input.from,
    now: input.now,
    to: input.to,
  };
  let routes = [];
  let diagnostics = unavailableItems;
  if (resolved.length) {
    routes = optimizeRoutes(ctx);
    if (routes.some((r) => r.recommended && (!r.found || !r.complete || r.exhausted))) {
      diagnostics = [...unavailableItems, ...diagnose(ctx, routes, { seed })];
    }
  }

  return {
    seed,
    last,
    rolls: input.rolls,
    inventory: { tickets: input.tickets, food: input.food },
    events: events.map((e) => ({
      id: e.id, name: e.name, start: e.start, end: e.end, startTime: e.startTime, endTime: e.endTime, kind: e.kind,
      continuedBy: continuationOf(data, data.events.find((x) => x.id === e.id)),
    })),
    skipped,
    targets: resolved.map((t) => ({ query: t.query, names: t.names })),
    // Chosen cats that couldn't enter the plan at all (explained in diagnostics).
    unplanned: unavailable.map((u) => u.query),
    diagnostics,
    protection: {
      legend: protect.avoidLegend,
      legendFest: protect.avoidLegendFest,
      legendFestRequested: input.protect.avoidLegendFest,
      doubleLegendEvents: doubleLegend,
    },
    legendCells: legendCellsOf(sim, doubleLegend.length > 0),
    routes,
  };
}

export {
  UserError,
  plan,
  parseRequest,
  parseSeedInput,
  catalogOf,
  withAliases,
  matchIds,
  resolveTargets,
  selectEvents,
  detectDoubleLegend,
};
