// Turns godfat's build/bc-en.yaml into the compact data file the app loads,
// checking every field it relies on. Anything unexpected is reported instead
// of guessed: `errors` stop the build (the site keeps the previous data) and
// `warnings` are published so the owner is notified.

import { load as loadYaml, JSON_SCHEMA } from 'js-yaml';

const GODFAT = {
  project: 'https://gitlab.com/godfat/battle-cats-rolls',
  file: 'build/bc-en.yaml',
  // The game's own event files, which also have the hour of each banner.
  eventsDir: 'data/en/events',
  license: 'Apache-2.0',
};
const KNOWN_EVENT_KEYS = new Set([
  'start_on', 'end_on', 'version', 'name', 'id', 'rare', 'supa', 'uber', 'legend', 'guaranteed', 'step_up', 'platinum',
]);
const KNOWN_TICKETS = new Set(['platinum', 'legend']);
// Banners change at 11:00 in the game data; only used if the hour is missing.
const DEFAULT_HOUR = '11:00';
const GACHA_RARITIES = new Set([2, 3, 4, 5]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Banners that ended up to two days ago stay in the data: a visitor far to the
// west of the build may still be on that day.
const KEEP_ENDED_DAYS = 2;
// Without a plannable banner lasting this many days ahead, the data is stale.
const FRESH_DAYS = 3;

const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isInt = (v) => Number.isInteger(v);

/**
 * End dates as godfat's site shows them (CrystalBall#noramlize_end_date_by_series_id!):
 * in file order, a banner ends when the next banner of the same series starts,
 * if that is earlier. Banners without a series share one, as in godfat.
 * Returns key -> { date, by: the key of the banner that cut it short, or null }.
 */
function normalizedEnds(raw) {
  const ends = new Map();
  const lastOfSeries = new Map();
  for (const [key, e] of Object.entries(raw.events)) {
    if (typeof e?.end_on !== 'string') continue;
    ends.set(key, { date: e.end_on, by: null });
    const series = raw.gacha[e.id]?.series_id ?? null;
    const earlier = lastOfSeries.get(series);
    if (earlier && e.start_on < ends.get(earlier).date) ends.set(earlier, { date: e.start_on, by: key });
    lastOfSeries.set(series, key);
  }
  return ends;
}

/**
 * Hours of the rare gacha banners from one of the game's event files
 * (gatya.tsv, as godfat stores it): key "YYYY-MM-DD_<gacha id>" -> { start,
 * end } as "HH:MM", in the player's local time. Port of godfat's
 * TsvReader#gacha (Apache 2.0), keeping only the dates and hours.
 */
function eventHours(tsv) {
  const POOL_OFFSET = 9;
  const POOL_FIELDS = 15;
  const date = (v) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
  const hour = (v) => {
    const n = /^\d{1,4}$/.test(v) ? Number(v) : NaN;
    return n % 100 < 60 && n < 2400 ? `${String(Math.floor(n / 100)).padStart(2, '0')}:${String(n % 100).padStart(2, '0')}` : null;
  };
  const hours = new Map();
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line.startsWith('[')) continue; // [start], [end]
    const row = line.split('\t');
    if (Number(row[8]) !== 1) continue; // rare gacha
    // The banner's pool is pool number row[9], in blocks of 15 fields after it.
    const first = POOL_OFFSET + 1 + POOL_FIELDS * (Number(row[POOL_OFFSET]) - 1);
    if (!(first > POOL_OFFSET) || row.length < first + POOL_FIELDS) continue;
    const id = Number(row[first]);
    const start = date(row[0]);
    if (!(id > 0) || !start) continue;
    hours.set(`${start}_${id}`, { start: hour(row[1]), end: hour(row[3]), endDate: date(row[2]) });
  }
  return hours;
}

function parseYaml(text) {
  // JSON schema: dates stay as "YYYY-MM-DD" strings.
  return loadYaml(text, { schema: JSON_SCHEMA });
}

/**
 * @param raw   parsed bc-en.yaml
 * @param today build date, YYYY-MM-DD (UTC)
 * @param hours eventHours() of the game's event file, or null if it could not be read
 * @returns { data, errors, warnings }
 */
