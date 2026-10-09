// Explains, target by target, why the plan can't get every cat: which cells of
// the seed block the way, which protection causes it, which targets exclude
// each other... Every explanation names concrete cells and banners and links
// to them on godfat, so the user can check it on their own seed.

import { keyOf, parseKey } from './simulator.js';
import { rollSlot, performAction, actionsFor, findRoute, countsAsTarget } from './optimizer.js';

const COLOR_NAME = { legend: 'morada', legend_fest: 'lila' };
const MAX_STATES = 400_000;
const MAX_KEYS_SHOWN = 6;
const MAX_LINKS = 8;

const formatDate = (iso) => iso.split('-').reverse().join('/');
const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const rowOf = (key) => parseInt(key, 10);
const byRow = (a, b) => rowOf(a) - rowOf(b) || a.localeCompare(b);
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0] || '');

/**
 * Walks every state of the seed the plan could reach (position, last cat,
 * time), ignoring costs and targets. Records which cats can be obtained where
 * (a cat rolled on a protected cell only counts if it is a legendary), the
 * protected cells where a cat was not counted, and how far the seed goes.
 */
function explore(ctx, protect, { ignoreTime = false } = {}) {
  const { sim, events } = ctx;
  const canonical = (n, track, last) => (sim.rawIdsAt(n, track).has(last) ? last : 0);
  const queue = [{ n: 1, track: 'A', last: canonical(1, 'A', ctx.inventory.lastCat), slot: ctx.startSlot }];
  const seen = new Set();
  const obtained = new Map(); // cat id -> [{ eventId, key, guaranteed }]
  const blocked = new Map(); // protected cell where a cat did not count -> its colours
  let maxRow = 0;
  let truncated = false;

  while (queue.length) {
    const s = queue.pop();
    const id = `${s.n}${s.track}|${s.last}|${s.slot}`;
    if (seen.has(id)) continue;
    if (seen.size >= MAX_STATES) {
      truncated = true;
      break;
    }
    seen.add(id);
    for (const ev of events) {
      const slot = ignoreTime ? s.slot : rollSlot(s.slot, ev, ctx.endSlot);
      if (slot === null) continue;
      for (const type of actionsFor(ev)) {
        const roll = performAction(sim, ev, type, s);
        if (!roll) continue;
        roll.cats.forEach((cat, i) => {
          const p = roll.landed[i];
          maxRow = Math.max(maxRow, p.n);
          const key = keyOf(p.n, p.track);
          if (!countsAsTarget(sim, protect, cat, p)) {
            if (!blocked.has(key)) blocked.set(key, [...sim.legendColorsAt(p.n, p.track)]);
            return;
          }
          const spots = obtained.get(cat.id) || [];
          if (spots.length < 40 && !spots.some((x) => x.eventId === ev.id && x.key === key)) {
            spots.push({ eventId: ev.id, key, guaranteed: !!cat.guaranteed });
          }
          obtained.set(cat.id, spots);
        });
        const last = roll.cats[roll.cats.length - 1].id;
        queue.push({ n: roll.next.n, track: roll.next.track, last: canonical(roll.next.n, roll.next.track, last), slot });
      }
    }
  }
  return { obtained, blocked, maxRow, truncated };
}

class Diagnoser {
  constructor(ctx, routes, { seed, rolls }) {
    this.ctx = ctx;
    this.routes = routes;
    this.seed = seed;
    this.rolls = rolls;
    this.events = new Map(ctx.events.map((e) => [e.id, e]));
    this.cache = new Map();
  }

  reach(protect, options = {}) {
    const key = JSON.stringify([!!protect.avoidLegend, !!protect.avoidLegendFest, !!options.ignoreTime]);
    if (!this.cache.has(key)) this.cache.set(key, explore(this.ctx, protect, options));
    return this.cache.get(key);
  }

