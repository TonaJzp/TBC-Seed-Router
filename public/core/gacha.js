// Roll tables computed from godfat's open data instead of read from his site.
//
// Port of Battle Cats Rolls by Lin Jen-Shin (godfat), Apache License 2.0:
// https://gitlab.com/godfat/battle-cats-rolls (lib/battle-cats-rolls/gacha.rb,
// gacha_pool.rb and cat.rb). Changes: rewritten in JavaScript, limited to what
// the route planner needs (rarity, slot, duplicate re-roll, legend cells).
//
// Every roll uses two consecutive seeds of the xorshift sequence: the rarity
// seed picks the rarity (score = seed % 10000 against the banner rates) and the
// slot seed picks the cat among the banner's cats of that rarity, in the order
// godfat's data lists them.

import { xorshift32, buildSequence, raritySeed, slotSeed } from './rng.js';

const BASE = 10000;
const RARITIES = ['rare', 'super', 'uber', 'legendary'];
const RARITY_BY_CODE = { 0: 'normal', 1: 'special', 2: 'rare', 3: 'super', 4: 'uber', 5: 'legendary' };
// Scores that godfat paints purple (Legendary) and lilac (Legendary only when
// the banner's legend rate is raised: Royalfest, double legend...).
const LEGEND_SCORE = 9970;
const LEGEND_FEST_SCORE = 9940;
const GUARANTEED_SIZES = { guaranteed: 11, stepup: 15 };

const keyOf = (n, track) => `${n}${track}`;
const rarityName = (code) => RARITY_BY_CODE[code] ?? null;

/**
 * The banner's cats per rarity. Like godfat, a cat missing from the data
 * empties the whole banner rather than shifting every slot after it.
 */
function poolsOf(data, event) {
  const pools = Object.fromEntries(RARITIES.map((r) => [r, []]));
  for (const id of data.gacha[event.gacha] || []) {
    const cat = data.cats[id];
    if (!cat) return Object.fromEntries(RARITIES.map((r) => [r, []]));
    const rarity = rarityName(cat.rarity);
    if (pools[rarity]) pools[rarity].push(id);
  }
  return pools;
}

function rarityOfScore(event, score) {
  const { rare, supa, uber } = event;
  if (score < rare) return 'rare';
  if (score < rare + supa) return 'super';
  if (score < rare + supa + uber) return 'uber';
  return 'legendary';
}

function scoreColors(score) {
  if (score >= LEGEND_SCORE) return ['legend'];
  if (score >= LEGEND_FEST_SCORE) return ['legend_fest'];
  return [];
}

/** True if some lilac cell gives a Legendary in this banner (legend rate above the usual 0.3 %). */
function raisesLegend(event) {
  return event.rare + event.supa + event.uber < LEGEND_SCORE;
}

/**
 * Re-roll of a duplicated rare (godfat Gacha#reroll_cat): the slot is removed
 * and the next seed picks again, as many times as the cat is repeated in the
 * pool. Returns { id, steps } or null if every remaining slot is the same cat.
 */
function rerollRare(pool, seed, id) {
  const slots = [...pool];
  let slot = seed % slots.length;
  let next = seed;
  const copies = slots.filter((x) => x === id).length;
  for (let steps = 1; steps <= copies && slots.length > 1; steps++) {
    next = xorshift32(next);
    slots.splice(slot, 1);
    slot = next % slots.length;
    if (slots[slot] !== id) return { id: slots[slot], steps };
  }
  return null;
}

/** Position of the roll after a re-roll that used `steps` extra seeds (godfat Gacha.next_index / next_track). */
function afterReroll(n, track, steps) {
  const t = track === 'A' ? 0 : 1;
  return { n: n + Math.floor((t + steps) / 2) + 1, track: (((t + steps - 1) ^ 1) & 1) === 0 ? 'A' : 'B' };
}

/**
 * One banner's table for a seed: raw cells, the re-rolls godfat draws for
 * duplicates inside the banner ("R" cells) and the legend colours.
 */
function buildEvent(data, event, seq, rolls) {
  const pools = poolsOf(data, event);
  const names = {};
  for (const id of RARITIES.flatMap((r) => pools[r])) names[id] = data.cats[id].names[0];
  const ev = {
    id: event.id,
    name: event.name,
    start: event.start,
    end: event.end,
    gacha: event.gacha,
    rates: { rare: event.rare, supa: event.supa, uber: event.uber },
    guaranteedSize: event.guaranteed,
    ticket: event.ticket || null,
    pools,
    names,
    raw: {},
    alt: {},
  };
  for (let n = 1; n <= rolls; n++) {
    for (const track of ['A', 'B']) {
      const score = raritySeed(seq, n, track) % BASE;
      const rarity = rarityOfScore(event, score);
      const slots = pools[rarity];
      if (!slots.length) continue;
      const id = slots[slotSeed(seq, n, track) % slots.length];
      ev.raw[keyOf(n, track)] = { id, name: names[id], colors: scoreColors(score) };
    }
  }
  // godfat draws a re-roll where a rare repeats the cat right above it on the
  // same track, and again wherever such a re-roll lands on a copy of itself.
  const addAlt = (n, track) => {
    const key = keyOf(n, track);
    const raw = ev.raw[key];
    if (ev.alt[key] || !raw) return;
    const r = rerollRare(pools.rare, slotSeed(seq, n, track), raw.id);
    if (!r) return;
    const next = afterReroll(n, track, r.steps);
    ev.alt[key] = { id: r.id, name: names[r.id], steps: r.steps, dest: next.n <= rolls ? keyOf(next.n, next.track) : null };
  };
  for (let n = 1; n <= rolls; n++) {
    for (const track of ['A', 'B']) {
      const cur = ev.raw[keyOf(n, track)];
      const above = ev.raw[keyOf(n - 1, track)];
      if (cur && above && cur.id === above.id && pools.rare.includes(cur.id)) addAlt(n, track);
      const alt = ev.alt[keyOf(n, track)];
      if (alt?.dest) {
        const landing = ev.raw[alt.dest];
        if (landing && landing.id === alt.id && pools.rare.includes(alt.id)) {
          const m = /^(\d+)([AB])$/.exec(alt.dest);
          addAlt(Number(m[1]), m[2]);
        }
      }
    }
  }
  return ev;
}

/** Tables of several banners for one seed. */
function buildEvents(data, events, seed, rolls) {
  const seq = buildSequence(seed, rolls + 2);
  return events.map((event) => buildEvent(data, event, seq, rolls));
}

export {
  BASE,
  RARITIES,
  GUARANTEED_SIZES,
  rarityName,
  poolsOf,
  rarityOfScore,
  scoreColors,
  raisesLegend,
  rerollRare,
  afterReroll,
  buildEvent,
  buildEvents,
};
