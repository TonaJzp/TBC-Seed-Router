// The daily build survives a stumble of the network or of GitLab: each
// download is tried again before the whole build gives up (issues #2 and #4).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRetrying } from '../scripts/lib/http.js';

/** A fetch that answers from a script: an Error is thrown, a number is a status. */
function scripted(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { ok: a >= 200 && a < 300, status: a };
  };
  const waits = [];
  return { calls, waits, opts: { fetchImpl, sleep: async (ms) => waits.push(ms) } };
}

test('a network failure is tried again, waiting longer each time', async () => {
  const s = scripted(new TypeError('fetch failed'), new TypeError('fetch failed'), 200);
  const res = await fetchRetrying('https://x/a', { method: 'HEAD' }, s.opts);
  assert.equal(res.status, 200);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.calls[2].init, { method: 'HEAD' });
  assert.deepEqual(s.waits, [2000, 4000]);
});

test('rate limits and server errors are tried again; the last answer is returned', async () => {
  const s = scripted(429, 503, 200);
  assert.equal((await fetchRetrying('https://x/b', {}, s.opts)).status, 200);
  const down = scripted(503);
  assert.equal((await fetchRetrying('https://x/c', {}, down.opts)).status, 503);
  assert.equal(down.calls.length, 3);
});

test('an answer that will not change is not repeated', async () => {
  const s = scripted(404);
  assert.equal((await fetchRetrying('https://x/d', {}, s.opts)).status, 404);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.waits, []);
});

test('when the network never answers, the error names the address and the tries', async () => {
  const s = scripted(new TypeError('fetch failed'));
  await assert.rejects(fetchRetrying('https://x/e', {}, s.opts), /https:\/\/x\/e.*fetch failed.*3 intentos/);
  assert.equal(s.calls.length, 3);
});
