import { buildSequence, raritySeed, slotSeed } from './rng.js';
import { rerollRare, afterReroll } from './gacha.js';

// Banner kinds, from the banner data (godfat GachaPool#guaranteed_rolls):
//   standard   no guaranteed: singles and plain 11-draws
//   guaranteed 11-draw whose 11th cat is a guaranteed uber
//   stepup     3+5+7 step-up: 15 rolls whose 15th cat is a guaranteed uber
const BANNER = { standard: 'standard', guaranteed: 'guaranteed', stepup: 'stepup' };
const GUARANTEED_SIZE = 11;
const STEPUP_SIZE = 15;
const MULTI_SIZE = 11;
const LEGEND_COLORS = { legend: 'legend', legendFest: 'legend_fest' };
const KIND_BY_SIZE = { 0: BANNER.standard, [GUARANTEED_SIZE]: BANNER.guaranteed, [STEPUP_SIZE]: BANNER.stepup };

const keyOf = (n, track) => `${n}${track}`;

function parseKey(key) {
  const m = /^(\d+)([AB])$/.exec(key || '');
  return m ? { n: Number(m[1]), track: m[2] } : null;
}

/**
 * Rolls across the banners of one seed (tables from gacha.js), including what
 * godfat cannot draw on a single banner page: a duplicate rare caused by the
 * previous cat of *another* banner, and guaranteed draws whose normal rolls
 * cross tracks because of such duplicates.
 */
class Simulator {
  constructor(seed, events, maxN) {
    this.maxN = maxN;
    this.seq = buildSequence(seed, maxN + 2);
    this.events = events;
    this.rawIdsCache = new Map();
    // Purple/lilac cells are a property of the seed position, so a position is
    // protected if any banner colours it.
    this.legendColors = new Map();
    for (const ev of events) {
      ev.rarityOf = new Map();
      for (const [rarity, ids] of Object.entries(ev.pools)) {
        for (const id of ids) ev.rarityOf.set(id, rarity);
      }
      for (const [key, c] of Object.entries(ev.raw)) {
        for (const color of c.colors) {
          if (color !== LEGEND_COLORS.legend && color !== LEGEND_COLORS.legendFest) continue;
          if (!this.legendColors.has(key)) this.legendColors.set(key, new Set());
          this.legendColors.get(key).add(color);
        }
      }
      ev.guaranteedSize ||= 0;
      ev.kind = KIND_BY_SIZE[ev.guaranteedSize];
      if (!ev.kind) throw new Error(`Banner «${ev.name}»: garantizado de ${ev.guaranteedSize} tiros no soportado.`);
    }
  }

  cell(ev, n, track) {
    return ev.raw[keyOf(n, track)] || null;
  }

  /** Raw cat ids of every banner at a position (the candidates for a duplicate). */
  rawIdsAt(n, track) {
    const key = keyOf(n, track);
    let ids = this.rawIdsCache.get(key);
    if (!ids) {
      ids = new Set(this.events.map((ev) => ev.raw[key]?.id).filter((id) => id !== undefined));
      this.rawIdsCache.set(key, ids);
    }
    return ids;
  }

  /** Legendaries that some banner gives at this cell (banners without legends give an uber there). */
  legendsAt(n, track) {
    const key = keyOf(n, track);
    const out = [];
    for (const ev of this.events) {
      const c = ev.raw[key];
      if (c && ev.rarityOf.get(c.id) === 'legendary') out.push({ id: c.id, name: c.name, eventId: ev.id, eventName: ev.name });
    }
    return out;
  }

  legendColorsAt(n, track) {
    return this.legendColors.get(keyOf(n, track)) || new Set();
  }

  isProtected(n, track, { avoidLegend, avoidLegendFest }) {
    const colors = this.legendColorsAt(n, track);
    return (
      (avoidLegend && colors.has(LEGEND_COLORS.legend)) ||
      (avoidLegendFest && colors.has(LEGEND_COLORS.legendFest))
    );
  }

