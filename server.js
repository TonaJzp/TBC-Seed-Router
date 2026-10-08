'use strict';

const path = require('path');
const express = require('express');
const { scrapeSeed, scrapeEvents, DEFAULT_ROLLS, MAX_ROLLS } = require('./src/scraper');
const { diagnose } = require('./src/diagnostics');
const { describeUnavailable } = require('./src/unavailable');
const { Simulator } = require('./src/simulator');
const { optimizeRoutes, legendColorOf } = require('./src/optimizer');
const { getCatalog } = require('./src/catalog');

const PORT = Number(process.env.PORT) || 3000;
const MIN_ROLLS = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 86_400_000;
const localIsoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatDate = (iso) => iso.split('-').reverse().join('/');

/**
 * "Today" for the user: the date their browser reports (their time zone), as
 * long as it is within a day of this machine's date; otherwise this machine's.
 */
function userToday(clientToday, now = new Date()) {
  const serverToday = localIsoDate(now);
  if (!ISO_DATE.test(clientToday || '')) return serverToday;
  const diff = Math.abs(Date.parse(clientToday) - Date.parse(serverToday));
  return diff <= DAY_MS ? clientToday : serverToday;
}

function parseRequest(body, now = new Date()) {
  const nonNegInt = (v, label) => {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label} debe ser un entero >= 0.`);
    return n;
  };
  // The picker sends an array of catalogue names; plain text (comma or line
  // separated) is still accepted.
  const list = Array.isArray(body.targets) ? body.targets : String(body.targets || '').split(/[,\n]/);
  const targets = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  if (!targets.length) throw new Error('Indica al menos un gato objetivo.');
  if (!ISO_DATE.test(body.from || '') || !ISO_DATE.test(body.to || '')) {
    throw new Error('El rango de fechas no es válido.');
  }
  if (body.from > body.to) throw new Error('La fecha inicial es posterior a la final.');
  // Past banners can't be rolled any more: the plan always starts today.
  const today = userToday(body.today, now);
  if (body.from < today) {
    throw new Error(`La fecha inicial no puede ser anterior a hoy (${formatDate(today)}).`);
  }
  const rolls = nonNegInt(body.rolls ?? DEFAULT_ROLLS, 'Tiros a analizar');
  if (rolls < MIN_ROLLS || rolls > MAX_ROLLS) {
    throw new Error(`Tiros a analizar debe estar entre ${MIN_ROLLS} y ${MAX_ROLLS}.`);
  }
  return {
    url: String(body.url || '').trim(),
    targets,
    from: body.from,
    to: body.to,
    rolls,
    tickets: nonNegInt(body.tickets, 'Rare Tickets'),
    food: nonNegInt(body.food, 'Cat Food'),
    discounts: { guaranteed: !!body.discount11, single: !!body.discount1 },
    protect: { avoidLegend: !!body.avoidLegend, avoidLegendFest: !!body.avoidLegendFest },
  };
}

/**
 * Looks each query up in the catalogue: by unique key (wiki page title, what
 * the picker sends), else by name (a gacha cat wins if two share the name).
 */
function withAliases(queries, catalog) {
  const byKey = new Map(catalog.filter((c) => c.key).map((c) => [c.key.toLowerCase(), c]));
  const byName = new Map();
  for (const c of catalog) {
    const k = c.name.toLowerCase();
    if (!byName.has(k) || (byName.get(k).gacha === false && c.gacha !== false)) byName.set(k, c);
  }
  return queries.map((q) => {
    const cat = byKey.get(q.toLowerCase()) || byName.get(q.toLowerCase());
    if (!cat) return { name: q, inCatalog: false, gacha: true, godfatId: null, aliases: [] };
    return { name: cat.name, inCatalog: true, gacha: cat.gacha !== false, rarity: cat.rarity, godfatId: cat.godfatId ?? null, aliases: cat.aliases };
  });
}

// Resolves targets into sets of godfat cat ids, keeping only the ones some
// roll inside the horizon can actually produce. Matching order: godfat id
// from the catalogue, exact name, exact alternative name (another form of the
// cat), id typed as text, then partial name (free text only: a catalogue cat
// must never be confused with another one that merely contains its name).
// Every target that can't be rolled ends up in `unavailable` with its reason:
//   notGacha     not a gacha cat (Normal / Special)
//   unknownName  free text that matches no known cat
//   notInBanners no banner in the date range has it
//   notInRolls   in some banner, but not within the analysed rolls
/** godfat cat names (id -> name) of a list of banners. */
function namesOf(events) {
  const names = new Map();
  for (const ev of events) {
    for (const [id, name] of Object.entries(ev.names)) names.set(Number(id), name);
  }
  return names;
}

/** godfat ids a query refers to among `names` (see resolveTargets for the order). */
function matchIds(query, names) {
  const { name: q, aliases = [], godfatId = null, inCatalog = false } = typeof query === 'string' ? { name: query } : query;
  const all = [...names.keys()];
  const exact = (text) => all.filter((id) => names.get(id).toLowerCase() === text.toLowerCase());
  let ids = godfatId !== null && names.has(godfatId) ? [godfatId] : [];
  if (!ids.length) ids = exact(q);
  if (!ids.length) ids = [...new Set(aliases.flatMap(exact))];
  if (!ids.length) ids = all.filter((id) => String(id) === q);
  if (!ids.length && !inCatalog) ids = all.filter((id) => names.get(id).toLowerCase().includes(q.toLowerCase()));
  return ids;
}

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

// Lilac cells are only Legendary in Royalfest / double legend chance events, so
// protecting them only matters when such an event is coming.
function detectDoubleLegend(events, doubleLegendEvents, sim) {
  const found = new Map(doubleLegendEvents.map((e) => [e.id, e]));
  for (const ev of events) {
    for (const [key, c] of Object.entries(ev.raw)) {
      const m = /^(\d+)([AB])$/.exec(key);
      if (sim.legendColorsAt(Number(m[1]), m[2]).has('legend_fest') && ev.rarityOf.get(c.id) === 'legendary') {
        found.set(ev.id, ev);
      }
    }
  }
  return [...found.values()].map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end }));
}

async function handleRoutes(req, res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');
  try {
    const input = parseRequest(req.body || {});
    const scraped = await scrapeSeed(input.url, {
      from: input.from,
      to: input.to,
      rolls: input.rolls,
      onProgress: (message) => send({ type: 'progress', message }),
    });
    const { seedInfo, events } = scraped;

    const sim = new Simulator(seedInfo.seed, events, input.rolls);
    const notes = [...scraped.skipped];
    for (const ev of events) {
      if (ev.kind === 'unsupported') {
        notes.push({ name: ev.name, reason: 'tipo de garantizado no reconocido: banner excluido para no dar rutas erróneas' });
      }
      if (!ev.rerollReliable) {
        notes.push({ name: ev.name, reason: 'pool con gatos repetidos: solo se usan cruces por duplicado que godfat muestra' });
      }
    }

    const { cats: catalog } = await getCatalog();
    const queries = withAliases(input.targets, catalog);
    const { resolved, unavailable } = resolveTargets(queries, events, sim.obtainableIds());
    const progress = (message) => send({ type: 'progress', message });
    const unavailableItems = await describeUnavailable(unavailable, {
      seed: seedInfo.seed,
      input,
      events,
      upcoming: scraped.upcoming || [],
      matchIds,
      scrapeEvents: (list, rolls) => scrapeEvents(input.url, list, { rolls, onProgress: progress }),
      onProgress: progress,
    });

    const doubleLegend = detectDoubleLegend(events, scraped.doubleLegendEvents, sim);
    const protect = {
      avoidLegend: input.protect.avoidLegend,
      avoidLegendFest: input.protect.avoidLegendFest && doubleLegend.length > 0,
    };

    const ctx = {
      sim,
      events,
      targets: resolved,
      inventory: { tickets: input.tickets, food: input.food, lastCat: seedInfo.last },
      discounts: input.discounts,
      protect,
      doubleLegend: doubleLegend.length > 0,
      from: input.from,
      to: input.to,
    };
    let routes = [];
    let diagnostics = unavailableItems;
    if (resolved.length) {
      progress(`Calculando rutas óptimas para ${resolved.length} gatos objetivo...`);
      routes = optimizeRoutes(ctx);
      if (routes.some((r) => r.recommended && (!r.found || !r.complete || r.exhausted))) {
        progress('Analizando por qué no se pueden conseguir todos los gatos...');
        diagnostics = [...unavailableItems, ...diagnose(ctx, routes, { seed: seedInfo.seed, rolls: input.rolls })];
      }
    }

    send({
      type: 'result',
      seed: seedInfo.seed,
      rolls: input.rolls,
      inventory: { tickets: input.tickets, food: input.food },
      events: events.map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end, kind: e.kind })),
      skipped: notes,
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
    });
  } catch (err) {
    send({ type: 'error', message: err.message || String(err) });
  } finally {
    res.end();
  }
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.post('/api/routes', handleRoutes);
  app.get('/api/cats', async (req, res) => {
    const { updatedAt, cats } = await getCatalog();
    res.json({ updatedAt, cats });
  });
  return app;
}

function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

if (require.main === module) {
  const url = `http://localhost:${PORT}`;
  const open = process.argv.includes('--open');
  // Express 5 also calls this callback on errors; those go to the handler below.
  const server = createApp().listen(PORT, (err) => {
    if (err) return;
    console.log(`BattleCats Seed Router en ${url}`);
    console.log('Deja esta ventana abierta mientras uses la app. Para cerrarla: Ctrl+C.');
    if (open) openBrowser(url);
  });
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    // Most likely the app is already running (e.g. started twice).
    console.log(`El puerto ${PORT} ya está en uso: la app probablemente ya está abierta en ${url}`);
    if (open) openBrowser(url);
    process.exit(0);
  });
}

module.exports = { createApp, parseRequest, resolveTargets, matchIds, withAliases, userToday };
