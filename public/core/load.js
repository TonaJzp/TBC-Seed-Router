// How heavy the analysis of a form will be, before calculating: what the
// sidebar shows above «Calcular rutas», and what decides whether a
// calculation asks to be confirmed first. It needs no seed, only the banner
// data, the dates, the chosen cats, the rolls and the tickets, so it is known
// from the first cat chosen.
//
// Measured, not assumed (02-DOCS sdd/progress/analysis-load, T3 and T10:
// ~200 full analyses, 3 seeds, test and site data, 5, 8 and 11 banners):
// - ubers and legendaries make the cost; it depends on how many of them a
//   route can reach, which grows with the rolls up to ~150 and then stays;
// - super rares and rares are in every banner: they weigh a quarter of an
//   uber with up to 5 banners and a third with more;
// - tickets make three searches of what was one, and each count of tickets
//   left is a state of its own: they lengthen the time always, and with many
//   rolls (room for many singles) they also take the search to its limit
//   (02-DOCS ftd audit-2026-10-17b; see ticketUnits).
// The guaranteed zone ends where the hardest lists measured still ended
// whole: ubers concentrated in the longest banners (all of one, then the
// next) reach the safety limit with fewer cats than lists drawn at random.

import { selectEvents } from './planner.js';
import { minuteOf } from './time.js';
import { MIN_ROLLS, MAX_ROLLS } from './config.js';

const RARITY_OF_CODE = { 2: 'rare', 3: 'super', 4: 'uber', 5: 'legend' };

/** Super rares or rares that weigh as much as one uber or legendary, with `banners` banners. */
export const rarityFactor = (banners) => (banners <= 5 ? 4 : 3);

/**
 * The levels, lightest first. `range` is how long such an analysis usually
 * takes at most on a computer; `maxS` the seconds past which it is longer
 * than estimated. Only the last one is outside the guaranteed zone: up to
 * «Pesado», no measured case reached the search's safety limit.
 */
export const LEVELS = [
  { key: 'light', label: 'Ligero', range: 'menos de 10 segundos', maxS: 10, guaranteed: true },
  { key: 'medium', label: 'Medio', range: 'menos de 1 minuto', maxS: 60, guaranteed: true },
  { key: 'heavy', label: 'Pesado', range: 'menos de 3 minutos', maxS: 180, guaranteed: true },
  { key: 'veryHeavy', label: 'Muy pesado', range: 'varios minutos', maxS: Infinity, guaranteed: false },
];

// Units up to which each level holds (light, medium, heavy), by rolls: the
// first band whose `rolls` covers the form's. Above `heavy`, very heavy.
// Concentrated lists reached the safety limit with 24 ubers and 60 rolls, 15
// with 100, 14 with 200 or more; 22, 14 and 13 ended whole in every seed
// (slowest 20.5 s, 37 s, 18.5 s). Super rares and rares alone too: all 54
// reached it with 8 or 11 banners.
const BANDS = [
  { rolls: 60, upTo: [19, 21, 22] },
  { rolls: 100, upTo: [12, 13, 14] },
  { rolls: MAX_ROLLS, upTo: [11, 12, 13] },
];
/**
 * Units that `tickets` Rare Tickets add to the list for the guarantee, with
 * `rolls` rolls (Infinity: never guaranteed). Measured at the edge of the
 * guaranteed zone, as states stored out of the search's limit:
 * - up to 100 rolls, none: at most 39 % with 150 or 400 tickets;
 * - up to 200 rolls, none with up to 60 tickets (13 ubers: 52 %); past 60, two
 *   (13 ubers and 150 tickets: 88 %; 12 and 400: 81 %; 11 and 400: 74 %);
 * - with more rolls they weigh more than the cats: none up to 5 (12 ubers:
 *   19 %), one up to 20 (12 and 20: 47 %), seven up to 60 (6 ubers: 62 %, 10:
 *   93 %, 12: cut) and past 60 never guaranteed (400 tickets: cut with 6).
 */
export function ticketUnits(tickets, rolls) {
  if (!(tickets > 0) || rolls <= 100) return 0;
  if (rolls <= 200) return tickets <= 60 ? 0 : 2;
  if (tickets <= 5) return 0;
  if (tickets <= 20) return 1;
  if (tickets <= 60) return 7;
  return Infinity;
}

const localIsoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The chosen cats (picker keys: cat ids) that the banners of the dates have,
 * counted by rarity, and how many banners those dates have:
 * { uber, legend, super, rare, banners }. Null when no banner can be planned.
 */
export function targetCounts(data, { targets, from, to, now }) {
  let selected;
  try {
    ({ selected } = selectEvents(data, { from, to, today: localIsoDate(now), now: minuteOf(now) }));
  } catch {
    return null; // no banner in the dates: the form says so when calculating
  }
  const inBanners = new Set(selected.flatMap((e) => data.gacha[e.gacha] || []));
  const counts = { uber: 0, legend: 0, super: 0, rare: 0, banners: selected.length };
  for (const key of new Set(targets)) {
    const rarity = RARITY_OF_CODE[data.cats[key]?.rarity];
    if (rarity && inBanners.has(Number(key))) counts[rarity]++;
  }
  return counts;
}

/** The weight of a list: ubers and legendaries, plus super rares and rares by rarityFactor. */
export function loadUnits({ uber, legend, super: supa, rare, banners }) {
  return uber + legend + (supa + rare) / rarityFactor(banners);
}

/**
 * The level of a list (targetCounts), for `rolls` and `tickets`:
 * { level (a LEVELS key), label, range, maxS, guaranteed, share } where
 * `share` (0..1) is how full the bar is. Null when no cat counts.
 */
export function levelOf(counts, rolls, tickets = 0) {
  const units = loadUnits(counts);
  if (units === 0) return null;
  const r = Math.min(MAX_ROLLS, Math.max(MIN_ROLLS, Number.isFinite(rolls) ? rolls : MIN_ROLLS));
  const { upTo } = BANDS.find((b) => r <= b.rolls);
  const last = upTo.length - 1;
  const weight = units + ticketUnits(tickets, r);
  const inZone = weight <= upTo[last];
  // Tickets make three searches of one, each one bigger: in the guaranteed
  // zone, one level longer, two with 20 or more (measured: «Ligero» lists up
  // to 61 s with 20, «Pesado» ones up to 98 s with 60), at most «Pesado».
  const at = upTo.findIndex((limit) => weight <= limit);
  const longer = tickets >= 20 ? 2 : tickets > 0 ? 1 : 0;
  const step = !inZone ? LEVELS.length - 1 : Math.min(at + longer, last);
  // The bar: a quarter per level, filled within it by how near its limit.
  const lo = step === 0 ? 0 : upTo[Math.min(step, upTo.length) - 1];
  const hi = step > last ? upTo[last] * 2 : upTo[step];
  const within = hi > lo ? Math.min(1, Math.max(0, (weight - lo) / (hi - lo))) : 1;
  const { key, label, range, maxS, guaranteed } = LEVELS[step];
  return { level: key, label, range, maxS, guaranteed, share: Math.min(1, (step + within) / LEVELS.length) };
}

/**
 * The load of the analysis of a form (see levelOf), or null with no data
 * yet, no counted cat, or no banner in the dates. Never throws.
 */
export function analysisLoad({ data, targets, from, to, rolls, tickets = 0, now = new Date() }) {
  if (!data || !targets?.length) return null;
  const counts = targetCounts(data, { targets, from, to, now });
  return counts && levelOf(counts, rolls, tickets);
}
