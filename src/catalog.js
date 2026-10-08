'use strict';

// Catalogue of every cat in the game from the Battle Cats wiki on Miraheze
// (same approach as the "App Battle cats" project): Category:Cat_Units through
// the MediaWiki API, with redirects as alternative names (other forms) and
// JP-exclusive units removed. Non-gacha cats (Normal, Special) are listed too,
// flagged with gacha: false, so the analysis can explain why they can't be rolled. The list feeds the target picker; a snapshot is kept on disk
// so the app works offline and starts instantly.

const fs = require('fs');
const path = require('path');

const API = 'https://battlecats.miraheze.org/w/api.php';
const HEADERS = { 'User-Agent': 'BattleCatsSeedRouter/1.0 (local planner)' };
const SNAPSHOT = path.join(__dirname, '..', 'data', 'cats.json');
const REFRESH_MS = 12 * 60 * 60 * 1000;
// Wiki rarity -> { key, gacha }: only the last four come out of the rare gacha.
const RARITIES = new Map([
  ['Normal', { key: 'normal', gacha: false }],
  ['Special', { key: 'special', gacha: false }],
  ['Rare', { key: 'rare', gacha: true }],
  ['Super Rare', { key: 'super', gacha: true }],
  ['Uber Rare', { key: 'uber', gacha: true }],
  ['Legend Rare', { key: 'legendary', gacha: true }],
]);

async function getJson(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Miraheze respondió HTTP ${res.status}`);
  return res.json();
}

function parseTitle(title) {
  const m = title.match(/^(.*?)\s*\(([^)]+?)\)\s*$/);
  return m ? { name: m[1].trim(), rarity: m[2].replace(/\s*Cat$/i, '').trim() } : { name: title.trim(), rarity: '' };
}

async function fetchJpExclusiveTitles() {
  const titles = new Set();
  let cont = {};
  do {
    const data = await getJson({
      action: 'query',
      list: 'categorymembers',
      cmtitle: 'Category:Japanese_Exclusive_Content',
      cmlimit: '500',
      ...cont,
    });
    for (const m of data.query?.categorymembers ?? []) titles.add(m.title);
    cont = data.continue ?? null;
  } while (cont);
  return titles;
}

/** Downloads the current list of gacha cats from Miraheze. */
async function fetchCatalog() {
  const byId = new Map();
  let cont = {};
  do {
    const data = await getJson({
      action: 'query',
      generator: 'categorymembers',
      gcmtitle: 'Category:Cat_Units',
      gcmlimit: '500',
      gcmnamespace: '0',
      prop: 'pageimages|redirects',
      piprop: 'thumbnail',
      pithumbsize: '64',
      rdprop: 'title',
      rdnamespace: '0',
      rdlimit: 'max',
      ...cont,
    });
    // Several continuation tokens can come back (generator, images,
    // redirects): forward them all and merge pages by id.
    for (const p of Object.values(data.query?.pages ?? {})) {
      const entry = byId.get(p.pageid) || { title: p.title, image: null, aliases: new Set() };
      if (!entry.image && p.thumbnail?.source) entry.image = p.thumbnail.source;
      for (const r of p.redirects ?? []) entry.aliases.add(r.title);
      byId.set(p.pageid, entry);
    }
    cont = data.continue ?? null;
  } while (cont);

  const jpExclusive = await fetchJpExclusiveTitles();
  const cats = [];
  for (const entry of byId.values()) {
    const { name, rarity } = parseTitle(entry.title);
    if (!RARITIES.has(rarity) || jpExclusive.has(entry.title)) continue;
    const aliases = [...entry.aliases]
      .map((a) => parseTitle(a).name)
      .filter((a, i, all) => a.toLowerCase() !== name.toLowerCase() && all.indexOf(a) === i)
      .sort((a, b) => a.localeCompare(b));
    const { key, gacha } = RARITIES.get(rarity);
    // The wiki page title is unique even when two cats share a name (Cat Bros).
    cats.push({ key: entry.title, name, rarity: key, gacha, godfatId: godfatIdFromImage(entry.image), aliases, image: entry.image });
  }
  cats.sort((a, b) => a.name.localeCompare(b.name));
  return cats;
}

// Unit icons are named "<unit number>_<form>.png" (e.g. 850_1.png for Fuma
// Kotaro) and godfat's cat id is that unit number + 1, which gives an exact
// link between both sites without relying on names.
function godfatIdFromImage(image) {
  const m = /[/-](\d+)_\d+\.png$/.exec(image || ''); // ".../64px-850_1.png"
  return m ? Number(m[1]) + 1 : null;
}

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return null;
  }
}

function writeSnapshot(cats) {
  const snapshot = { updatedAt: new Date().toISOString(), cats };
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
  return snapshot;
}

let current = readSnapshot();
let refreshing = null;

/** Refreshes the snapshot from Miraheze; on failure keeps the previous one. */
function refresh() {
  refreshing ??= fetchCatalog()
    .then((cats) => (current = writeSnapshot(cats)))
    .catch((err) => {
      console.warn(`No se pudo actualizar la lista de gatos desde Miraheze: ${err.message}`);
      return current;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/**
 * Current catalogue. Answers immediately from the snapshot and refreshes it in
 * the background when it is older than 12 h; only waits if there is none yet.
 */
async function getCatalog() {
  const age = current ? Date.now() - Date.parse(current.updatedAt) : Infinity;
  if (!current) await refresh();
  else if (age > REFRESH_MS) refresh();
  return current || { updatedAt: null, cats: [] };
}

module.exports = { getCatalog, fetchCatalog, refresh, parseTitle, godfatIdFromImage };
