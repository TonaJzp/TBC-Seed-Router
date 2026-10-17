// Compares what the app computes with what bc.godfat.org draws. Used by the
// daily monitoring (scripts/verify-godfat.js) and by the tests.

import { keyOf } from '../../public/core/simulator.js';
import { addDays } from './godfat-data.js';

const MAX_EXAMPLES = 5;

// Position of a cell in the seed sequence: 1A, 1B, 2A... are 1, 2, 3... (rng.js).
const posOf = (key) => 2 * Number.parseInt(key, 10) - (key.endsWith('A') ? 1 : 0);
const keyAt = (pos) => keyOf(Math.ceil(pos / 2), pos % 2 ? 'A' : 'B');
/** The cell above `key` on its track, where godfat's table for an edge re-roll starts. */
const aboveOf = (key) => keyOf(Number.parseInt(key, 10) - 1, key.slice(-1));

/** Collects differences, keeping a few examples of each kind. */
class Differences {
  constructor() {
    this.kinds = new Map();
  }

  add(kind, example) {
    const k = this.kinds.get(kind) || { kind, count: 0, examples: [] };
    k.count++;
    if (k.examples.length < MAX_EXAMPLES) k.examples.push(example);
    this.kinds.set(kind, k);
  }

  get list() {
    return [...this.kinds.values()];
  }
}

/**
 * Compares godfat's banner list with the data's. A banner godfat lists that
 * the data does not have yet is not a difference: godfat's page can show new
 * banners hours before its open data has them (2026-10-16: 7 hours). Those
 * are returned as pending ({ id, name, start, end }), for trackPending.
 */
function compareList(diff, data, webEvents, today) {
  const ours = new Map(data.events.map((e) => [e.id, e]));
  const pending = [];
  for (const w of webEvents) {
    const e = ours.get(w.id);
    if (!e) pending.push({ id: w.id, name: w.name, start: w.start, end: w.end });
    else if (e.start !== w.start || e.end !== w.end) {
      diff.add('Fechas distintas', `${w.id}: web ${w.start}~${w.end}, datos ${e.start}~${e.end}`);
    } else if (e.name !== w.name) diff.add('Nombre de banner distinto', `${w.id}: web «${w.name}», datos «${e.name}»`);
  }
  // Banners surely not past anywhere must be on godfat's list too.
  const listed = new Set(webEvents.map((w) => w.id));
  for (const e of data.events) {
    if (e.end > addDays(today, 1) && !listed.has(e.id)) diff.add('Banner de los datos que la web de godfat no muestra', `${e.id} «${e.name}»`);
  }
  return pending;
}

/**
 * The pending banners of this check, each with the day (YYYY-MM-DD) it was
 * first seen pending: kept from the previous check's list while it stays.
 */
function trackPending(pending, previous, today) {
  const since = new Map((previous || []).map((p) => [p.id, p.since]));
  return pending.map((p) => ({ ...p, since: since.get(p.id) || today }));
}

/**
 * Compares one banner's table. Re-rolls godfat cannot draw on its last rows
 * go to `edges`, if given, to be checked with compareEdgeReroll.
 */
