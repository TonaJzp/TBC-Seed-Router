// Compares what the app computes with what bc.godfat.org draws. Used by the
// daily monitoring (scripts/verify-godfat.js) and by the tests.

import { keyOf } from '../../public/core/simulator.js';
import { addDays } from './godfat-data.js';

const MAX_EXAMPLES = 5;

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

function compareList(diff, data, webEvents, today) {
  const ours = new Map(data.events.map((e) => [e.id, e]));
  for (const w of webEvents) {
    const e = ours.get(w.id);
    if (!e) diff.add('Banner en la web de godfat que no está en los datos', `${w.id} «${w.name}»`);
    else if (e.start !== w.start || e.end !== w.end) {
      diff.add('Fechas distintas', `${w.id}: web ${w.start}~${w.end}, datos ${e.start}~${e.end}`);
    } else if (e.name !== w.name) diff.add('Nombre de banner distinto', `${w.id}: web «${w.name}», datos «${e.name}»`);
  }
  // Banners surely not past anywhere must be on godfat's list too.
  const listed = new Set(webEvents.map((w) => w.id));
  for (const e of data.events) {
    if (e.end > addDays(today, 1) && !listed.has(e.id)) diff.add('Banner de los datos que la web de godfat no muestra', `${e.id} «${e.name}»`);
  }
}

function compareBanner(diff, web, ev, sim, rolls) {
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

export { Differences, compareList, compareBanner };
