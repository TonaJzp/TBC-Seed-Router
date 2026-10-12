// Usage counts: only the published site counts, and nothing from the form or
// the visitor's own URLs leaves the browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { countUrl, externalReferrer, shouldCount, STATS_ENDPOINT } from '../public/stats.js';

const visit = { hostname: 'tonajzp.github.io', optedOut: false, doNotTrack: null, globalPrivacyControl: false, webdriver: false };

test('only real visits to the published site are counted', () => {
  assert.equal(shouldCount(visit), true);
  assert.equal(shouldCount({ ...visit, hostname: 'localhost' }), false);
  assert.equal(shouldCount({ ...visit, optedOut: true }), false);
  assert.equal(shouldCount({ ...visit, doNotTrack: '1' }), false);
  assert.equal(shouldCount({ ...visit, globalPrivacyControl: true }), false);
  assert.equal(shouldCount({ ...visit, webdriver: true }), false);
});

test('the referrer is kept only for other sites, without query or hash', () => {
  const own = 'https://tonajzp.github.io';
  assert.equal(externalReferrer('https://www.reddit.com/r/battlecats/comments/x/?utm=1#c', own), 'https://www.reddit.com/r/battlecats/comments/x/');
  assert.equal(externalReferrer('https://bc.godfat.org/?seed=123&event=e', own), 'https://bc.godfat.org/');
  assert.equal(externalReferrer('https://tonajzp.github.io/TBC-Seed-Router/credits.html', own), '');
  assert.equal(externalReferrer('', own), '');
});

test('events are sent as GoatCounter events with their name and title', () => {
  const url = new URL(countUrl({ path: 'calcular-ruta', title: 'Rutas calculadas', event: true }));
  assert.equal(`${url.origin}${url.pathname}`, STATS_ENDPOINT);
  assert.equal(url.searchParams.get('p'), 'calcular-ruta');
  assert.equal(url.searchParams.get('t'), 'Rutas calculadas');
  assert.equal(url.searchParams.get('e'), 'true');
  assert.equal(new URL(countUrl({ path: '/' })).searchParams.has('e'), false);
});

test('the screen size goes only with the page view', () => {
  assert.equal(new URL(countUrl({ path: '/', screen: '412,915,2.625' })).searchParams.get('s'), '412,915,2.625');
  assert.equal(new URL(countUrl({ path: 'calcular-ruta', event: true })).searchParams.has('s'), false);
});
