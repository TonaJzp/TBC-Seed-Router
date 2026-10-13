// The calculation runs off the page in a Web Worker: same result as plan(),
// progress on the way, cancel at any time, and the page itself as a fallback
// for browsers that cannot start the worker.

import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, UserError } from '../public/core/planner.js';
import { runJob } from '../public/core/calc-job.js';
import { createCalculator, CancelledError } from '../public/calc-client.js';
import { gachaData, fixture } from './helpers.js';

const now = new Date(2026, 9, 16, 12, 0);
const body = { url: `https://bc.godfat.org/?seed=${fixture.seed}`, targets: ['851'], from: '2026-10-16', to: '2026-10-20', rolls: 200, food: 30000, tickets: 5 };
const strip = (r) => ({ ...r, routes: r.routes.map(({ ms, ...route }) => route) }); // timings differ
const expected = strip(plan(body, gachaData, { now }));
const quietly = (fn) => {
  const error = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = error;
  }
};

// A stand-in for the browser's Worker that runs calc-worker.js's protocol
// asynchronously, like the real one; it can fail to load or crash mid-job.
class FakeWorker {
  static made = [];
  static mode = 'ok'; // 'ok' | 'no-load' | 'crash'
  constructor(url, options) {
    assert.equal(options.type, 'module');
    assert.match(String(url), /calc-worker\.js$/);
    this.mode = FakeWorker.mode;
    this.posted = [];
    this.terminated = false;
    this.data = null;
    FakeWorker.made.push(this);
  }
  postMessage(msg) {
    this.posted.push(msg.type);
    if (msg.type === 'data') this.data = msg.data;
    if (msg.type !== 'run') return;
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === 'no-load') return this.onerror({ preventDefault() {} });
      let crashed = false;
      runJob(msg, this.data, (m) => {
        if (this.terminated || crashed) return;
        this.onmessage({ data: m });
        if (this.mode === 'crash' && m.type === 'progress') {
          crashed = true;
          this.onerror({ preventDefault() {} });
        }
      });
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
}

function withWorker(mode, fn) {
  return async () => {
    const saved = globalThis.Worker;
    FakeWorker.made = [];
    FakeWorker.mode = mode;
    if (mode === 'none') delete globalThis.Worker;
    else globalThis.Worker = FakeWorker;
    try {
      await fn();
    } finally {
      if (saved) globalThis.Worker = saved;
      else delete globalThis.Worker;
    }
  };
}

test('a job posts its progress, then the result', () => {
  const posted = [];
  runJob({ body, now }, gachaData, (m) => posted.push(m));
  assert.deepEqual(posted.slice(0, 2).map((m) => m.phase), ['prepare', 'route']);
  const last = posted.at(-1);
  assert.equal(last.type, 'result');
  assert.deepEqual(strip(last.result), expected);
  assert.ok(posted.slice(0, -1).every((m) => m.type === 'progress'));
});

test('a job turns errors into messages: the field of a UserError, or an unexpected one', () => {
  const user = [];
  runJob({ body: { ...body, url: '' }, now }, gachaData, (m) => user.push(m));
  assert.deepEqual(user.at(-1), { type: 'error', message: user.at(-1).message, field: 'url', user: true });
  const crash = [];
  quietly(() => runJob({ body, now }, null, (m) => crash.push(m)));
  assert.equal(crash.at(-1).type, 'error');
  assert.equal(crash.at(-1).user, false);
  assert.ok(crash.at(-1).message);
});

test('the calculator runs in a worker, tells the progress and reuses it', withWorker('ok', async () => {
  const calc = createCalculator();
  const phases = [];
  const result = await calc.run(body, { data: gachaData, now, onProgress: (p) => phases.push(p.phase) });
  assert.deepEqual(strip(result), expected);
  assert.deepEqual(phases, ['prepare', 'route', 'route', 'route']);
  await calc.run(body, { data: gachaData, now });
  assert.equal(FakeWorker.made.length, 1);
  assert.deepEqual(FakeWorker.made[0].posted, ['data', 'run', 'run'], 'the banner data is sent once');
}));

test('cancelling stops the worker at once, and the next run starts a fresh one', withWorker('ok', async () => {
  const calc = createCalculator();
  const running = calc.run(body, { data: gachaData, now });
  calc.cancel();
  await assert.rejects(running, CancelledError);
  assert.equal(FakeWorker.made[0].terminated, true);
  const result = await calc.run(body, { data: gachaData, now });
  assert.deepEqual(strip(result), expected);
  assert.equal(FakeWorker.made.length, 2);
  assert.deepEqual(FakeWorker.made[1].posted, ['data', 'run']);
  calc.cancel(); // nothing running: nothing happens
}));

test('a worker that cannot load leaves the calculation to the page, with the same result', withWorker('no-load', async () => {
  const calc = createCalculator();
  const phases = [];
  const result = await calc.run(body, { data: gachaData, now, onProgress: (p) => phases.push(p.phase) });
  assert.deepEqual(strip(result), expected);
  assert.ok(phases.includes('route'));
  await calc.run(body, { data: gachaData, now });
  assert.equal(FakeWorker.made.length, 1, 'no second try with a worker');
}));

test('without Worker at all, the page calculates', withWorker('none', async () => {
  const result = await createCalculator().run(body, { data: gachaData, now });
  assert.deepEqual(strip(result), expected);
}));

test('a UserError comes back as a UserError with its field', withWorker('ok', async () => {
  const calc = createCalculator();
  await assert.rejects(calc.run({ ...body, url: '' }, { data: gachaData, now }), (err) => {
    assert.ok(err instanceof UserError);
    assert.equal(err.field, 'url');
    return true;
  });
}));

test('a worker that dies mid-job is an error, not a hang nor a silent retry', withWorker('crash', async () => {
  const calc = createCalculator();
  await assert.rejects(calc.run(body, { data: gachaData, now }), (err) => {
    assert.ok(!(err instanceof UserError) && !(err instanceof CancelledError));
    assert.match(err.message, /memoria/);
    return true;
  });
  assert.equal(FakeWorker.made[0].terminated, true);
}));