  link(eventId, key) {
    const ev = this.events.get(eventId) || this.ctx.events[0];
    return {
      label: `${key} · ${ev.name}`,
      url: `https://bc.godfat.org/?seed=${this.seed}&event=${encodeURIComponent(ev.id)}&count=${this.rolls}#N${key}`,
    };
  }

  eventLabel(eventId) {
    const ev = this.events.get(eventId);
    return ev ? `«${ev.name}» (${shortDate(ev.start)}–${shortDate(ev.end)})` : eventId;
  }

  cellLabel(key) {
    const colors = this.ctx.sim.legendColorsAt(rowOf(key), key.at(-1));
    const names = [...colors].map((c) => COLOR_NAME[c]).filter(Boolean);
    return names.length ? `${key} (${names.join(' y ')})` : key;
  }

  /** "«Banner» (13/10–16/10): 14A, 98B; «Otro»…" for a list of spots. */
  describeSpots(spots) {
    const byEvent = new Map();
    for (const s of spots) {
      if (!byEvent.has(s.eventId)) byEvent.set(s.eventId, new Set());
      byEvent.get(s.eventId).add(s.key + (s.guaranteed ? ' (uber garantizado)' : ''));
    }
    const parts = [...byEvent].slice(0, 4).map(([eventId, keys]) => {
      const sorted = [...keys].sort(byRow);
      const more = sorted.length > MAX_KEYS_SHOWN ? ` y ${sorted.length - MAX_KEYS_SHOWN} más` : '';
      return `${this.eventLabel(eventId)}: ${sorted.slice(0, MAX_KEYS_SHOWN).join(', ')}${more}`;
    });
    if (byEvent.size > 4) parts.push(`y ${byEvent.size - 4} banners más`);
    return parts.join('; ');
  }

  spotLinks(spots) {
    return [...spots].sort((a, b) => byRow(a.key, b.key)).slice(0, MAX_LINKS).map((s) => this.link(s.eventId, s.key));
  }

  /** Every cell of the computed tables where the target appears (any path or not). */
  occurrences(target) {
    const spots = [];
    for (const ev of this.ctx.events) {
      for (const [key, c] of Object.entries(ev.raw)) if (target.ids.has(c.id)) spots.push({ eventId: ev.id, key });
      for (const [key, c] of Object.entries(ev.alt)) {
        if (target.ids.has(c.id)) spots.push({ eventId: ev.id, key, reroll: true });
      }
    }
    return spots;
  }

  spotsIn(reach, target) {
    return [...target.ids].flatMap((id) => reach.obtained.get(id) || []);
  }

  run() {
    const recommended = this.routes.find((r) => r.recommended);
    const items = [];
    if (recommended && recommended.exhausted) {
      items.push({
        target: null,
        headline: 'La búsqueda fue demasiado grande y se cortó antes de terminar.',
        details: [
          'Con tantas combinaciones posibles (banners × tiros × objetivos), el cálculo llegó a su límite de seguridad.',
          'La ruta mostrada es válida, pero puede no ser la mejor ni la más completa.',
        ],
        fix: 'Reduce el rango de fechas, los tiros a revisar o el número de gatos objetivo y vuelve a calcular.',
        links: [],
      });
    }
    const missing = this.ctx.targets.filter((t, i) => !(recommended?.found && recommended.targets[i].obtained));
    // Causes shared by several cats (e.g. one wall of protected cells) are
    // explained once, listing every cat they affect.
    const groups = new Map();
    for (const target of missing) {
      const item = this.diagnose(target);
      if (!item.group) {
        items.push(item);
        continue;
      }
      const g = groups.get(item.group);
      if (!g) {
        const merged = { ...item, targets: [item.target], details: [...item.details] };
        groups.set(item.group, merged);
        items.push(merged);
      } else {
        g.targets.push(item.target);
        if (item.groupHeadline) g.headline = item.groupHeadline;
        g.details.splice(g.details.length - 1, 0, ...item.perTarget);
        g.links = [...g.links, ...item.links.filter((l) => !g.links.some((x) => x.url === l.url))].slice(0, MAX_LINKS);
      }
    }
    return items.map(({ group, perTarget, groupHeadline, ...item }) => ({ ...item, target: item.targets ? list(item.targets) : item.target }));
  }

