import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, poolsOf, rerollRare, afterReroll, raisesLegend, scoreColors } from '../public/core/gacha.js';
import { Simulator } from '../public/core/simulator.js';
import { Differences, compareBanner } from '../scripts/lib/compare.js';
import { fixture, variants, gachaData, godfatEvents } from './helpers.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const dataEvent = (data, id) => data.events.find((e) => e.id === id);

/** Differences between the app's tables (from `data`) and what godfat rendered (`web`). */
function differences(data, web, { size } = {}) {
  const event = { ...dataEvent(data, web.id), ...(size ? { guaranteed: size } : {}) };
  const [ev] = buildEvents(data, [{ ...event, guaranteed: size === 7 ? 0 : event.guaranteed }], fixture.seed, fixture.rolls);
  const sim = new Simulator(fixture.seed, [ev], fixture.rolls);
  ev.guaranteedSize = event.guaranteed; // any size can be compared, even one the planner doesn't offer
  const diff = new Differences();
  const cells = compareBanner(diff, web, ev, sim, fixture.rolls);
  return { list: diff.list, cells };
}

// --- The app's tables are exactly godfat's ------------------------------------

test('every cell godfat rendered is computed identically from its open data', () => {
  for (const web of godfatEvents()) {
    const { list, cells } = differences(gachaData, web);
    assert.deepEqual(list, [], `${web.name}`);
    assert.ok(cells >= 400, `${web.name}: ${cells} cells compared`);
  }
});

test('guaranteed draws of any size match godfat (11, step-up 15 and a forced 7)', () => {
  for (const size of [7, 15]) {
    const web = { ...variants[size], id: variants[size].id };
    const { list, cells } = differences(gachaData, web, { size });
    assert.deepEqual(list, [], `size ${size}`);
    assert.ok(Object.keys(web.guaranteed).length > 300, `godfat rendered the ${size}-roll guaranteed cells`);
    assert.ok(cells > 700);
  }
});

test('re-rolls godfat draws ("R" cells) are computed with their destination', () => {
  const ours = buildEvents(gachaData, godfatEvents().map((e) => dataEvent(gachaData, e.id)), fixture.seed, fixture.rolls);
  for (const [i, web] of godfatEvents().entries()) {
    assert.deepEqual(Object.keys(ours[i].alt).sort(), Object.keys(web.alt).sort(), web.name);
    for (const [key, alt] of Object.entries(web.alt)) {
      assert.equal(ours[i].alt[key].id, alt.id);
      if (alt.dest) assert.equal(ours[i].alt[key].dest, alt.dest);
    }
  }
});

// --- The comparison catches every kind of error -------------------------------

test('a wrong rate is detected', () => {
  const data = clone(gachaData);
  const web = godfatEvents()[0];
  const e = dataEvent(data, web.id);
  e.rare -= 300;
  e.uber += 300;
  assert.ok(differences(data, web).list.some((d) => d.kind === 'Gato distinto en una casilla'));
});

test('a pool in another order is detected', () => {
  const data = clone(gachaData);
  const web = godfatEvents()[0];
  const cats = data.gacha[dataEvent(data, web.id).gacha];
  [cats[0], cats[1]] = [cats[1], cats[0]];
  const kinds = differences(data, web).list.map((d) => d.kind);
  assert.ok(kinds.some((k) => k.startsWith('Gatos') && k.includes('otro orden')));
  assert.ok(kinds.includes('Gato distinto en una casilla'));
});

test('a different re-roll rule is detected', () => {
  const web = godfatEvents()[0];
  const key = Object.keys(web.alt)[0];
  const tampered = { ...web, alt: { ...web.alt, [key]: { ...web.alt[key], id: -1 } } };
  assert.ok(differences(gachaData, tampered).list.some((d) => d.kind === 'Gato distinto al repetir un rare'));
  const missing = { ...web, alt: Object.fromEntries(Object.entries(web.alt).slice(1)) };
  assert.ok(differences(gachaData, missing).list.some((d) => d.kind === 'Repetición de rare que solo aparece en un lado'));
});

test('a different guaranteed rule is detected', () => {
  const web = godfatEvents().find((e) => e.hasGuaranteed);
  const tampered = clone(web);
  for (const g of Object.values(tampered.guaranteed)) g.dest = '1A';
  assert.ok(differences(gachaData, tampered).list.some((d) => d.kind === 'Garantizado: destino distinto'));
  const asStepUp = differences(gachaData, web, { size: 15 }).list;
  assert.ok(asStepUp.length > 0, 'computing it as a step-up does not match');
});

test('legend colours and names are checked too', () => {
  const web = clone(godfatEvents()[0]);
  const [key] = Object.keys(web.raw);
  web.raw[key].colors = ['legend'];
  const id = Object.keys(web.names)[0];
  web.names[id] = 'Otro nombre';
  const kinds = differences(gachaData, web).list.map((d) => d.kind);
  assert.ok(kinds.includes('Color de casilla de legendario distinto'));
  assert.ok(kinds.includes('Nombre de gato distinto'));
});

// --- Building blocks (godfat's algorithm) -------------------------------------

test('a cat repeated in the pool re-rolls as many times as needed, like godfat', () => {
  const pool = [10, 11, 10, 12, 10];
  // Find a slot seed that lands on a 10 and needs more than one step.
  let found = null;
  for (let seed = 1; seed < 100000 && !found; seed++) {
    const r = rerollRare(pool, seed, pool[seed % pool.length]);
    if (pool[seed % pool.length] === 10 && r && r.steps > 1) found = r;
  }
  assert.ok(found, 'a multi-step re-roll exists');
  assert.notEqual(found.id, 10);
  assert.equal(rerollRare([5, 5], 3, 5), null, 'nothing else to roll');
});

test('after a re-roll the next roll skips one seed per extra step', () => {
  assert.deepEqual(afterReroll(4, 'A', 1), { n: 5, track: 'B' });
  assert.deepEqual(afterReroll(4, 'B', 1), { n: 6, track: 'A' });
  assert.deepEqual(afterReroll(4, 'A', 2), { n: 6, track: 'A' });
  assert.deepEqual(afterReroll(4, 'B', 2), { n: 6, track: 'B' });
});

test('a cat missing from the data empties the banner instead of shifting slots (as godfat)', () => {
  const data = clone(gachaData);
  const e = data.events.find((x) => !x.ticket);
  data.gacha[e.gacha] = [...data.gacha[e.gacha], 999999];
  const pools = poolsOf(data, e);
  assert.ok(Object.values(pools).every((p) => p.length === 0));
});

test('raised legend rates and legend cells follow godfat', () => {
  assert.equal(raisesLegend({ rare: 6970, supa: 2500, uber: 500 }), false);
  assert.equal(raisesLegend({ rare: 6930, supa: 2500, uber: 500 }), true);
  assert.deepEqual(scoreColors(9969), ['legend_fest']);
  assert.deepEqual(scoreColors(9970), ['legend']);
  assert.deepEqual(scoreColors(9939), []);
});
