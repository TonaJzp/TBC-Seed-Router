// Downloads that survive a stumble. GitLab and the network sometimes fail a
// single request (a dropped connection, a rate limit, a server error), and one
// failure used to stop the whole daily build (issues #2 and #4). Each request
// is now tried a few times, waiting longer each time, before giving up.

const ATTEMPTS = 3;
const WAIT_MS = 2000;
// Answers that may change on the next try: rate limits (GitLab also answers 403) and server errors.
const transient = (status) => status === 403 || status === 429 || status >= 500;

/**
 * fetch(url, init), tried up to `attempts` times on a network error or a
 * transient status. Returns the last response (the caller checks `ok`);
 * throws if the network never answered.
 */
export async function fetchRetrying(url, init = {}, { attempts = ATTEMPTS, waitMs = WAIT_MS, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.ok || !transient(res.status) || i === attempts) return res;
    } catch (err) {
      if (i === attempts) throw new Error(`${url}: ${err.message} (tras ${attempts} intentos)`);
    }
    await sleep(waitMs * i);
  }
}
