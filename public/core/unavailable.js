// Explains the targets that can't even enter the plan (not a gacha cat, not in
// the banners of the chosen dates, not within the analysed rolls). Where it
// helps, it looks further: other upcoming banners, or deeper into the seed, so
// the user knows exactly what to change.

import { MAX_ROLLS } from './config.js';

const RARITY_LABEL = { normal: 'Normal', special: 'Especial' };

const formatDate = (iso) => iso.split('-').reverse().join('/');
const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const banner = (e) => `«${e.name}» (${shortDate(e.start)}–${shortDate(e.end)})`;
const godfatLink = (seed, ev, key, count) => ({
  label: `${key} · ${ev.name}`,
  url: `https://bc.godfat.org/?seed=${seed}&event=${encodeURIComponent(ev.id)}&count=${count}#N${key}`,
});

function poolHas(ev, ids) {
  return ids.some((id) => Object.prototype.hasOwnProperty.call(ev.names, id));
}

function firstOccurrence(ev, ids) {
  const keys = Object.entries(ev.raw)
    .filter(([, c]) => ids.includes(c.id))
    .map(([key]) => key)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  return keys[0] || null;
}

/**
 * @param problems  unavailable targets from resolveTargets
 * @param env       { seed, input, events, upcoming, matchIds, tablesFor(list, rolls) }
 */
function describeUnavailable(problems, env) {
  const { input } = env;
  const items = [];

  // Other upcoming banners (outside the dates): their pools say where a cat is.
  let outside = null;
  if (problems.some((p) => p.reason === 'notInBanners')) {
    const inRange = new Set(env.events.map((e) => e.id));
    outside = env.tablesFor(env.upcoming.filter((e) => !inRange.has(e.id)), 1);
  }

  // Deeper into the seed for cats that are in the pools but not in the rolls.
  const deepNeeded = problems.filter((p) => p.reason === 'notInRolls');
  let deep = null;
  if (deepNeeded.length && input.rolls < MAX_ROLLS) {
    const ids = deepNeeded.flatMap((p) => p.ids);
    const list = env.events.filter((e) => poolHas(e, ids));
    if (list.length) deep = env.tablesFor(list, MAX_ROLLS);
  }

  for (const p of problems) {
    const name = p.query;
    if (p.reason === 'notGacha') {
      items.push({
        target: name,
        headline: `${name} no sale en el gacha.`,
        details: [
          `Es un gato ${RARITY_LABEL[p.rarity] || 'que no es de gacha'}: este tipo de gatos no sale en las cápsulas raras, se consigue de otras formas (por ejemplo, en la tienda, en niveles o en eventos).`,
        ],
        fix: 'Quítalo de los objetivos: ningún plan de tiros puede conseguirlo.',
        links: [],
      });
    } else if (p.reason === 'unknownName') {
      items.push({
        target: name,
        headline: `«${name}» no coincide con ningún gato conocido.`,
        details: ['No está en la lista de gatos del juego ni en los banners de tus fechas.'],
        fix: 'Búscalo en el selector de gatos escribiendo parte de su nombre.',
        links: [],
      });
    } else if (p.reason === 'notInBanners') {
      items.push(notInBanners(p, env, outside));
    } else {
      items.push(notInRolls(p, env, deep));
    }
  }
  return items;
}

function notInBanners(p, env, outside) {
  const { input } = env;
  const name = p.query;
  const range = `entre el ${formatDate(input.from)} y el ${formatDate(input.to)}`;
  const found = (outside || []).filter((e) => env.matchIds(p.match, new Map(Object.entries(e.names).map(([id, n]) => [Number(id), n]))).length);
  const plannable = found.filter((e) => !e.ticket);
  const ticketOnly = found.filter((e) => e.ticket);
  const details = [`Ningún banner ${range} lo incluye, así que en esas fechas no es posible conseguirlo.`];
  let fix;
  if (plannable.length) {
    details.push(`Sí sale en: ${plannable.slice(0, 4).map(banner).join('; ')}.`);
    const first = [...plannable].sort((a, b) => a.start.localeCompare(b.start))[0];
    fix =
      first.start > input.to
        ? `Pon «Hasta» en el ${formatDate(first.start)} o después para incluir ${banner(first)} y vuelve a calcular.`
        : `Ajusta las fechas para incluir ${banner(first)} y vuelve a calcular.`;
  } else if (ticketOnly.length) {
    details.push(`Solo sale en ${ticketOnly.map(banner).join('; ')}, que se paga con tickets Platinum/Legend y no se planifica con Cat Food ni Rare Tickets.`);
    fix = 'Quítalo de los objetivos o consíguelo con tickets Platinum/Legend.';
  } else {
    details.push('Ahora mismo ningún banner anunciado lo incluye, ni dentro ni fuera de tus fechas.');
    fix = 'Habrá que esperar a que se anuncie un banner con este gato.';
  }
  return { target: name, headline: `${name} no está en ningún banner ${range}.`, details, fix, links: [] };
}

function notInRolls(p, env, deep) {
  const { input } = env;
  const name = p.query;
  const banners = env.events.filter((e) => poolHas(e, p.ids));
  const details = [
    `Está entre los gatos posibles de ${banners.slice(0, 4).map(banner).join('; ')}, pero no sale en ninguna de las ${input.rolls} filas revisadas de tu semilla.`,
  ];
  if (input.rolls >= MAX_ROLLS) {
    return {
      target: name,
      headline: `${name} no sale en los próximos ${input.rolls} tiros.`,
      details,
      fix: 'Con tantos tiros por delante no es realista conseguirlo en estas fechas.',
      links: [],
    };
  }
  const hits = (deep || [])
    .map((e) => ({ e, key: firstOccurrence(e, p.ids) }))
    .filter((h) => h.key)
    .sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10));
  if (hits.length) {
    const { e, key } = hits[0];
    const row = parseInt(key, 10);
    const needed = Math.min(MAX_ROLLS, Math.ceil((row + 15) / 10) * 10);
    details.push(`La primera vez que sale es en la fila ${key} de ${banner(e)}.`);
    return {
      target: name,
      headline: `${name} no sale en los próximos ${input.rolls} tiros: aparece por primera vez en la fila ${row}.`,
      details,
      fix: `Sube «¿Cuántos tiros hacia delante revisar?» a ${needed} o más y vuelve a calcular (ten en cuenta que llegar hasta ahí cuesta muchos tiros).`,
      links: [godfatLink(env.seed, e, key, Math.min(MAX_ROLLS, row + 20))],
    };
  }
  details.push(`Tampoco sale en las primeras ${MAX_ROLLS} filas de esos banners.`);
  return {
    target: name,
    headline: `${name} no sale en los próximos ${input.rolls} tiros.`,
    details,
    fix: 'No es realista conseguirlo con tiros en estas fechas.',
    links: [],
  };
}

export { describeUnavailable };
