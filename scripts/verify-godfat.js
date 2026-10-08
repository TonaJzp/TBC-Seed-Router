// Daily check of the app against bc.godfat.org: for a random seed, every
// upcoming banner and everything godfat draws in its table (cats, legend
// colours, re-rolls of duplicates, guaranteed and re-rolled guaranteed draws,
// where each one leads) plus the banner list and dates, compared one by one
// with what the app computes from godfat's open data. Nothing is assumed: any
// difference is reported.
//
//   node scripts/verify-godfat.js [--seed N] [--rolls 300] [--previous <status.json URL>]
//
// Writes public/data/status.json (shown by the site) and
// .cache/verify-report.json (used by the notifier). Exit code: 0 everything
// matches, 1 differences found, 2 godfat could not be read.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildEvents } from '../public/core/gacha.js';
import { Simulator } from '../public/core/simulator.js';
import { parseEventList, parseTable, organize, pageUrl, fetchDocument } from './lib/godfat-html.js';
import { USER_AGENT } from './lib/identity.js';
import { Differences, compareList, compareBanner } from './lib/compare.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data', 'gacha.json');
const STATUS = path.join(ROOT, 'public', 'data', 'status.json');
const REPORT = path.join(ROOT, '.cache', 'verify-report.json');
const PAUSE_MS = 1500; // between godfat pages: one visitor's pace

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const seed = Number(arg('--seed')) || 1 + Math.floor(Math.random() * 0xfffffffe);
  const rolls = Number(arg('--rolls')) || 300;
  const today = new Date().toISOString().slice(0, 10);
  const previous = await loadPrevious(arg('--previous'));
  const diff = new Differences();
  let banners = 0;
  let cells = 0;
  let result;
  let error = null;

  try {
    const home = await fetchDocument(pageUrl(seed), { userAgent: USER_AGENT });
    const webEvents = parseEventList(home);
    if (!webEvents) throw new Error('la página de godfat no tiene la lista de banners (¿ha cambiado su diseño?)');
    compareList(diff, data, webEvents, today);

    const ours = new Map(data.events.map((e) => [e.id, e]));
    const planned = webEvents.map((w) => ours.get(w.id)).filter((e) => e && !e.ticket);
    const events = buildEvents(data, planned, seed, rolls);
    const sim = new Simulator(seed, events, rolls);
    for (const ev of events) {
      await sleep(PAUSE_MS);
      const doc = await fetchDocument(pageUrl(seed, { event: ev.id, count: String(rolls) }), { userAgent: USER_AGENT });
      const table = parseTable(doc);
      if (!table.cells.length) throw new Error(`godfat no mostró la tabla del banner «${ev.name}» (¿ha cambiado su diseño?)`);
      cells += compareBanner(diff, organize({ id: ev.id }, [{ offset: 0, table }]), ev, sim, rolls);
      banners++;
    }
    result = diff.list.length ? 'mismatch' : 'ok';
  } catch (err) {
    result = 'unreachable';
    error = err.message;
  }

  const checkedAt = new Date().toISOString();
  const status = {
    checkedAt,
    result,
    seed,
    rolls,
    banners,
    cells,
    dataCommit: data.source.commit,
    lastOk: result === 'ok' ? checkedAt : previous?.lastOk ?? null,
    problems: diff.list.map((d) => ({ kind: d.kind, count: d.count })),
  };
  fs.writeFileSync(STATUS, JSON.stringify(status));
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ ...status, error, differences: diff.list }, null, 2));

  if (result === 'ok') console.log(`Todo coincide: semilla ${seed}, ${banners} banners, ${cells} casillas comparadas con bc.godfat.org.`);
  else if (result === 'unreachable') console.error(`No se pudo verificar contra godfat: ${error}`);
  else {
    console.error(`Diferencias con bc.godfat.org (semilla ${seed}):`);
    for (const d of diff.list) console.error(`  ${d.kind}: ${d.count}\n    ${d.examples.join('\n    ')}`);
  }
  process.exitCode = { ok: 0, mismatch: 1, unreachable: 2 }[result];
}

/** The status published by the previous run, to remember the last successful check. */
async function loadPrevious(url) {
  try {
    if (url) return await (await fetch(url, { headers: { 'User-Agent': USER_AGENT } })).json();
    return JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  } catch {
    return null;
  }
}

main();
