// Links to bc.godfat.org: every result must open the same table on godfat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { godfatLink } from '../public/core/godfat-link.js';

test('a cell godfat shows is linked directly, with the last cat for its re-rolls', () => {
  const { url, shifted } = godfatLink({ seed: 1530415490, eventId: '2026-10-09_1077', key: '20A', untilRow: 31, last: 109 });
  assert.equal(shifted, false);
  assert.equal(url, 'https://bc.godfat.org/?seed=1530415490&last=109&event=2026-10-09_1077&count=100#N20A');
  assert.match(godfatLink({ seed: 1, eventId: 'e', key: '250B' }).url, /count=260#N250B$/);
});

test('beyond the 300 rows godfat shows, the table starts at the cell, as godfat links it', () => {
  // The seeds godfat itself links from cells 52A and 118B of seed 4087567560
  // (they open the table at 53A and 119B, shown as 1A).
  const a = godfatLink({ seed: 4087567560, eventId: 'e', key: '53A', untilRow: 320 });
  assert.equal(a.shifted, true);
  assert.equal(a.url, 'https://bc.godfat.org/?seed=1497618628&event=e&count=278#N1A');
  const b = godfatLink({ seed: 4087567560, eventId: 'e', key: '119B', untilRow: 301 });
  assert.match(b.url, /^https:\/\/bc\.godfat\.org\/\?seed=2999275225&event=e&count=193#N1A$/);
});
