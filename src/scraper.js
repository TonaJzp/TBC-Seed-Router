'use strict';

const { chromium } = require('playwright');
const { buildSequence } = require('./rng');
const { site } = require('./site');

const BASE = 'https://bc.godfat.org/';
const DEFAULT_ROLLS = 200;
const MAX_ROLLS = 1000;
const GODFAT_PAGE_ROWS = 300; // godfat ignores count values above 300
const CONCURRENCY = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

// Banners paid with Platinum/Legend tickets instead of Cat Food / Rare Tickets.
const TICKET_ONLY_BANNER = /platinum capsule|legend capsule/i;
// Events where lilac cells become Legendary ("Royalfest or double legend chances").
const DOUBLE_LEGEND_EVENT =
  /royal\s*fest|(double|x2|×2|2x|twice)[^!]*legend|legend[^!]*(double|x2|×2|2x|twice)/i;

const cache = new Map();

// Bounded cache: expired entries go first, then the oldest (Map keeps insertion order).
function remember(key, value, now = Date.now()) {
  for (const [k, e] of cache) if (now - e.at >= CACHE_TTL_MS) cache.delete(k);
  cache.delete(key);
  while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, value });
}

function parseSeedUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw userError(`La URL de la semilla no es válida. Copia la dirección completa de tu semilla en godfat, por ejemplo ${EXAMPLE_URL}`);
  }
  if (url.hostname !== 'bc.godfat.org') {
    throw userError(`La URL debe ser de bc.godfat.org (la web donde ves tu semilla), por ejemplo ${EXAMPLE_URL}`);
  }
  const seed = Number(url.searchParams.get('seed'));
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff) {
    throw userError(`A la URL le falta el número de semilla («?seed=…»). Ábrela en godfat y copia la dirección completa, por ejemplo ${EXAMPLE_URL}`);
  }
  // The tables are always read in English, whatever the URL says: targets are
  // matched against the (English) Miraheze names.
  return { seed, last: Number(url.searchParams.get('last')) || 0 };
}

function pageUrl({ seed }, extra = {}) {
  const params = new URLSearchParams({ seed: String(seed), lang: 'en', ...extra });
  return `${BASE}?${params}`;
}

async function newFastPage(browser) {
  // Identifies the app (and how to reach its owner) instead of posing as a normal browser.
  const page = await browser.newPage({ userAgent: site.userAgent });
  // The tables are server-rendered; skip everything that is not the document.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'document' ? route.continue() : route.abort()
  );
  return page;
}

async function readUpcomingEvents(page) {
  return page.$$eval('#event_select optgroup', (groups) => {
    const upcoming = groups.find((g) => g.label.trim().startsWith('Upcoming'));
    if (!upcoming) return [];
    return [...upcoming.querySelectorAll('option')].map((o) => ({
      id: o.value,
      label: o.textContent.replace(/\s+/g, ' ').trim(),
    }));
  });
}

// Runs inside the browser: extracts every rolled cat cell of the table.
// Cells with class "score" are the hidden rarity-score cells and are ignored.
function extractTable() {
  const cells = [];
  for (const td of document.querySelectorAll('td.position.cat[onclick]')) {
    if (td.classList.contains('score')) continue;
    const m = td.getAttribute('onclick').match(/pick\('(\d+)([AB])(R?)(G?)'\)/);
    if (!m) continue;
    const nameLink = td.querySelector('a[title]');
    const catLink = td.querySelector('a[href*="/cats/"]');
    if (!nameLink || !catLink) continue;
    const text = td.textContent.replace(/\s+/g, ' ').trim();
    const dest = (text.match(/(?:->|<-)\s*(\d+[AB])/) || [])[1] || null;
    const colors = [...td.classList]
      .filter((c) => /^(minor|major)_/.test(c))
      .map((c) => c.replace(/^(minor|major)_/, ''));
    cells.push({
      n: Number(m[1]),
      track: m[2],
      alt: m[3] === 'R',
      guaranteed: m[4] === 'G',
      id: Number(catLink.href.match(/\/cats\/(\d+)/)[1]),
      name: nameLink.textContent.trim(),
      dest,
      colors: [...new Set(colors)],
    });
  }

  const pools = {};
  let current = null;
  const select = document.querySelector('#last_select');
  for (const el of select ? select.querySelectorAll('optgroup, option') : []) {
    if (el.tagName === 'OPTGROUP') {
      current = el.label.replace(':', '').trim().toLowerCase();
      pools[current] = [];
    } else if (current && el.value !== '0') {
      pools[current].push({ id: Number(el.value), name: el.textContent.trim() });
    }
  }
  return { cells, pools };
}

