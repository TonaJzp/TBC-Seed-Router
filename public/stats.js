// Anonymous usage counts with GoatCounter (goatcounter.com): no cookies and
// nothing from the form, only that the page was opened and the name of an
// event ("calcular-ruta"...). The numbers are on the GoatCounter dashboard.
// Only the published site counts, so local runs and tests never do.

export const STATS_ENDPOINT = 'https://tbcseedrouter.goatcounter.com/count';
const SITE_HOST = 'tonajzp.github.io';
// Set by opening the page with ?estadisticas=no (undone with ?estadisticas=si),
// so the owner's own visits stay out of the numbers.
const OPT_OUT_KEY = 'bc-seed-router-no-stats';

/** Where the visitor came from, if it is another site: never its query or hash. */
export function externalReferrer(referrer, ownOrigin) {
  try {
    const url = new URL(referrer);
    return url.origin === ownOrigin ? '' : `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

/** Whether this visit may be counted. */
export function shouldCount({ hostname, optedOut, doNotTrack, globalPrivacyControl, webdriver }) {
  return hostname === SITE_HOST && !optedOut && doNotTrack !== '1' && !globalPrivacyControl && !webdriver;
}

/** The GoatCounter /count URL for a page view or an event. */
export function countUrl({ path, title = '', referrer = '', event = false }) {
  const params = new URLSearchParams({ p: path, t: title, r: referrer });
  if (event) params.set('e', 'true');
  params.set('rnd', Math.random().toString(36).slice(2, 7)); // cache buster
  return `${STATS_ENDPOINT}?${params}`;
}

let enabled = false;

function send(hit) {
  if (!enabled) return;
  fetch(countUrl(hit), { mode: 'no-cors', credentials: 'omit', keepalive: true }).catch(() => {});
}

/** Reads the opt-out switch, decides whether to count and counts the visit. */
export function initStats() {
  const params = new URLSearchParams(location.search);
  const choice = params.get('estadisticas');
  try {
    if (choice === 'no') localStorage.setItem(OPT_OUT_KEY, '1');
    if (choice === 'si') localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage blocked: the switch just does not stick */
  }
  if (choice) {
    params.delete('estadisticas');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }
  let optedOut = false;
  try {
    optedOut = localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    /* storage blocked: nothing saved, so not opted out */
  }
  enabled = shouldCount({
    hostname: location.hostname,
    optedOut,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: navigator.globalPrivacyControl,
    webdriver: navigator.webdriver,
  });
  send({ path: '/', title: 'TBC Seed Router', referrer: externalReferrer(document.referrer, location.origin) });
}

/** Counts an event: `name` is what the dashboard lists, `title` its description. */
export function countEvent(name, title) {
  send({ path: name, title, event: true });
}
