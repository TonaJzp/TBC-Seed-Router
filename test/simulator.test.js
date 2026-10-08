import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, loadEvents, loadVariant, godfatEvents, variants } from './helpers.js';
import { parseKey } from '../public/core/simulator.js';

test('banner kinds come from the banner data', () => {
  const sim = makeSim();
  for (const ev of sim.events) assert.equal(ev.kind, ev.guaranteedSize === 11 ? 'guaranteed' : 'standard', ev.name);
  assert.ok(sim.events.some((e) => e.kind === 'guaranteed') && sim.events.some((e) => e.kind === 'standard'));
  assert.throws(() => makeSim([{ ...loadEvents()[0], guaranteedSize: 7 }]), /no soportado/);
});
test('a normal single stays on the track and advances one row', () => {
  const sim = makeSim();
  const ev = sim.events[0];
  const r = sim.single(ev, 5, 'B', 0);
  assert.equal(r.cat.id, ev.raw['5B'].id);
  assert.deepEqual(r.next, { n: 6, track: 'B' });
  assert.equal(r.rerolled, false);
});

test('a duplicated rare re-rolls and switches track (A -> N+1 B, B -> N+2 A)', () => {
  const sim = makeSim();
  for (const ev of sim.events) {
    for (const [key, raw] of Object.entries(ev.raw)) {
      if (ev.rarityOf.get(raw.id) !== 'rare') continue;
      const { n, track } = parseKey(key);
      const r = sim.single(ev, n, track, raw.id);
      if (!r) continue; // re-roll would leave the horizon
      assert.equal(r.rerolled, true);
      assert.notEqual(r.cat.id, raw.id, `${key} re-rolls into a different cat`);
      assert.deepEqual(r.next, track === 'A' ? { n: n + 1, track: 'B' } : { n: n + 2, track: 'A' });
    }
  }
});

test('duplicates are detected across banners, including ones godfat does not draw', () => {
  const sim = makeSim();
  const [x, y] = sim.events;
  let checked = 0;
  // Rare cells of banner Y without a godfat "alt" row: godfat assumes no dupe there.
  for (const [key, c] of Object.entries(y.raw)) {
    if (y.rarityOf.get(c.id) !== 'rare' || y.alt[key]) continue;
    // Obtain the very same cat from banner X, then roll Y at that position.
    const sourceKey = Object.keys(x.raw).find((k) => x.raw[k].id === c.id);
    if (!sourceKey) continue;
    const src = parseKey(sourceKey);
    const fromX = sim.single(x, src.n, src.track, 0);
    const { n, track } = parseKey(key);
    const inY = sim.single(y, n, track, fromX.cat.id);
    if (!inY) continue; // re-roll would leave the horizon
    assert.equal(inY.rerolled, true, `${key}: hidden track switch after ${c.name} from another banner`);
    assert.notEqual(inY.cat.id, c.id);
    assert.notEqual(inY.next.track, track);
    checked++;
  }
  assert.ok(checked > 10, `exercised ${checked} hidden cross-banner switches`);
});

test('a guaranteed draw yields 10 cats + 1 uber and swaps track, as godfat shows', () => {
  const sim = makeSim();
  const godfat = godfatEvents().find((e) => e.hasGuaranteed);
  const ev = sim.events.find((e) => e.id === godfat.id);
  const g = sim.guaranteed(ev, 1, 'A', 0);
  assert.equal(g.cats.length, 10);
  assert.equal(g.uber.rarity, 'uber');
  assert.equal(`${g.next.n}${g.next.track}`, godfat.guaranteed['1A'].dest);
  assert.equal(g.uber.id, godfat.guaranteed['1A'].id);
});
test('banners without guaranteed draws cannot do them', () => {
  const sim = makeSim();
  const ev = sim.events.find((e) => !e.guaranteedSize);
  assert.equal(sim.guaranteed(ev, 1, 'A', 0), null);
});
test('purple cells are protected by position across all banners', () => {
  const sim = makeSim();
  const [key] = [...sim.legendColors.keys()];
  assert.ok(key, 'fixture has at least one legend-coloured cell');
  const { n, track } = parseKey(key);
  assert.equal(sim.isProtected(n, track, { avoidLegend: true, avoidLegendFest: true }), true);
  assert.equal(sim.isProtected(n, track, { avoidLegend: false, avoidLegendFest: false }), false);
});

test('obtainable ids include every raw, re-rolled and guaranteed result godfat shows', () => {
  const sim = makeSim();
  const ids = sim.obtainableIds();
  for (const ev of godfatEvents()) {
    for (const c of Object.values(ev.raw)) assert.ok(ids.has(c.id));
    for (const c of Object.values(ev.alt)) assert.ok(ids.has(c.id));
    for (const c of Object.values(ev.guaranteed)) assert.ok(ids.has(c.id));
  }
});
test('a step-up banner draws 14 cats + 1 uber, as godfat shows for a step-up', () => {
  const stepup = loadVariant(15);
  const sim = makeSim([stepup]);
  assert.equal(stepup.kind, 'stepup');
  const g = sim.guaranteed(stepup, 1, 'A', 0);
  assert.equal(g.cats.length, 14);
  assert.equal(g.uber.id, variants[15].guaranteed['1A'].id);
  assert.equal(`${g.next.n}${g.next.track}`, variants[15].guaranteed['1A'].dest);
});
test('a plain 11-draw is exactly 11 consecutive singles', () => {
  const sim = makeSim();
  const ev = sim.events.find((e) => e.kind === 'standard');
  const multi = sim.multi(ev, 1, 'A', 0, 11);
  let pos = { n: 1, track: 'A' };
  let last = 0;
  for (const cat of multi.cats) {
    const s = sim.single(ev, pos.n, pos.track, last);
    assert.equal(s.cat.id, cat.id);
    last = s.cat.id;
    pos = s.next;
  }
  assert.deepEqual(multi.next, pos);
});