function transform(raw, { today, source = {}, hours = null }) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || !raw.cats || !raw.gacha || !raw.events) {
    return { data: null, errors: ['El archivo de godfat no tiene las secciones cats, gacha y events.'], warnings };
  }

  // Cats: names and rarity of every unit.
  const allCats = {};
  for (const [id, c] of Object.entries(raw.cats)) {
    if (!isInt(Number(id)) || !Array.isArray(c?.name) || !c.name.length || !isInt(c.rarity) || c.rarity < 0 || c.rarity > 5) {
      errors.push(`Gato ${id}: formato inesperado (se esperaba name: [...] y rarity 0-5).`);
      continue;
    }
    allCats[id] = { names: c.name.map((n) => (typeof n === 'string' ? n : '')), rarity: c.rarity };
  }

  // Every cat that has ever been in an English gacha, to keep unreleased or
  // other-version units out of the picker.
  const everInGacha = new Set();
  for (const g of Object.values(raw.gacha)) for (const id of g?.cats || []) everInGacha.add(String(id));

  const endOf = normalizedEnds(raw);
  const from = addDays(today, -KEEP_ENDED_DAYS);
  if (!hours) warnings.push(`No se ha podido leer la hora de los banners (${GODFAT.eventsDir}); se usa ${DEFAULT_HOUR}, la habitual.`);
  // The hour a banner starts or ends, checked against the event file.
  const hourOf = (key, kind, where) => {
    if (!hours) return DEFAULT_HOUR;
    const t = hours.get(key);
    if (t?.[kind]) return t[kind];
    warnings.push(`${where}: no se encuentra su hora de ${kind === 'start' ? 'inicio' : 'fin'} en los datos del juego; se usa ${DEFAULT_HOUR}.`);
    return DEFAULT_HOUR;
  };
  const events = [];
  const gacha = {};
  for (const [key, e] of Object.entries(raw.events)) {
    if (typeof e?.end_on !== 'string' || endOf.get(key).date < from) continue;
    const where = `Banner ${key}`;
    const unknown = Object.keys(e).filter((k) => !KNOWN_EVENT_KEYS.has(k));
    if (unknown.length) warnings.push(`${where}: campos nuevos en los datos de godfat (${unknown.join(', ')}); puede ser una mecánica nueva que la app no conoce.`);
    if (!ISO_DATE.test(e.start_on) || !ISO_DATE.test(e.end_on) || e.start_on > e.end_on) {
      errors.push(`${where}: fechas no válidas (${e.start_on} ~ ${e.end_on}).`);
      continue;
    }
    if (!isInt(e.id) || typeof e.name !== 'string') {
      errors.push(`${where}: falta el id o el nombre.`);
      continue;
    }
    const rates = [e.rare, e.supa, e.uber];
    if (!rates.every((r) => isInt(r) && r >= 0) || e.rare + e.supa + e.uber > 10000) {
      errors.push(`${where}: probabilidades no válidas (rare ${e.rare}, supa ${e.supa}, uber ${e.uber}).`);
      continue;
    }
    if (e.legend !== undefined && e.legend !== 10000 - e.rare - e.supa - e.uber) {
      warnings.push(`${where}: la probabilidad de legend (${e.legend}) no cuadra con el resto (${10000 - e.rare - e.supa - e.uber}).`);
    }
    if (e.guaranteed && e.step_up) {
      errors.push(`${where}: marcado a la vez como garantizado y step-up.`);
      continue;
    }
    if (e.platinum !== undefined && !KNOWN_TICKETS.has(e.platinum)) {
      warnings.push(`${where}: tipo de ticket desconocido «${e.platinum}»; se trata como banner de tickets.`);
    }
    const cats = raw.gacha[e.id]?.cats;
    if (!Array.isArray(cats) || !cats.length) {
      errors.push(`${where}: no hay lista de gatos para el gacha ${e.id}.`);
      continue;
    }
    const bad = cats.filter((id) => !allCats[id] || (!e.platinum && !GACHA_RARITIES.has(allCats[id].rarity)));
    if (bad.length) {
      errors.push(`${where}: gatos que faltan o no son de gacha en su lista: ${bad.slice(0, 5).join(', ')}.`);
      continue;
    }
    gacha[e.id] = cats;
    const end = endOf.get(key);
    if (hours?.get(key) && hours.get(key).endDate !== e.end_on) {
      warnings.push(`${where}: la fecha de fin no coincide con los datos del juego (${e.end_on} / ${hours.get(key).endDate}).`);
    }
    events.push({
      id: key,
      gacha: e.id,
      name: e.name,
      start: e.start_on,
      end: end.date,
      // Hours in the player's local time, as the game applies them. A banner
      // cut short by the next one of its series ends when that one starts.
      startTime: hourOf(key, 'start', where),
      endTime: end.by ? hourOf(end.by, 'start', `Banner ${end.by}`) : hourOf(key, 'end', where),
      rare: e.rare,
      supa: e.supa,
      uber: e.uber,
      guaranteed: e.guaranteed ? 11 : e.step_up ? 15 : 0,
      ticket: e.platinum ?? null,
    });
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  const plannableAhead = events.filter((e) => !e.ticket && e.end >= addDays(today, FRESH_DAYS));
  if (!plannableAhead.length) {
    warnings.push(`No hay banners anunciados más allá del ${addDays(today, FRESH_DAYS)}: puede que godfat no haya publicado los datos nuevos.`);
  }

  const cats = {};
  for (const [id, c] of Object.entries(allCats)) {
    if (!GACHA_RARITIES.has(c.rarity) || everInGacha.has(id)) cats[id] = c;
  }

  return {
    data: { version: 1, generatedAt: new Date().toISOString(), source: { ...GODFAT, ...source }, events, gacha, cats },
    errors,
    warnings,
  };
}

export { GODFAT, parseYaml, transform, addDays, eventHours };