  diagnose(target) {
    const protect = this.ctx.protect;
    const protecting = protect.avoidLegend || protect.avoidLegendFest;
    const reach = this.reach(protect);
    const has = (r) => this.spotsIn(r, target).length > 0;
    if (has(reach)) return this.conflict(target, reach);
    if (protecting && has(this.reach({}))) return this.protection(target);
    return this.structural(target);
  }

  // --- Protection keeps the cat's only cells -------------------------------
  // Rolls can always land on protected cells; what the protection does is not
  // count a (non-legendary) target rolled there. So the cat can only be missing
  // because every cell where it can be obtained is protected.
  protection(target) {
    const { protect } = this.ctx;
    const name = target.names.join(' / ');
    const freeSpots = this.spotsIn(this.reach({}), target);

    let culprit;
    if (protect.avoidLegend && protect.avoidLegendFest) {
      const purple = !this.spotsIn(this.reach({ avoidLegend: true }), target).length;
      const lilac = !this.spotsIn(this.reach({ avoidLegendFest: true }), target).length;
      culprit = purple && lilac ? 'moradas y lilas' : purple ? 'moradas' : lilac ? 'lilas' : 'moradas y lilas';
    } else {
      culprit = protect.avoidLegend ? 'moradas' : 'lilas';
    }
    const labelled = freeSpots.map((s) => ({ ...s, key: this.cellLabel(s.key) }));
    return {
      target: name,
      group: `protected|${culprit}`,
      groupHeadline: `Con la protección de casillas ${culprit}, estos gatos no se pueden conseguir: solo salen en casillas protegidas.`,
      perTarget: [`${name} solo se puede conseguir en: ${this.describeSpots(labelled)}.`],
      headline: `Con la protección de casillas ${culprit}, ${name} no se puede conseguir: solo sale en casillas protegidas.`,
      details: [
        `${name} solo se puede conseguir en: ${this.describeSpots(labelled)}.`,
        `Esas casillas son de legendario. Con la protección de casillas ${culprit} activada, las rutas pueden pasar por ellas, pero un gato objetivo que salga ahí no cuenta (salvo que sea el propio legendario), para no gastar la oportunidad de legendario.`,
      ],
      fix: `Desactiva la protección de casillas ${culprit} si prefieres gastar esa casilla en este gato, o quítalo de los objetivos.`,
      links: this.spotLinks(freeSpots),
    };
  }

  // --- No path at all, even without protection ------------------------------
  structural(target) {
    const name = target.names.join(' / ');
    const usable = this.occurrences(target);

    // Reachable if time didn't matter? Then the dates are the problem.
    if (this.spotsIn(this.reach(this.ctx.protect, { ignoreTime: true }), target).length) {
      const banners = [...new Set(usable.map((s) => s.eventId))].map((id) => this.eventLabel(id));
      return {
        target: name,
        headline: `Las fechas de los banners impiden llegar a ${name}.`,
        details: [
          `${name} sale en: ${this.describeSpots(usable)}.`,
          ...this.forcedSwitches(usable),
          `Para llegar a esas casillas hace falta usar antes otros banners que solo empiezan cuando ${list(banners)} ya ha terminado. Las tiradas solo avanzan en el tiempo: no se puede volver a un evento terminado.`,
        ],
        fix: 'Prueba con otro rango de fechas (o espera a que vuelva el banner de este gato).',
        links: this.spotLinks(usable),
      };
    }

    const notes = this.forcedSwitches(usable);
    return {
      target: name,
      headline: `Ninguna combinación de tiros llega a las casillas donde sale ${name}.`,
      details: [
        `${name} sale en: ${this.describeSpots(usable)}.`,
        ...notes,
        'En la semilla solo se avanza: cada tiro pasa a la fila siguiente, y la pista solo cambia con un rare duplicado o con un garantizado. Con los banners de tus fechas, ninguna secuencia de esos tiros termina en esas casillas.',
      ],
      fix: 'Revisa más tiros hacia delante por si vuelve a salir más adelante, o amplía las fechas para incluir otros banners.',
      links: this.spotLinks(usable),
    };
  }

