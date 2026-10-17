// Runs the calculation in a Web Worker, so the page keeps responding while it
// works, and can cancel it. A worker that does not start is tried once more
// at once (the server or the network may have failed just then); if that one
// does not start either, that calculation runs on the page itself: it
// freezes meanwhile, as it used to, but the result is the same. The next
// calculation tries a worker again.

import { runJob } from './core/calc-job.js';
import { UserError } from './core/planner.js';

export class CancelledError extends Error {
  constructor() {
    super('Cálculo cancelado.');
    this.name = 'CancelledError';
  }
}

const WORKER_URL = new URL('./calc-worker.js', import.meta.url);
const CRASHED =
  'El cálculo se ha detenido de forma inesperada (puede que el dispositivo se haya quedado sin memoria). Prueba con menos fechas, tiros o gatos.';
const PAINT_MS = 30; // on the page, let it paint the progress before freezing

/** One calculation at a time: run(body, { data, now, onProgress }) and cancel(). */
export function createCalculator() {
  let usable = typeof Worker === 'function'; // false without workers, or if creating one throws
  let worker = null;
  let workerData = null; // the banner data this worker already has
  let job = null; // { request, data, onProgress, resolve, reject, retried }

  function handle(msg) {
    if (!job) return; // cancelled meanwhile
    if (msg.type === 'progress') {
      const { type, ...progress } = msg;
      job.onProgress(progress);
      return;
    }
    const { resolve, reject } = job;
    job = null;
    if (msg.type === 'result') resolve(msg.result);
    else reject(msg.user ? new UserError(msg.message, msg.field) : new Error(msg.message));
  }

  function drop() {
    worker?.terminate();
    worker = null;
    workerData = null;
  }

  function runHere(current) {
    setTimeout(() => {
      if (job === current) runJob(current.request, current.data, handle);
    }, PAINT_MS);
  }

  function startWorker() {
    const w = new Worker(WORKER_URL, { type: 'module' });
    let heard = false;
    w.onmessage = (e) => {
      heard = true;
      if (w === worker) handle(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      if (w !== worker) return;
      drop();
      if (!job) return;
      if (heard) {
        const { reject } = job;
        job = null;
        reject(new Error(CRASHED));
      } else if (!job.retried) {
        // It never started: one more try at once with a new one.
        job.retried = true;
        launch(job);
      } else {
        // Twice: this calculation is done on the page; the next one tries again.
        runHere(job);
      }
    };
    return w;
  }

  /** Sends `current` to the worker, starting one (with the banner data) if there is none. */
  function launch(current) {
    if (!worker) {
      try {
        worker = startWorker();
      } catch {
        usable = false;
        return runHere(current);
      }
    }
    if (workerData !== current.data) {
      worker.postMessage({ type: 'data', data: current.data });
      workerData = current.data;
    }
    worker.postMessage({ type: 'run', ...current.request });
  }

  function cancel() {
    if (!job) return;
    const { reject } = job;
    job = null;
    drop();
    reject(new CancelledError());
  }

  function run(body, { data, now = new Date(), onProgress = () => {} } = {}) {
    cancel();
    return new Promise((resolve, reject) => {
      job = { request: { body, now }, data, onProgress, resolve, reject, retried: false };
      if (!usable) return runHere(job);
      launch(job);
    });
  }

  return { run, cancel };
}