function compareBanner(diff, web, ev, sim, rolls, edges = null) {
  const label = (key) => `${ev.name} · ${key}`;
  for (const r of ['rare', 'super', 'uber', 'legendary']) {
    if (web.pools[r].join() !== ev.pools[r].join()) diff.add(`Gatos ${r} del banner distintos o en otro orden`, ev.name);
  }
  for (const [id, name] of Object.entries(web.names)) {
    if (ev.names[id] !== undefined && ev.names[id] !== name) diff.add('Nombre de gato distinto', `${id}: web «${name}», datos «${ev.names[id]}»`);
  }
  let cells = 0;

  // Normal cells and their legend colours.
  for (let n = 1; n <= rolls; n++) {
    for (const track of ['A', 'B']) {
      const key = keyOf(n, track);
      const w = web.raw[key];
      const o = ev.raw[key];
      if (!w && !o) continue;
      cells++;
      if (!w || !o || w.id !== o.id) diff.add('Gato distinto en una casilla', `${label(key)}: web ${w?.id} ${w?.name ?? '-'}, app ${o?.id} ${o?.name ?? '-'}`);
      const wc = (w?.colors || []).filter((c) => c === 'legend' || c === 'legend_fest').join();
      if (wc !== (o?.colors || []).join()) diff.add('Color de casilla de legendario distinto', `${label(key)}: web «${wc}», app «${(o?.colors || []).join()}»`);
    }
  }

  // Re-rolls of duplicates godfat draws ("R" cells) and where they lead.
  for (const key of new Set([...Object.keys(web.alt), ...Object.keys(ev.alt)])) {
    const w = web.alt[key];
    const o = ev.alt[key];
    // godfat only draws a re-roll when the roll after it is inside its table,
    // as with guaranteed draws below: on its last rows they are checked on a
    // table that starts earlier instead.
    if (!w && o && !o.dest && edges) {
      edges.push(key);
      continue;
    }
    cells++;
    if (!w || !o) diff.add('Repetición de rare que solo aparece en un lado', `${label(key)}: web ${w ? w.id : 'no'}, app ${o ? o.id : 'no'}`);
    else if (w.id !== o.id) diff.add('Gato distinto al repetir un rare', `${label(key)}: web ${w.id}, app ${o.id}`);
    else if (w.dest && o.dest && w.dest !== o.dest) diff.add('Destino distinto tras repetir un rare', `${label(key)}: web → ${w.dest}, app → ${o.dest}`);
  }

  // Guaranteed draws from every cell, also after a re-roll ("G" and "RG").
  if (ev.guaranteedSize) {
    const compareG = (kind, webCells, lastOf) => {
      for (let n = 1; n <= rolls; n++) {
        for (const track of ['A', 'B']) {
          const key = keyOf(n, track);
          const last = lastOf(key);
          if (last === undefined) continue;
          const g = sim.computeGuaranteed(ev, n, track, last, ev.guaranteedSize);
          // godfat only draws it when the roll after it is inside the table.
          const o = g && g.next.n <= rolls ? g : null;
          const w = webCells[key];
          if (!w && !o) continue;
          cells++;
          if (!w || !o) diff.add(`${kind} que solo aparece en un lado`, `${label(key)}: web ${w ? w.id : 'no'}, app ${o ? o.uber.id : 'no'}`);
          else if (w.id !== o.uber.id) diff.add(`${kind}: uber distinto`, `${label(key)}: web ${w.id}, app ${o.uber.id}`);
          else if (w.dest && w.dest !== keyOf(o.next.n, o.next.track)) {
            diff.add(`${kind}: destino distinto`, `${label(key)}: web → ${w.dest}, app → ${keyOf(o.next.n, o.next.track)}`);
          }
        }
      }
    };
    compareG('Garantizado', web.guaranteed, (key) => (ev.raw[key] ? 0 : undefined));
    // After a re-roll the draw starts as if the cat above had just been rolled.
    compareG('Garantizado tras repetir rare', web.altGuaranteed, (key) => (ev.alt[key] ? ev.raw[key].id : undefined));
  } else if (Object.keys(web.guaranteed).length) {
    diff.add('La web muestra garantizados en un banner que los datos no marcan como garantizado', ev.name);
  }
  return cells;
}

/**
 * A re-roll on godfat's last rows, checked on godfat's table opened at the
 * cell above it (as godfat links it), where the cell is 2A. `wide` is the
 * banner computed with rows beyond the table, so the re-roll has its destination.
 */
function compareEdgeReroll(diff, web, ev, key, wide) {
  const label = `${ev.name} · ${key} (tabla desde ${aboveOf(key)}, donde es 2A)`;
  const shift = posOf(key) - posOf('2A');
  const wr = web.raw['2A'];
  const or = wide.raw[key];
  if (!wr || !or || wr.id !== or.id) diff.add('Gato distinto en una casilla', `${label}: web ${wr?.id} ${wr?.name ?? '-'}, app ${or?.id} ${or?.name ?? '-'}`);
  const w = web.alt['2A'];
  const o = wide.alt[key];
  if (!w || !o) diff.add('Repetición de rare que solo aparece en un lado', `${label}: web ${w ? w.id : 'no'}, app ${o ? o.id : 'no'}`);
  else if (w.id !== o.id) diff.add('Gato distinto al repetir un rare', `${label}: web ${w.id}, app ${o.id}`);
  else if (w.dest && o.dest && keyAt(posOf(w.dest) + shift) !== o.dest) {
    diff.add('Destino distinto tras repetir un rare', `${label}: web → ${keyAt(posOf(w.dest) + shift)}, app → ${o.dest}`);
  }
  return 1;
}

export { Differences, compareList, trackPending, compareBanner, compareEdgeReroll, aboveOf };
