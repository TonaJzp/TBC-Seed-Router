// Links to the tables of bc.godfat.org, so that every result can be checked
// there before spending anything.

import { buildSequence } from './rng.js';

// godfat shows at most 300 rows: a larger count is redirected to 300 and the
// link loses the cell it points to.
const GODFAT_MAX_ROWS = 300;

const rowOf = (key) => Number.parseInt(key, 10);

/**
 * Link to the table of banner `eventId` for `seed`, opened at cell `key`
 * ("12A"), showing rows up to `untilRow`. Beyond the rows godfat shows, the
 * table starts at `key` instead: the link uses the seed godfat itself links
 * from the cell before it, and godfat shows `key` as 1A (`shifted`).
 * `last` is the cat rolled just before, which decides the re-rolls of duplicates.
 * @returns {{ url: string, shifted: boolean }}
 */
function godfatLink({ seed, eventId, key, untilRow = rowOf(key), last = 0 }) {
  const n = rowOf(key);
  const shifted = untilRow > GODFAT_MAX_ROWS;
  const params = new URLSearchParams({ seed: String(seed) });
  if (shifted) {
    // Track A row n starts at seq[2n - 1], track B row n at seq[2n] (rng.js).
    const seq = buildSequence(seed, n);
    params.set('seed', String(seq[key.endsWith('A') ? 2 * n - 2 : 2 * n - 1]));
  }
  if (last) params.set('last', String(last));
  params.set('event', eventId);
  const rows = shifted ? untilRow - n + 1 : untilRow;
  params.set('count', String(Math.min(GODFAT_MAX_ROWS, Math.max(rows + 10, 100))));
  return { url: `https://bc.godfat.org/?${params}#N${shifted ? '1A' : key}`, shifted };
}

export { godfatLink, GODFAT_MAX_ROWS };
