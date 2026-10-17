// The load of an analysis: what the sidebar shows before calculating, and
// what decides whether a calculation asks to be confirmed. It comes from the
// banner data, the dates, the chosen cats, the rolls and the tickets, never
// from the seed, so it is known from the first cat chosen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gachaData } from './helpers.js';
import { targetCounts, loadUnits, analysisLoad, levelOf, LEVELS, rarityFactor } from '../public/core/load.js';

// The banners of these dates (16-20/10 from 12:00 on 16/10): five.
const RARITY_FACTOR = rarityFactor(5);

// The test data's banners open at 12:00 on 16/10/2026 (16-20/10).
const NOW = new Date(2026, 9, 16, 12, 0);
const DATES = { from: '2026-10-16', to: '2026-10-20', now: NOW };
const RARITY = { rare: 2, super: 3, uber: 4, legend: 5 };
const open = gachaData.events.filter((e) => !e.ticket && e.start >= '2026-10-16' && e.start <= '2026-10-20');
const inDates = [...new Set(open.flatMap((e) => gachaData.gacha[e.gacha]))].sort((a, b) => a - b);
const pick = (rarity, n) => inDates.filter((id) => gachaData.cats[id].rarity === RARITY[rarity]).slice(0, n).map(String);
// A gacha cat that none of these banners has.
const elsewhere = Object.keys(gachaData.cats).find((id) => gachaData.cats[id].rarity === 4 && !inDates.includes(Number(id)));

test('cats are counted by rarity, only those the banners of the dates have', () => {
  const targets = [...pick('uber', 3), ...pick('legend', 1), ...pick('super', 2), ...pick('rare', 4), elsewhere];
  assert.deepEqual(targetCounts(gachaData, { targets, ...DATES }), { uber: 3, legend: 1, super: 2, rare: 4, banners: 5 });
});

test('an uber or a legendary weighs as much as a few super rares or rares, more of them with few banners', () => {
  for (const banners of [1, 5, 6, 11]) {
    const f = rarityFactor(banners);
    assert.equal(loadUnits({ uber: 1, legend: 0, super: 0, rare: 0, banners }), loadUnits({ uber: 0, legend: 0, super: 0, rare: f, banners }));
    assert.equal(loadUnits({ uber: 0, legend: 1, super: 0, rare: 0, banners }), loadUnits({ uber: 0, legend: 0, super: f, rare: 0, banners }));
    assert.equal(loadUnits({ uber: 2, legend: 1, super: 3, rare: 3, banners }), 3 + 6 / f);
  }
  assert.ok(rarityFactor(11) < rarityFactor(5), 'more banners, super rares and rares weigh more');
});

test('two lists of the same weight get the same level; a cat outside the dates changes nothing', () => {
  const base = { data: gachaData, rolls: 200, tickets: 0, ...DATES };
  const ubers = analysisLoad({ ...base, targets: [...pick('uber', 5), ...pick('rare', RARITY_FACTOR)] });
  const swapped = analysisLoad({ ...base, targets: [...pick('uber', 6)] });
  assert.equal(ubers.level, swapped.level);
  const plus = analysisLoad({ ...base, targets: [...pick('uber', 5), ...pick('rare', RARITY_FACTOR), elsewhere] });
  assert.deepEqual(plus, ubers);
});

test('more ubers never make the load lighter, at any number of rolls', () => {
  const order = LEVELS.map((l) => l.key);
  for (const rolls of [20, 60, 100, 200, 400, 1000]) {
    let last = -1;
    for (let n = 1; n <= 40; n++) {
      const load = analysisLoad({ data: gachaData, targets: pick('uber', n), rolls, tickets: 0, ...DATES });
      const at = order.indexOf(load.level);
      assert.ok(at >= last, `${n} ubers, ${rolls} rolls`);
      last = at;
    }
  }
});

test('tickets never make the load lighter', () => {
  const order = LEVELS.map((l) => l.key);
  for (const n of [4, 8, 12, 14, 16]) {
    const args = { data: gachaData, targets: pick('uber', n), rolls: 200, ...DATES };
    assert.ok(order.indexOf(analysisLoad({ ...args, tickets: 10 }).level) >= order.indexOf(analysisLoad({ ...args, tickets: 0 }).level), `${n} ubers`);
  }
});

