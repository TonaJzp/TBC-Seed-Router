'use strict';

// Proof of concept: compute godfat's roll tables from his open data
// (build/bc-en.yaml, Apache 2.0) instead of reading bc.godfat.org, and compare
// them cell by cell with what godfat rendered.
//
//   node scripts/poc-yaml.js <bc-en.yaml>                 against the saved test fixtures
//   node scripts/poc-yaml.js <bc-en.yaml> --live <seed>…  against bc.godfat.org right now
//
// Port of godfat's Gacha / GachaPool / Cat (lib/battle-cats-rolls, Apache 2.0).

const fs = require('fs');
const yaml = require('js-yaml');
const { buildSequence, raritySeed, slotSeed } = require('../src/rng');

const BASE = 10000;
const RARITY = { 2: 'rare', 3: 'super', 4: 'uber', 5: 'legendary' };

function loadData(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
}

/** Slots per rarity, in the order godfat uses (gacha list order). */
function poolsOf(data, event) {
  const pools = { rare: [], super: [], uber: [], legendary: [] };
  for (const id of data.gacha[event.id]?.cats || []) {
    const rarity = RARITY[data.cats[id]?.rarity];
    if (rarity) pools[rarity].push(id);
  }
  return pools;
}

function rarityOfScore(event, score) {
  const { rare, supa, uber } = event;
  if (score < rare) return 'rare';
  if (score < rare + supa) return 'super';
  if (score < rare + supa + uber) return 'uber';
  return 'legendary';
}

// Purple / lilac cells depend only on the score (godfat Cat#score_rarity_label).
function scoreColors(score) {
  if (score >= 9970) return ['legend'];
  if (score >= 9940) return ['legend_fest'];
  return [];
}

/** Raw cells { "1A": { id, colors } } for `rolls` rows. */
function computeRaw(data, event, seed, rolls) {
  const seq = buildSequence(seed, rolls + 2);
  const pools = poolsOf(data, event);
  const raw = {};
  for (let n = 1; n <= rolls; n++) {
    for (const track of ['A', 'B']) {
      const score = raritySeed(seq, n, track) % BASE;
      const slots = pools[rarityOfScore(event, score)];
      if (!slots.length) continue;
      const id = slots[slotSeed(seq, n, track) % slots.length];
      raw[`${n}${track}`] = { id, colors: scoreColors(score) };
    }
  }
  return { pools, raw };
}

function compare(label, data, scraped, seed, rolls) {
  const event = data.events[scraped.id];
  if (!event) return { label, error: 'evento no está en el YAML' };
  const { pools, raw } = computeRaw(data, event, seed, rolls);
  let cells = 0;
  let idMismatch = 0;
  let colorMismatch = 0;
  const examples = [];
  for (const [key, c] of Object.entries(scraped.raw)) {
    cells++;
    const mine = raw[key];
    if (!mine || mine.id !== c.id) {
      idMismatch++;
      if (examples.length < 3) examples.push(`${key}: godfat ${c.id} ${c.name} / yaml ${mine?.id}`);
    }
    const legendColors = c.colors.filter((x) => x === 'legend' || x === 'legend_fest').sort().join();
    if ((mine?.colors || []).join() !== legendColors) colorMismatch++;
  }
  const poolsEqual = ['rare', 'super', 'uber', 'legendary'].every(
    (r) => [...pools[r]].sort().join() === [...scraped.pools[r]].sort().join()
  );
  const poolOrderEqual = ['rare', 'super', 'uber', 'legendary'].every((r) => pools[r].join() === scraped.pools[r].join());
  return { label, cells, idMismatch, colorMismatch, poolsEqual, poolOrderEqual, examples };
}

function report(results) {
  let bad = 0;
  for (const r of results) {
    if (r.error) {
      bad++;
      console.log(`  FALLO  ${r.label}: ${r.error}`);
      continue;
    }
    const ok = r.idMismatch === 0 && r.colorMismatch === 0 && r.poolsEqual;
    if (!ok) bad++;
    console.log(
      `  ${ok ? 'OK   ' : 'FALLO'}  ${r.label}: ${r.cells} casillas, ${r.idMismatch} gatos distintos, ` +
        `${r.colorMismatch} colores distintos, pools ${r.poolsEqual ? 'iguales' : 'DISTINTOS'}` +
        `${r.poolOrderEqual ? '' : ' (orden distinto)'}`
    );
    for (const e of r.examples) console.log(`         ${e}`);
  }
  return bad;
}

async function main() {
  const [file, flag, ...seeds] = process.argv.slice(2);
  const data = loadData(file);
  let bad = 0;
  if (flag !== '--live') {
    const fx = require('../test/fixtures/events.json');
    console.log(`Fixtures (semilla ${fx.seed}, ${fx.rolls} tiros):`);
    bad += report(fx.events.map((ev) => compare(ev.name, data, ev, fx.seed, fx.rolls)));
    const variants = require('../test/fixtures/variants.json');
    console.log('Variantes (step-up / garantizados):');
    bad += report(
      Object.entries(variants).map(([k, ev]) => compare(`${k}: ${ev.name}`, data, ev, ev.seed ?? fx.seed, Math.max(...Object.keys(ev.raw).map((x) => parseInt(x, 10)))))
    );
  } else {
    const { scrapeSeed } = require('../src/scraper');
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    for (const seed of seeds) {
      const rolls = 300;
      const { events } = await scrapeSeed(`https://bc.godfat.org/?seed=${seed}`, { from: today, to: until, rolls });
      console.log(`Semilla ${seed} (${rolls} tiros, ${events.length} banners en vivo):`);
      bad += report(events.map((ev) => compare(ev.name, data, ev, Number(seed), rolls)));
    }
  }
  console.log(bad ? `\n${bad} banners con diferencias` : '\nTodo coincide al 100 %');
  process.exitCode = bad ? 1 : 0;
}

main();