  /** Rows where every banner forces a duplicate re-roll (and so a track switch). */
  forcedSwitches(spots) {
    const notes = [];
    const seen = new Set();
    for (const s of [...spots].sort((a, b) => byRow(a.key, b.key)).slice(0, 4)) {
      const { n, track } = parseKey(s.key);
      for (let r = n - 1; r >= Math.max(2, n - 4); r--) {
        const k = keyOf(r, track);
        if (seen.has(k)) continue;
        const forced = this.ctx.events.every((ev) => {
          const cur = ev.raw[k];
          const prev = ev.raw[keyOf(r - 1, track)];
          return cur && prev && cur.id === prev.id && ev.rarityOf.get(cur.id) === 'rare';
        });
        if (!forced) continue;
        seen.add(k);
        const cat = this.ctx.events[0].raw[k].name;
        notes.push(
          `En ${k} sale siempre el mismo rare que en ${keyOf(r - 1, track)} (${cat}) en todos los banners: el juego lo cambia por otro gato y te pasa a la otra pista, así que no se puede seguir por la pista ${track} hasta ${s.key}.`
        );
      }
    }
    return notes;
  }

  // --- Reachable alone, but not together with other targets -----------------
  conflict(target, reach) {
    const name = target.names.join(' / ');
    const ctx = this.ctx;
    const conflicts = [];
    for (const other of ctx.targets) {
      if (other === target) continue;
      const pair = findRoute({ ...ctx, targets: [target, other] }, 'fastest', { enforceBudget: false });
      if (!pair.complete) conflicts.push(other);
    }
    const mySpots = this.spotsIn(reach, target);
    if (!conflicts.length) {
      return {
        target: name,
        headline: `${name} se puede conseguir por separado, pero no a la vez que todos los demás objetivos.`,
        details: [
          `${name} sale en: ${this.describeSpots(mySpots)}.`,
          'Con cada uno de los otros objetivos por separado sí hay ruta; el choque aparece al juntar tres o más: conseguir unos obliga a pasar de largo las casillas de otros.',
        ],
        fix: 'Quita alguno de los objetivos menos importantes y vuelve a calcular.',
        links: this.spotLinks(mySpots),
      };
    }
    const names = conflicts.map((c) => c.names.join(' / '));
    return {
      target: name,
      headline: `${name} no se puede conseguir en la misma ruta que ${list(names)}.`,
      details: [
        `${name} solo sale en: ${this.describeSpots(mySpots)}.`,
        ...conflicts.map((c) => `${c.names.join(' / ')} solo sale en: ${this.describeSpots(this.spotsIn(reach, c))}.`),
        'Una ruta solo avanza: no puede volver a una fila anterior de la semilla ni a un evento que ya terminó. Para conseguir uno hay que pasar de largo (o dejar atrás en el tiempo) las casillas del otro.',
      ],
      fix: `Elige cuál prefieres: quita ${list(names)} o ${name} y vuelve a calcular.`,
      links: [...this.spotLinks(mySpots).slice(0, 4), ...conflicts.flatMap((c) => this.spotLinks(this.spotsIn(reach, c)).slice(0, 2))],
    };
  }
}

/** Explanations for every target the recommended route doesn't get. */
function diagnose(ctx, routes, meta) {
  return new Diagnoser(ctx, routes, meta).run();
}

export { diagnose, explore, formatDate };
