'use strict';

// Keeps the load the public app puts on bc.godfat.org bounded: a fixed number
// of analyses run at once (the rest wait in line) and each visitor can only
// start a few per time window. Everything lives in memory; visitor addresses
// are forgotten as soon as their window ends.

class QueueFullError extends Error {}

class JobQueue {
  constructor({ concurrency = 2, maxWaiting = 20 } = {}) {
    this.concurrency = concurrency;
    this.maxWaiting = maxWaiting;
    this.running = 0;
    this.waiting = [];
  }

  /**
   * Runs `job` when a slot is free. `onWait(position)` is called while it
   * waits; an aborted `signal` drops it from the line.
   */
  run(job, { onWait = () => {}, signal } = {}) {
    if (this.running < this.concurrency) return this.#start(job);
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new QueueFullError('Hay demasiadas búsquedas en cola ahora mismo. Vuelve a intentarlo en unos minutos.'));
    }
    return new Promise((resolve, reject) => {
      const entry = { job, resolve, reject, onWait };
      this.waiting.push(entry);
      onWait(this.waiting.length);
      signal?.addEventListener('abort', () => {
        const i = this.waiting.indexOf(entry);
        if (i < 0) return;
        this.waiting.splice(i, 1);
        this.#notify();
        reject(new Error('Búsqueda cancelada.'));
      }, { once: true });
    });
  }

  async #start(job) {
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.#next();
    }
  }

  #next() {
    const entry = this.waiting.shift();
    if (!entry) return;
    this.#notify();
    this.#start(entry.job).then(entry.resolve, entry.reject);
  }

  #notify() {
    this.waiting.forEach((e, i) => e.onWait(i + 1));
  }
}

/** Allows `max` hits per key every `windowMs` (fixed window). */
function createRateLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return function hit(key) {
    const t = now();
    for (const [k, w] of hits) if (t - w.start >= windowMs) hits.delete(k);
    const w = hits.get(key) || { start: t, count: 0 };
    hits.set(key, w);
    if (w.count >= max) return { ok: false, retryAfterMs: w.start + windowMs - t };
    w.count++;
    return { ok: true };
  };
}

module.exports = { JobQueue, QueueFullError, createRateLimiter };