  /** Re-roll of a duplicated rare at (n, track): { id, next }, or null if the pool can't re-roll it. */
  rerollDuplicate(ev, n, track, rawId) {
    const r = rerollRare(ev.pools.rare, slotSeed(this.seq, n, track), rawId);
    return r && { id: r.id, next: afterReroll(n, track, r.steps) };
  }

  /** One single draw at (n, track); `last` is the id of the previously obtained cat. */
  single(ev, n, track, last) {
    const raw = this.cell(ev, n, track);
    if (!raw) return null;
    const rarity = ev.rarityOf.get(raw.id) || 'unknown';
    if (rarity === 'rare' && raw.id === last) {
      const r = this.rerollDuplicate(ev, n, track, raw.id);
      if (!r || r.next.n > this.maxN) return null;
      return { cat: this.catInfo(ev, r.id), rerolled: true, dupeOf: raw.id, landed: [{ n, track }], next: r.next };
    }
    return {
      cat: this.catInfo(ev, raw.id),
      rerolled: false,
      landed: [{ n, track }],
      next: { n: n + 1, track },
    };
  }

  /** `count` consecutive normal rolls (a plain 11-draw, or the body of a guaranteed one). */
  multi(ev, n, track, last, count) {
    const cats = [];
    const landed = [];
    let pos = { n, track };
    let l = last;
    for (let i = 0; i < count; i++) {
      const r = this.single(ev, pos.n, pos.track, l);
      if (!r) return null;
      cats.push({ ...r.cat, rerolled: r.rerolled });
      landed.push(pos);
      l = r.cat.id;
      pos = r.next;
    }
    return { cats, landed, next: pos };
  }

  /** Guaranteed draw of the banner's size (11 or step-up 15); null if the banner has none. */
  guaranteed(ev, n, track, last) {
    if (!ev.guaranteedSize) return null;
    return this.computeGuaranteed(ev, n, track, last, ev.guaranteedSize);
  }

  // size - 1 normal rolls, then the uber is picked with a single (half) roll
  // on the next rarity seed, which swaps the track.
  computeGuaranteed(ev, n, track, last, size) {
    const body = this.multi(ev, n, track, last, size - 1);
    if (!body) return null;
    const { cats, landed } = body;
    const pos = body.next;
    if (pos.n > this.maxN || !this.cell(ev, pos.n, pos.track)) return null;
    const uberId = this.guaranteedUber(ev, pos.n, pos.track);
    if (uberId === null) return null;
    landed.push(pos);
    const next = pos.track === 'A' ? { n: pos.n, track: 'B' } : { n: pos.n + 1, track: 'A' };
    return { cats, uber: { ...this.catInfo(ev, uberId), guaranteed: true }, landed, uberAt: pos, next };
  }

  catInfo(ev, id) {
    return { id, name: ev.names[id] || `#${id}`, rarity: ev.rarityOf.get(id) || 'unknown' };
  }

  /** Every cat id that some roll inside the horizon can produce, per banner. */
  obtainableIds() {
    const ids = new Set();
    for (const ev of this.events) {
      for (const [key, c] of Object.entries(ev.raw)) {
        ids.add(c.id);
        const { n, track } = parseKey(key);
        if (ev.rarityOf.get(c.id) === 'rare') {
          const r = this.rerollDuplicate(ev, n, track, c.id);
          if (r) ids.add(r.id);
        }
        if (ev.guaranteedSize) {
          const uber = this.guaranteedUber(ev, n, track);
          if (uber !== null) ids.add(uber);
        }
      }
    }
    return ids;
  }

  /** Uber a guaranteed draw gives when its last roll falls on (n, track); null if the banner has none. */
  guaranteedUber(ev, n, track) {
    const pool = ev.pools.uber;
    return pool.length ? pool[raritySeed(this.seq, n, track) % pool.length] : null;
  }
}

export { Simulator, keyOf, parseKey, BANNER, GUARANTEED_SIZE, STEPUP_SIZE, MULTI_SIZE };
