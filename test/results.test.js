// The results as the page shows them (public/results.js), read back as a page
// (linkedom): what each case says, and that nothing from the data becomes markup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderResults } from '../public/results.js';
import { plan, catalogOf } from '../public/core/planner.js';
import { gachaData } from './helpers.js';

const NOW = new Date(2026, 9, 16, 12, 0);
const key = (name) => String(catalogOf(gachaData).find((c) => c.name === name).key);
const run = (extra = {}) =>
  plan({ url: 'https://bc.godfat.org/?seed=1234567&last=39', targets: ['870', '755'], from: '2026-10-16', to: '2026-10-20', rolls: '100', tickets: '0', food: '100000', ...extra }, gachaData, { now: NOW });
const page = (data, selected = 0, isSelected = () => false) => parseHTML(`<main>${renderResults(data, { selected, isSelected })}</main>`).document;
const textOf = (doc, sel) => [...doc.querySelectorAll(sel)].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
const notices = (doc) => textOf(doc, '.detail .notice');
// A copy of a result to give one route the flags of a search cut at its limit.
const copy = (data) => structuredClone(data);

test('a route proven incomplete says no route gets them all, and points to the reasons', () => {
  const data = run({ targets: ['870', '755', '619', '259', '169', '57'], rolls: '40' });
  const r = data.routes[0];
  assert.ok(r.found && !r.complete && !r.exhausted, 'fixture: a whole search that cannot get them all');
  const doc = page(data);
  assert.ok(notices(doc).some((t) => t.startsWith('No existe ninguna ruta') && t.includes('«Por qué no se puede conseguir todo»')));
  assert.deepEqual(textOf(doc, '.diagnostics .section-title'), ['Por qué no se puede conseguir todo']);
  // Every «Ver motivo» leads to a card that is there.
  const links = [...doc.querySelectorAll('a.why-link')];
  assert.ok(links.length > 0);
  for (const a of links) assert.ok(doc.getElementById(a.getAttribute('href').slice(1)), a.getAttribute('href'));
});

test('a cut route never says no route exists; it names one that gets them all if there is one', () => {
  const base = run({ targets: ['870', '755', '619', '259', '169', '57'], rolls: '40' });
  const cut = copy(base);
  cut.routes[0].exhausted = true;
  const alone = page(cut);
  assert.ok(notices(alone).some((t) => t.includes('no está demostrado que no exista')));
  assert.ok(!notices(alone).some((t) => t.startsWith('No existe ninguna ruta')));
  assert.deepEqual(textOf(alone, '.diagnostics .section-title'), ['Por qué la ruta no lo consigue todo']);

  // Another route of the table gets them all: the cut one says so.
  const other = copy(cut);
  const whole = other.routes[1];
  whole.complete = true;
  whole.targets.forEach((t) => (t.obtained = true));
  const doc = page(other);
  assert.ok(notices(doc).some((t) => t.includes(`«${whole.label}» sí los consigue todos`)));
  // Without explanations computed, a missing cat has no link to nowhere.
  other.diagnostics = [];
  const bare = page(other);
  assert.equal(bare.querySelectorAll('a.why-link').length, 0);
  assert.ok(bare.querySelectorAll('.targets li.missing').length > 0);
});

test('with no route found after a cut search, the reasons do not claim it is impossible', () => {
  const base = run({ targets: ['870', '755', '619', '259', '169', '57'], rolls: '40' });
  const none = copy(base);
  none.routes = none.routes.map((r) => ({ key: r.key, label: r.label, description: r.description, found: false, exhausted: true, reason: 'x' }));
  const doc = page(none);
  assert.deepEqual(textOf(doc, '.diagnostics .section-title'), ['Por qué no se ha encontrado ninguna ruta']);
  assert.equal(doc.querySelector('.routes'), null);
  assert.equal(doc.querySelector('.detail'), null);
});

test('the route getting more targets says why it is recommended; a cut tie does not claim to be the best', () => {
  // As pickRecommended leaves it when the cheapest search was cut short.
  const data = copy(run({ targets: ['870', '755', '619', '259', '169', '57'], rolls: '40', tickets: '5' }));
  const rec = data.routes.find((r) => r.key === 'saveTickets');
  for (const r of data.routes) r.recommended = r === rec;
  rec.recommendedFor = 'mostTargets';
  rec.targets.forEach((t) => (t.obtained = true));
  data.routes.find((r) => r.key === 'optimal').exhausted = true;
  const doc = page(data, data.routes.indexOf(rec));
  const why = textOf(doc, '.detail .why');
  assert.equal(why.length, 1);
  assert.match(why[0], /^Se recomienda esta porque consigue más objetivos \(\d+ de \d+\) que «Menor coste total» \(\d+\), cuya búsqueda llegó a su límite/);

  const tie = copy(data);
  const twin = tie.routes.find((r) => r !== tie.routes[0]);
  twin.sameAs = undefined;
  twin.sameCostAs = tie.routes[0].key;
  const notes = (d) => textOf(page(d), '.routes .sub');
  twin.exhausted = false;
  assert.ok(notes(tie).some((t) => t.endsWith(': no hay alternativa mejor en este criterio.')));
  twin.exhausted = true;
  assert.ok(!notes(tie).some((t) => t.includes('no hay alternativa mejor')));
  assert.ok(notes(tie).some((t) => /^Mismo coste que .+\.$/.test(t)));
});

test('a legend cell where the route takes its only copy of a target says the target would be lost', () => {
  const data = plan({
    url: 'https://bc.godfat.org/?seed=4102194373&last=39', targets: [key('Musashi Miyamoto')], from: '2026-10-09', to: '2026-10-15',
    rolls: '200', tickets: '0', food: '100000',
  }, gachaData, { now: new Date(2026, 9, 9, 3, 42) });
  const doc = page(data, 0, (name) => name === 'Daybreaker Izanagi');
  const fits = [...doc.querySelectorAll('.legend-cells .fit')];
  assert.ok(fits.length >= 2);
  for (const f of fits) {
    assert.equal(f.textContent, 'Cambia la ruta');
    assert.match(f.getAttribute('title'), /no lo saca en ningún otro paso/);
  }
  // A cat already chosen shows a tag instead of the button.
  assert.ok(textOf(doc, '.legend-cells .tag').includes('ya es objetivo'));
});

test('text from the data never becomes markup', () => {
  const data = copy(run());
  const evil = '<img src=x onerror="alert(1)">';
  data.routes[0].steps[0].cats[0].name = evil;
  data.routes[0].steps[0].eventName = evil;
  data.events[0].name = evil;
  data.notices = [evil];
  const doc = page(data);
  assert.equal(doc.querySelectorAll('img').length, 0);
  assert.ok(doc.querySelector('main').textContent.includes(evil), 'shown as text');
});