function parseEventLabel(label) {
  const m = label.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2}):\s*(.*)$/);
  if (!m) return null;
  return { start: m[1], end: m[2], name: m[3] };
}

const shiftKey = (key, offset) => {
  const m = /^(\d+)([AB])$/.exec(key || '');
  return m ? `${Number(m[1]) + offset}${m[2]}` : null;
};

function organize(event, pages) {
  const { pools } = pages[0].table;
  const data = {
    ...event,
    pools: {
      rare: (pools.rare || []).map((c) => c.id),
      super: (pools.super || []).map((c) => c.id),
      uber: (pools.uber || []).map((c) => c.id),
      legendary: (pools.legendary || []).map((c) => c.id),
    },
    names: {},
    raw: {},
    alt: {},
    guaranteed: {},
    altGuaranteed: {},
  };
  for (const group of Object.values(pools)) for (const c of group) data.names[c.id] = c.name;

  for (const { offset, table } of pages) {
    for (const c of table.cells) {
      const key = `${c.n + offset}${c.track}`;
      data.names[c.id] = c.name;
      const entry = { id: c.id, name: c.name, dest: shiftKey(c.dest, offset), colors: c.colors };
      if (c.alt && c.guaranteed) data.altGuaranteed[key] = entry;
      else if (c.alt) data.alt[key] = entry;
      else if (c.guaranteed) data.guaranteed[key] = entry;
      else data.raw[key] = entry;
    }
  }
  data.hasGuaranteed = Object.keys(data.guaranteed).length > 0;
  return data;
}

// godfat shows at most 300 rows per page. Row N + 300k is row N of the page
// whose seed is seq[600k], so longer horizons are fetched page by page.
async function scrapeEvent(browser, seedInfo, event, rolls, extraParams = {}) {
  const seq = buildSequence(seedInfo.seed, rolls + 1);
  const page = await newFastPage(browser);
  try {
    const pages = [];
    for (let offset = 0; offset < rolls; offset += GODFAT_PAGE_ROWS) {
      const count = Math.min(GODFAT_PAGE_ROWS, rolls - offset);
      const pageSeed = { ...seedInfo, seed: seq[2 * offset] };
      await page.goto(pageUrl(pageSeed, { ...extraParams, event: event.id, count: String(count) }), {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await page.waitForSelector('td.position.cat', { timeout: 30000 });
      pages.push({ offset, table: await page.evaluate(extractTable) });
    }
    return organize(event, pages);
  } finally {
    await page.close();
  }
}

const EXAMPLE_URL = 'https://bc.godfat.org/?seed=123456789';
const formatDate = (iso) => iso.split('-').reverse().join('/');

/** Turns low-level browser/network failures into explanations for the user. */
function friendlyError(err, what = 'bc.godfat.org') {
  const msg = String((err && err.message) || err);
  if (err && err.userFacing) return err;
  let text;
  if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(msg)) {
    text =
      'Falta el navegador interno (Chromium) que usa la app para leer godfat. Abre una terminal en la carpeta del proyecto y ejecuta «npx playwright install chromium»; después vuelve a calcular.';
  } else if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(msg)) {
    text = `No se pudo conectar con ${what}. Comprueba tu conexión a internet y que la web abre en tu navegador, y vuelve a intentarlo.`;
  } else if (/Timeout|timed out/i.test(msg)) {
    text = `${what} tardó demasiado en responder. Suele ser algo temporal de godfat: espera un par de minutos y vuelve a intentarlo. Si pasa a menudo, reduce «¿Cuántos tiros hacia delante revisar?» o el rango de fechas.`;
  } else {
    text = `Error inesperado al leer ${what}: ${msg}`;
  }
  const out = new Error(text);
  out.userFacing = true;
  return out;
}