test('only the heaviest level asks to be confirmed', () => {
  for (const l of LEVELS) assert.equal(l.guaranteed, l.key !== 'veryHeavy', l.key);
  const huge = analysisLoad({ data: gachaData, targets: pick('uber', 40), rolls: 200, tickets: 0, ...DATES });
  assert.equal(huge.level, 'veryHeavy');
  assert.equal(huge.guaranteed, false);
  const small = analysisLoad({ data: gachaData, targets: pick('uber', 2), rolls: 200, tickets: 0, ...DATES });
  assert.equal(small.level, 'light');
  assert.equal(small.guaranteed, true);
});

// Measured with the search's safety limit (02-DOCS sdd/progress/analysis-load
// T3 and T10, 3 seeds, 5/8/11 banners, and Chrome): every list that reached
// it must ask to be confirmed, with any number of banners.
test('every list measured to reach the safety limit is very heavy', () => {
  const reached = [
    // [ubers, super rares, rares, rolls, banners]
    [16, 0, 0, 200, 5], [16, 0, 0, 1000, 5], [18, 0, 0, 100, 5], [20, 0, 0, 100, 5],
    [5, 29, 25, 200, 5], [5, 29, 25, 1000, 5], [10, 15, 20, 200, 5], [10, 15, 20, 1000, 5],
    [15, 15, 15, 200, 5], [40, 0, 0, 60, 5], [30, 29, 25, 60, 5],
    [15, 0, 0, 200, 8], [16, 0, 0, 200, 8], [32, 0, 0, 60, 8], [30, 0, 0, 60, 8], // Chrome, site data
    [24, 0, 0, 60, 8], [15, 0, 0, 100, 8], [14, 0, 0, 200, 8], // concentrated in the longest banners
    [0, 29, 25, 200, 8], [0, 29, 25, 1000, 11], [0, 29, 25, 200, 11], // super rares and rares alone
  ];
  for (const [uber, supa, rare, rolls, banners] of reached) {
    const l = levelOf({ uber, legend: 0, super: supa, rare, banners }, rolls);
    assert.equal(l.level, 'veryHeavy', `${uber}u ${supa}s ${rare}r, ${rolls} rolls, ${banners} banners`);
  }
});

// Lists that ended guaranteed in every measured seed, and their slowest time:
// the level must not promise less time than they took.
test('measured lists that ended guaranteed get a level whose time covers them', () => {
  const ended = [
    // [ubers, super rares, rares, rolls, banners, slowest seconds]
    [13, 0, 0, 200, 8, 19.1], [12, 0, 0, 1000, 5, 2.2], [11, 0, 0, 200, 11, 4.3],
    [14, 0, 0, 100, 8, 37.3], [22, 0, 0, 60, 8, 20.5], [16, 0, 0, 60, 11, 2.4],
    [0, 15, 15, 1000, 11, 8.3], [6, 12, 12, 200, 5, 7.6],
  ];
  for (const [uber, supa, rare, rolls, banners, slowest] of ended) {
    const l = levelOf({ uber, legend: 0, super: supa, rare, banners }, rolls);
    const name = `${uber}u ${supa}s ${rare}r, ${rolls} rolls, ${banners} banners`;
    assert.equal(l.guaranteed, true, name);
    assert.ok(slowest <= l.maxS, `${name}: ${slowest} s within «${l.range}»`);
  }
  // Tickets lengthen it (12 ubers: 6.4 s with, 2.2 s without) but keep the guarantee.
  const withTickets = levelOf({ uber: 13, legend: 0, super: 0, rare: 0, banners: 5 }, 200, 10);
  assert.ok(withTickets.guaranteed && withTickets.level === 'heavy', '13 ubers with tickets: guaranteed, longer');
});

