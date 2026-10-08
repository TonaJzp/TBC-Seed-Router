import test from 'node:test';
import assert from 'node:assert/strict';
import { xorshift32, buildSequence, raritySeed, slotSeed } from '../public/core/rng.js';

// Seeds taken from the "seed=" links godfat renders for seed 1234567.
const GODFAT_LINKS = { '1A': 2225988032, '1B': 3327196554, '2A': 828166522, '2B': 1225934019, '3A': 327754758 };

test('xorshift32 reproduces the sequence godfat uses', () => {
  const seq = buildSequence(1234567, 5);
  assert.equal(seq[0], 1234567);
  assert.equal(seq[1], xorshift32(1234567));
  assert.equal(seq[2], GODFAT_LINKS['1A']);
});

test('slot seeds follow the interleaved A/B track layout', () => {
  const seq = buildSequence(1234567, 5);
  for (const [key, seed] of Object.entries(GODFAT_LINKS)) {
    const n = Number(key.slice(0, -1));
    assert.equal(slotSeed(seq, n, key.at(-1)), seed, key);
  }
});

test('the rarity seed of a cell is the slot seed of the previous half roll', () => {
  const seq = buildSequence(1234567, 10);
  for (let n = 2; n < 10; n++) {
    assert.equal(raritySeed(seq, n, 'A'), slotSeed(seq, n - 1, 'B'));
    assert.equal(raritySeed(seq, n, 'B'), slotSeed(seq, n, 'A'));
  }
});