function userError(text) {
  const err = new Error(text);
  err.userFacing = true;
  return err;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function scrapeAll(browser, seedInfo, selected, rolls, onProgress) {
  const events = [];
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const ev = selected[next++];
      onProgress(`Extrayendo ${rolls} tiros: ${ev.name}`);
      try {
        events.push(await scrapeEvent(browser, seedInfo, ev, rolls));
      } catch (err) {
        if (/td\.position\.cat/.test(String(err.message))) {
          throw userError(
            `godfat no mostró la tabla de tiros del banner «${ev.name}». Comprueba que tu URL de semilla abre bien en godfat; si es así, puede que godfat haya cambiado su diseño.`
          );
        }
        throw friendlyError(err, `bc.godfat.org (banner «${ev.name}»)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, worker));
  events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return events;
}

/**
 * Scrapes every "Upcoming" banner overlapping [from, to] for the given seed URL.
 * Returns { seedInfo, events, skipped, doubleLegendEvents, upcoming }.
 */
async function scrapeSeed(rawUrl, { from, to, rolls = DEFAULT_ROLLS, onProgress = () => {} } = {}) {
  const seedInfo = parseSeedUrl(rawUrl);
  const cacheKey = JSON.stringify([seedInfo.seed, from, to, rolls]);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    onProgress('Usando datos en caché.');
    return { seedInfo, ...hit.value };
  }

  const browser = await launch();
  try {
    const page = await newFastPage(browser);
    onProgress('Leyendo la lista de eventos Upcoming...');
    let options;
    try {
      await page.goto(pageUrl(seedInfo), { waitUntil: 'domcontentloaded', timeout: 90000 });
      options = await readUpcomingEvents(page);
    } catch (err) {
      throw friendlyError(err);
    }
    await page.close();

    const skipped = [];
    const selected = [];
    const doubleLegendEvents = [];
    const upcoming = [];
    for (const opt of options) {
      const info = parseEventLabel(opt.label);
      if (!info) continue;
      const event = { id: opt.id, ...info };
      upcoming.push(event);
      if (DOUBLE_LEGEND_EVENT.test(info.name)) doubleLegendEvents.push(event);
      if (info.end < from || info.start > to) continue;
      if (TICKET_ONLY_BANNER.test(info.name)) {
        skipped.push({ ...event, reason: 'se paga con tickets Platinum/Legend' });
        continue;
      }
      selected.push(event);
    }
    if (!options.length) {
      throw userError('godfat no muestra ningún evento Upcoming para esta semilla. Comprueba que la URL abre bien en godfat.');
    }
    if (!selected.length) {
      const later = upcoming.filter((e) => e.end >= from && !TICKET_ONLY_BANNER.test(e.name)).slice(0, 6);
      const onlyTickets = skipped.length > 0;
      throw userError(
        `Entre el ${formatDate(from)} y el ${formatDate(to)} no hay ningún banner que se pueda planificar` +
          (onlyTickets ? ' (solo hay banners Platinum/Legend, que se pagan con otros tickets)' : '') +
          '.' +
          (later.length
            ? ` Próximos banners en godfat: ${later.map((e) => `«${e.name}» (${formatDate(e.start)} – ${formatDate(e.end)})`).join('; ')}. Ajusta las fechas para incluir alguno.`
            : ' godfat todavía no anuncia más banners; vuelve a probar más adelante.')
      );
    }

    const events = await scrapeAll(browser, seedInfo, selected, rolls, onProgress);
    const value = { events, skipped, doubleLegendEvents, upcoming };
    remember(cacheKey, value);
    return { seedInfo, ...value };
  } finally {
    await browser.close();
  }
}

/** Scrapes a given list of banners (used to look deeper or outside the range). */
async function scrapeEvents(rawUrl, list, { rolls, onProgress = () => {} }) {
  const seedInfo = parseSeedUrl(rawUrl);
  const browser = await launch();
  try {
    return await scrapeAll(browser, seedInfo, list, rolls, onProgress);
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeSeed,
  scrapeEvents,
  friendlyError,
  scrapeEvent,
  newBrowser: () => chromium.launch(),
  parseSeedUrl,
  extractTable,
  organize,
  DEFAULT_ROLLS,
  MAX_ROLLS,
  DOUBLE_LEGEND_EVENT,
};
