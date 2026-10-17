// The target picker of the form, on the page's own markup (no browser).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { parseHTML } from 'linkedom';
import { TargetPicker } from '../public/picker.js';
import { catalogOf } from '../public/core/planner.js';
import { gachaData } from './helpers.js';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/** A picker on index.html, with the catalogue loaded and `saved` as the stored selection. */
function pickerWith(saved = '') {
  const { document, CustomEvent } = parseHTML(html);
  // load() reads document.activeElement and announces the change with a CustomEvent.
  const nodeCustomEvent = globalThis.CustomEvent;
  Object.assign(globalThis, { document, CustomEvent });
  try {
    const picker = new TargetPicker(document.querySelector('#picker'));
    picker.hidden.value = saved;
    picker.load(catalogOf(gachaData), '2026-10-13T00:00:00Z');
    return picker;
  } finally {
    delete globalThis.document;
    globalThis.CustomEvent = nodeCustomEvent;
  }
}

test('wiki page titles saved by earlier versions (or pasted) find their cat', () => {
  const picker = pickerWith();
  const keyOf = (text) => picker.find(text)?.key ?? null;
  assert.equal(keyOf('Fuma Kotaro'), '851');
  assert.equal(keyOf('Fuma Kotaro (Uber Rare Cat)'), '851');
  assert.equal(keyOf('Musashi Miyamoto (Legend Rare Cat)'), '449');
  assert.equal(keyOf('Mer-Cat (Rare Cat)'), '150');
  assert.equal(keyOf('  Lilith Cat (Uber Rare Cat)  '), '303');
  assert.equal(keyOf('Wargod Kotaro (Uber Rare Cat)'), '851', 'other forms too');
  // A real name that itself ends in «(Cat)» is found as it is, and with the suffix.
  assert.equal(keyOf('Shampoo (Cat)'), '600');
  assert.equal(keyOf('Shampoo (Cat) (Uber Rare Cat)'), '600');
  // Only a final «(… Cat)» is a wiki title suffix.
  assert.equal(keyOf('Fuma Kotaro (Uber)'), null);
  assert.equal(keyOf('Fuma Kotaro (Uber Rare Cat) x'), null);
  assert.equal(keyOf('Not a cat (Uber Rare Cat)'), null);
});

test('a selection stored by an earlier version as wiki titles is restored', () => {
  const plain = pickerWith('Fuma Kotaro (Uber Rare Cat)\nLilith Cat (Uber Rare Cat)');
  assert.deepEqual(plain.value(), ['851', '303']);
  const json = pickerWith(JSON.stringify(['Musashi Miyamoto (Legend Rare Cat)', '150']));
  assert.deepEqual(json.value(), ['449', '150']);
});
