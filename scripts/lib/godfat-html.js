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

/**
 * Every rolled cell of a table: normal (1A), re-rolled (1AR), guaranteed (1AG)
 * and re-rolled guaranteed (1ARG), with the cell the next roll goes to and the
 * colour classes; plus the banner's cats per rarity from the "last cat" list.
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
    const colors = [...td.classList].filter((c) => /^(minor|major)_/.test(c)).map((c) => c.replace(/^(minor|major)_/, ''));
    cells.push({
      n: Number(m[1]),
      track: m[2],
      alt: m[3] === 'R',
      guaranteed: m[4] === 'G',
      id: Number(catLink.getAttribute('href').match(/\/cats\/(\d+)/)[1]),
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
