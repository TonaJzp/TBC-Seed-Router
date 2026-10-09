// Reads bc.godfat.org pages without a browser (the tables are rendered on the
// server). Only the monitoring uses it, to compare what the app computes with
// what godfat shows; the app itself never reads godfat.

import { parseHTML } from 'linkedom';

const BASE = 'https://bc.godfat.org/';

const shiftKey = (key, offset) => {
  const m = /^(\d+)([AB])$/.exec(key || '');
  return m ? `${Number(m[1]) + offset}${m[2]}` : null;
};

/** Banners of the "Upcoming" list (it also holds the ongoing ones). */
function parseEventList(document) {
  const groups = [...document.querySelectorAll('#event_select optgroup')];
  const upcoming = groups.find((g) => (g.getAttribute('label') || '').trim().startsWith('Upcoming'));
  if (!upcoming) return null;
  return [...upcoming.querySelectorAll('option')].map((o) => {
    const label = o.textContent.replace(/\s+/g, ' ').trim();
    const m = label.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2}):\s*(.*)$/);
    return { id: o.getAttribute('value'), label, start: m?.[1] ?? null, end: m?.[2] ?? null, name: m?.[3] ?? label };
  });
}

// Colours godfat paints over the score colour (View#highlight_*).
const SPECIAL = new Set(['exclusive', 'owned', 'found']);

/**
 * The score colour of a cell (godfat Cat#score_rarity_label: rare, supa_fest,
 * ..., legend_fest, legend). It is the major_ class, except for special cats:
 * the default highlighting then hides it, and highlighting=advanced moves it
 * to the minor_ class (the minor_ class of other cells is the cat's rarity).
 * A special colour in both means the score colour is rare, or is hidden.
 */
function scoreLabel(td) {
  const cls = (prefix) => [...td.classList].find((c) => c.startsWith(prefix))?.slice(prefix.length) || null;
  const major = cls('major_');
  const minor = cls('minor_');
  return SPECIAL.has(major) && minor && !SPECIAL.has(minor) ? minor : major;
}

/**
 * Every rolled cell of a table: normal (1A), re-rolled (1AR), guaranteed (1AG)
 * and re-rolled guaranteed (1ARG), with the cell the next roll goes to and its
 * score colour; plus the banner's cats per rarity from the "last cat" list.
 * Read pages with highlighting=advanced, or the score of special cats is lost.
 */
function parseTable(document) {
  const cells = [];
  for (const td of document.querySelectorAll('td.position.cat[onclick]')) {
    if (td.classList.contains('score')) continue;
    const m = (td.getAttribute('onclick') || '').match(/pick\('(\d+)([AB])(R?)(G?)'\)/);
    if (!m) continue;
    const nameLink = td.querySelector('a[title]');
    const catLink = td.querySelector('a[href*="/cats/"]');
    if (!nameLink || !catLink) continue;
    const text = td.textContent.replace(/\s+/g, ' ').trim();
    const dest = (text.match(/(?:->|<-)\s*(\d+[AB])/) || [])[1] || null;
    const label = scoreLabel(td);
    cells.push({
      n: Number(m[1]),
      track: m[2],
      alt: m[3] === 'R',
      guaranteed: m[4] === 'G',
      id: Number(catLink.getAttribute('href').match(/\/cats\/(\d+)/)[1]),
      name: nameLink.textContent.trim(),
      dest,
      colors: label ? [label] : [],
    });
  }
  const pools = {};
  let current = null;
  const select = document.querySelector('#last_select');
  for (const el of select ? select.querySelectorAll('optgroup, option') : []) {
    if (el.tagName === 'OPTGROUP') {
      current = (el.getAttribute('label') || '').replace(':', '').trim().toLowerCase();
      pools[current] = [];
    } else if (current && el.getAttribute('value') !== '0') {
      pools[current].push({ id: Number(el.getAttribute('value')), name: el.textContent.trim() });
    }
  }
  return { cells, pools };
}

/** Groups the cells of one or more pages of a banner by kind, keyed "12A". */
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
  return data;
}

function pageUrl(seed, extra = {}) {
  return `${BASE}?${new URLSearchParams({ seed: String(seed), lang: 'en', ...extra })}`;
}

/** Fetches and parses a godfat page, retrying transient failures. */
async function fetchDocument(url, { userAgent, attempts = 3, fetchImpl = fetch } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseHTML(await res.text()).document;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
  throw new Error(`No se pudo leer ${url}: ${lastError.message}`);
}

export { parseEventList, parseTable, organize, pageUrl, fetchDocument };
