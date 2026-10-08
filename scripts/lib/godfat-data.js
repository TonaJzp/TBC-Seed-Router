// Turns godfat's build/bc-en.yaml into the compact data file the app loads,
// checking every field it relies on. Anything unexpected is reported instead
// of guessed: `errors` stop the build (the site keeps the previous data) and
// `warnings` are published so the owner is notified.

import { load as loadYaml, JSON_SCHEMA } from 'js-yaml';

const GODFAT = {
  project: 'https://gitlab.com/godfat/battle-cats-rolls',
  file: 'build/bc-en.yaml',
  license: 'Apache-2.0',
};
const KNOWN_EVENT_KEYS = new Set([
  'start_on', 'end_on', 'version', 'name', 'id', 'rare', 'supa', 'uber', 'legend', 'guaranteed', 'step_up', 'platinum',
]);
const KNOWN_TICKETS = new Set(['platinum', 'legend']);
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
 */
function normalizedEnds(raw) {
  const ends = new Map();
  const lastOfSeries = new Map();
  for (const [key, e] of Object.entries(raw.events)) {
    if (typeof e?.end_on !== 'string') continue;
    ends.set(key, e.end_on);
    const series = raw.gacha[e.id]?.series_id ?? null;
    const earlier = lastOfSeries.get(series);
    if (earlier && e.start_on < ends.get(earlier)) ends.set(earlier, e.start_on);
    lastOfSeries.set(series, key);
  }
  return ends;
}

function parseYaml(text) {
  // JSON schema: dates stay as "YYYY-MM-DD" strings.
  return loadYaml(text, { schema: JSON_SCHEMA });
}

/**
 * @param raw   parsed bc-en.yaml
 * @param today build date, YYYY-MM-DD (UTC)
 * @returns { data, errors, warnings }
 */
function transform(raw, { today, source = {} }) {
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
  const events = [];
  const gacha = {};
  for (const [key, e] of Object.entries(raw.events)) {
    if (typeof e?.end_on !== 'string' || endOf.get(key) < from) continue;
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
    events.push({
      id: key,
      gacha: e.id,
      name: e.name,
      start: e.start_on,
      end: endOf.get(key),
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

export { GODFAT, parseYaml, transform, addDays };
