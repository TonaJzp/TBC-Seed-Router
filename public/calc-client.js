// Runs the calculation in a Web Worker, so the page keeps responding while it
// works, and can cancel it. A browser that cannot start the worker gets the
// same calculation on the page itself: it freezes meanwhile, as it used to,
// but the result is the same.

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
  let usable = typeof Worker === 'function'; // false once a worker fails to start
  let worker = null;
  let workerData = null; // the banner data this worker already has
  let job = null; // { request, data, onProgress, resolve, reject }

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
      } else {
        // It never started (e.g. no module workers): the page does it.
        usable = false;
        runHere(job);
      }
    };
    return w;
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
      job = { request: { body, now }, data, onProgress, resolve, reject };
      if (usable && !worker) {
        try {
          worker = startWorker();
        } catch {
          usable = false;
        }
      }
      if (!usable) return runHere(job);
      if (workerData !== data) {
        worker.postMessage({ type: 'data', data });
        workerData = data;
      }
      worker.postMessage({ type: 'run', ...job.request });
    });
  }

  return { run, cancel };
}
