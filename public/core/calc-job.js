// One calculation as a job: plan() with its progress and its outcome turned
// into plain messages, which can cross to and from a Web Worker (an error
// would lose its class and its field on the way).

import { plan, UserError } from './planner.js';

/**
 * Runs plan() for `body` at `now` and posts { type: 'progress', ...phase }
 * messages, then { type: 'result', result } or
 * { type: 'error', message, field, user }. Never throws.
 */
export function runJob({ body, now }, data, post) {
  try {
    const result = plan(body, data, { now, onProgress: (p) => post({ type: 'progress', ...p }) });
    post({ type: 'result', result });
  } catch (err) {
    const user = err instanceof UserError;
    if (!user) console.error(err);
    post({ type: 'error', message: String(err?.message || err), field: user ? err.field : null, user });
  }
}
