// Builds the site data: downloads godfat's open data (the latest commit of
// build/bc-en.yaml), checks it, adds the wiki icons and writes
// public/data/gacha.json. Run daily by GitHub Actions and by `npm start`.
//
//   node scripts/build.js                 latest data from GitLab
//   node scripts/build.js --yaml <file> [--tsv <file>]
//                                         local copies of bc-en.yaml and of an event file
//   node scripts/build.js --no-icons      skip the wiki icons
//   node scripts/build.js --published <site URL>
//                                         reuse the icons of the published site
//
// Exit code 1 if the data can't be used: the published site keeps the
// previous data. Warnings (about the data) go to .cache/build-report.json and
// notify the owner; notes (icons retried on the next build) are only logged.
// Cats of the banners left without an icon notify the owner when the wiki
// could not be asked, or when their banner has already started.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GODFAT, parseYaml, transform, eventHours } from './lib/godfat-data.js';
import { buildIcons, missingIcons } from './lib/wiki-icons.js';
import { USER_AGENT } from './lib/identity.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'gacha.json');
const ICONS_OUT = path.join(ROOT, 'public', 'icons');
const CACHE = path.join(ROOT, '.cache');
const REPORT = path.join(CACHE, 'build-report.json');
const GITLAB_API = 'https://gitlab.com/api/v4/projects/godfat%2Fbattle-cats-rolls/repository';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} respondió HTTP ${res.status}`);
  return res.json();
}

async function getRaw(commit, file) {
  const res = await fetch(`${GODFAT.project}/-/raw/${commit}/${file}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`No se pudo descargar ${file} (HTTP ${res.status}).`);
  return res.text();
}

/** The latest bc-en.yaml from godfat's repository, pinned to its commit. */
async function downloadGodfat() {
  const [commit] = await getJson(`${GITLAB_API}/commits?${new URLSearchParams({ path: GODFAT.file, per_page: '1' })}`);
  if (!commit?.id) throw new Error('GitLab no devolvió el último commit de los datos de godfat.');
  return { text: await getRaw(commit.id, GODFAT.file), source: { commit: commit.id, committedAt: commit.committed_date } };
}

/**
 * The game's newest event file at the same commit (data/en/events/YYYYMMDD.tsv,
 * a full copy of the schedule): bc-en.yaml is built from these files but
 * leaves out the hours. Returns its text and name.
 */
async function downloadEventFile(commit) {
  const names = [];
  for (let page = 1; page < 50; page++) {
    const query = new URLSearchParams({ path: GODFAT.eventsDir, ref: commit, per_page: '100', page: String(page) });
    const list = await getJson(`${GITLAB_API}/tree?${query}`);
    names.push(...list.map((f) => f.name).filter((n) => /^\d{8}\.tsv$/.test(n)));
    if (list.length < 100) break;
  }
  const newest = names.sort().at(-1);
  if (!newest) throw new Error(`no hay archivos de eventos en ${GODFAT.eventsDir}`);
  return { text: await getRaw(commit, `${GODFAT.eventsDir}/${newest}`), name: newest };
}

function writeReport(report) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const yamlFile = arg('--yaml');
  let text;
  let source;
  try {
    ({ text, source } = yamlFile
      ? { text: fs.readFileSync(yamlFile, 'utf8'), source: { commit: 'local', committedAt: null } }
      : await downloadGodfat());
  } catch (err) {
    writeReport({ ok: false, errors: [err.message], warnings: [] });
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // Hours of the banners: a missing event file is reported, not fatal.
  let hours = null;
  try {
    const tsvFile = arg('--tsv');
    const events = yamlFile ? (tsvFile ? { text: fs.readFileSync(tsvFile, 'utf8'), name: tsvFile } : null) : await downloadEventFile(source.commit);
    if (events) {
      hours = eventHours(events.text);
      source.eventFile = events.name;
    }
  } catch (err) {
    console.error(`No se pudo leer el archivo de eventos: ${err.message}`);
  }

  let raw;
  try {
    raw = parseYaml(text);
  } catch (err) {
    raw = null;
    console.error(`El archivo de godfat no es YAML válido: ${err.message}`);
  }
  const { data, errors, warnings } = raw ? transform(raw, { today, source, hours }) : { data: null, errors: ['El archivo de godfat no es YAML válido.'], warnings: [] };
  if (errors.length) {
    writeReport({ ok: false, errors, warnings, source });
    for (const e of errors) console.error(`Error: ${e}`);
    process.exit(1);
  }

  const notes = [];
  let iconsMissing = [];
  if (!process.argv.includes('--no-icons')) {
    const ids = Object.keys(data.cats).map(Number);
    const published = arg('--published');
    const siteUrl = published ? (published.endsWith('/') ? published : `${published}/`) : null;
    const icons = await buildIcons(ids, { cacheDir: path.join(CACHE, 'icons'), outDir: ICONS_OUT, userAgent: USER_AGENT, siteUrl });
    data.icons = icons.icons;
    notes.push(...icons.warnings);
    iconsMissing = missingIcons(data, today, icons.wikiError);
  } else {
    data.icons = fs.existsSync(ICONS_OUT) ? fs.readdirSync(ICONS_OUT).map((f) => Number.parseInt(f, 10)).filter(Number.isInteger) : [];
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  writeReport({ ok: true, errors: [], warnings, notes, iconsMissing, source });
  for (const w of warnings) console.warn(`Aviso: ${w}`);
  for (const n of notes) console.log(`Nota: ${n}`);
  const plannable = data.events.filter((e) => !e.ticket);
  console.log(
    `Datos de godfat ${source.commit.slice(0, 8)} (${source.committedAt || 'local'}): ${plannable.length} banners, ` +
      `${Object.keys(data.cats).length} gatos, ${data.icons.length} iconos.`
  );
}

main();