// Measured with Rare Tickets (02-DOCS ftd audit-2026-10-17b; 2 seeds, site
// data, 16 banners, ubers concentrated in the longest banners): each count of
// tickets left is a state of its own, so with many rolls they take the search
// to its limit with few cats.
test('every list measured to reach the safety limit because of its tickets is very heavy', () => {
  const reached = [
    // [ubers, rolls, tickets, share of the limit] (1 = cut)
    [13, 1000, 60, 1], [12, 1000, 60, 1], [12, 1000, 400, 1], [11, 1000, 400, 1], [10, 1000, 400, 1],
    [8, 1000, 400, 1], [6, 1000, 400, 1], [10, 1000, 60, 0.93],
    [13, 200, 150, 0.88], [12, 200, 400, 0.81],
  ];
  for (const [uber, rolls, tickets, share] of reached) {
    const l = levelOf({ uber, legend: 0, super: 0, rare: 0, banners: 16 }, rolls, tickets);
    assert.equal(l.level, 'veryHeavy', `${uber} ubers, ${rolls} rolls, ${tickets} tickets (${share * 100} % of the limit)`);
  }
  // The same lists without tickets are guaranteed: the tickets make the difference.
  assert.equal(levelOf({ uber: 13, legend: 0, super: 0, rare: 0, banners: 16 }, 1000, 0).guaranteed, true);
});

test('more tickets or more rolls never make the load lighter', () => {
  const order = LEVELS.map((l) => l.key);
  const rank = (uber, rolls, tickets) => order.indexOf(levelOf({ uber, legend: 0, super: 0, rare: 0, banners: 16 }, rolls, tickets).level);
  const tickets = [0, 1, 5, 6, 19, 20, 21, 60, 61, 150, 400];
  const rolls = [20, 60, 61, 100, 101, 150, 200, 201, 500, 1000];
  for (const uber of [1, 4, 6, 8, 10, 12, 13, 14, 20, 22]) {
    for (const r of rolls) {
      for (let i = 1; i < tickets.length; i++) assert.ok(rank(uber, r, tickets[i]) >= rank(uber, r, tickets[i - 1]), `${uber} ubers, ${r} rolls: ${tickets[i - 1]} → ${tickets[i]} tickets`);
    }
    for (const t of tickets) {
      // Only within a band: the bands themselves allow more ubers with fewer rolls.
      for (const [a, b] of [[101, 150], [150, 200], [201, 500], [500, 1000]]) assert.ok(rank(uber, b, t) >= rank(uber, a, t), `${uber} ubers, ${t} tickets: ${a} → ${b} rolls`);
    }
  }
});

test('measured lists with tickets that ended guaranteed get a level whose time covers them', () => {
  const ended = [
    // [ubers, rolls, tickets, slowest seconds]
    [8, 200, 5, 23.2], [8, 200, 20, 60.7], [8, 200, 60, 113.9], [13, 200, 5, 35.9], [13, 200, 60, 98.3], [11, 200, 400, 95.6],
    [10, 100, 60, 17.3], [14, 100, 60, 65.2], [13, 100, 400, 42.0],
    [15, 60, 60, 21.4], [22, 60, 60, 97.6], [21, 60, 400, 63.9],
    [6, 1000, 20, 19.8], [10, 1000, 5, 12.2], [10, 1000, 20, 31.4], [12, 1000, 5, 20.2], [12, 1000, 20, 43.0], [6, 1000, 60, 74.1],
  ];
  for (const [uber, rolls, tickets, slowest] of ended) {
    const l = levelOf({ uber, legend: 0, super: 0, rare: 0, banners: 16 }, rolls, tickets);
    const name = `${uber} ubers, ${rolls} rolls, ${tickets} tickets`;
    assert.equal(l.guaranteed, true, name);
    assert.ok(slowest <= l.maxS, `${name}: ${slowest} s within «${l.range}»`);
  }
  // The list that showed it: 8 ubers, 200 rolls and 20 tickets said «Ligero, menos de 10 segundos».
  assert.notEqual(levelOf({ uber: 8, legend: 0, super: 0, rare: 0, banners: 16 }, 200, 20).level, 'light');
});

test('no load without data, without counted cats, or without banners in the dates', () => {
  const base = { rolls: 200, tickets: 0, ...DATES };
  assert.equal(analysisLoad({ ...base, data: null, targets: pick('uber', 3) }), null);
  assert.equal(analysisLoad({ ...base, data: gachaData, targets: [] }), null);
  assert.equal(analysisLoad({ ...base, data: gachaData, targets: [elsewhere] }), null);
  assert.equal(analysisLoad({ ...base, data: gachaData, targets: pick('uber', 3), from: '2027-01-01', to: '2027-01-05' }), null);
});

test('every level says how long it usually takes, in words', () => {
  for (const l of LEVELS) {
    assert.ok(l.label && l.range, l.key);
    assert.doesNotMatch(l.range, /\d+\s*(puntos|pts)/);
  }
});
