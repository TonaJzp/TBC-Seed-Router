'use strict';

/**
 * Multi-select combobox for target cats: type to filter (name or any other
 * form of the cat), arrows + Enter to pick, Backspace to remove the last one.
 * Pasting a comma/line separated list adds every name it recognises.
 * The selection is mirrored as a JSON array in a hidden form input.
 */
class TargetPicker {
  static MAX_OPTIONS = 60;
  static RARITY = { normal: 'Normal', special: 'Especial', rare: 'Rare', super: 'Super', uber: 'Uber', legendary: 'Legend' };

  constructor(root) {
    this.root = root;
    this.input = root.querySelector('#picker-input');
    this.list = root.querySelector('#picker-list');
    this.chips = root.querySelector('#picker-chips');
    this.selectedBox = root.querySelector('#picker-selected');
    this.count = root.querySelector('#picker-count');
    this.hidden = root.querySelector('input[type="hidden"]');
    this.status = root.querySelector('#picker-status');
    this.cats = [];
    this.byId = new Map(); // catalogue key -> cat
    this.byKey = new Map(); // normalised key, name or alias -> cat
    this.selected = [];
    this.options = [];
    this.active = -1;
    this.statusText = '';

    this.input.addEventListener('input', () => this.open());
    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('paste', (e) => this.onPaste(e));
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus
    document.addEventListener('mousedown', (e) => {
      if (!this.root.contains(e.target)) this.close();
    });
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-i]');
      if (li) this.pick(this.options[Number(li.dataset.i)]);
    });
    this.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-name]');
      if (btn) this.remove(btn.dataset.name);
    });
    root.querySelector('#picker-clear').addEventListener('click', () => this.clear());
  }

  static esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  static icon(cat) {
    return cat && cat.image
      ? `<img class="cat-icon" src="${TargetPicker.esc(cat.image)}" alt="" loading="lazy" width="28" height="28">`
      : '<span class="cat-icon"></span>';
  }

  static rarity(cat) {
    return `<span class="rarity ${cat.rarity}">${TargetPicker.RARITY[cat.rarity] || ''}</span>`;
  }

  static norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  async load() {
    try {
      const res = await fetch('/api/cats');
      const { cats, updatedAt } = await res.json();
      this.cats = cats;
      const names = new Map();
      for (const c of cats) names.set(c.name, (names.get(c.name) || 0) + 1);
      for (const c of cats) {
        c.label = names.get(c.name) > 1 ? `${c.name} (${TargetPicker.RARITY[c.rarity]})` : c.name;
        this.byId.set(c.key, c);
        this.byKey.set(TargetPicker.norm(c.key), c);
        // Typed or pasted names: if two cats share a name, the gacha one wins.
        const current = this.byKey.get(TargetPicker.norm(c.name));
        if (!current || (current.gacha === false && c.gacha !== false)) this.byKey.set(TargetPicker.norm(c.name), c);
        for (const a of c.aliases) if (!this.byKey.has(TargetPicker.norm(a))) this.byKey.set(TargetPicker.norm(a), c);
      }
      const date = updatedAt ? new Date(updatedAt).toLocaleDateString('es-ES') : '—';
      this.statusText = `${cats.length} gatos · lista de la Battle Cats Wiki (CC BY-SA 4.0) del ${date}`;
    } catch {
      this.statusText = 'No se pudo cargar la lista de gatos.';
    }
    // Restore the selection saved in the form (older versions stored plain text).
    let saved = [];
    try {
      saved = JSON.parse(this.hidden.value || '[]');
    } catch {
      saved = this.hidden.value.split(/[,\n]/);
    }
    this.selected = [];
    for (const entry of saved) {
      const cat = this.find(String(entry));
      if (cat) this.add(cat.key);
    }
    this.sync();
  }

  find(text) {
    return this.byKey.get(TargetPicker.norm(text)) || null;
  }

  /** Adds a cat by name (e.g. a legendary suggested by the results). */
  addByName(name) {
    const cat = this.find(name);
    if (!cat) return false;
    this.add(cat.key);
    this.sync();
    return true;
  }

  isSelected(name) {
    const cat = this.find(name);
    return !!cat && this.selected.includes(cat.key);
  }

  /** Unique catalogue keys (wiki page titles) of the chosen cats. */
  value() {
    return [...this.selected];
  }

  // Ranks catalogue entries for the typed text.
  search(text) {
    const q = TargetPicker.norm(text);
    const taken = new Set(this.selected);
    const results = [];
    for (const cat of this.cats) {
      if (taken.has(cat.key)) continue;
      if (!q) {
        results.push({ cat, score: 9, via: null });
        continue;
      }
      const name = TargetPicker.norm(cat.name);
      let score = null;
      let via = null;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (name.split(/[\s\-&.]+/).some((w) => w.startsWith(q))) score = 2;
      else if (name.includes(q)) score = 3;
      else {
        via = cat.aliases.find((a) => TargetPicker.norm(a).includes(q)) || null;
        if (via) score = TargetPicker.norm(via).startsWith(q) ? 4 : 5;
      }
      if (score !== null) results.push({ cat, score, via });
    }
    // Equal matches: gacha cats first (they are what people plan for), then A-Z.
    const gachaFirst = (r) => (r.cat.gacha === false ? 1 : 0);
    results.sort((a, b) => a.score - b.score || gachaFirst(a) - gachaFirst(b) || a.cat.name.localeCompare(b.cat.name));
    return results;
  }

  open() {
    const results = this.search(this.input.value);
    this.options = results.slice(0, TargetPicker.MAX_OPTIONS).map((r) => r.cat);
    this.active = this.input.value.trim() && this.options.length ? 0 : -1;
    const rows = results.slice(0, TargetPicker.MAX_OPTIONS).map((r, i) => {
      const c = r.cat;
      const img = TargetPicker.icon(c);
      const notes = [
        r.via && `también «${TargetPicker.esc(r.via)}»`,
        c.gacha === false && 'no sale en el gacha',
      ].filter(Boolean);
      const alias = notes.length ? `<small>${notes.join(' · ')}</small>` : '';
      return `<li role="option" id="picker-opt-${i}" data-i="${i}" class="r-${c.rarity}" aria-selected="false">
        ${img}<span class="opt-name">${TargetPicker.esc(c.label)}${alias}</span>${TargetPicker.rarity(c)}
      </li>`;
    });
    const more = results.length - this.options.length;
    if (!rows.length) rows.push('<li class="picker-empty">Ningún gato coincide.</li>');
    if (more > 0) rows.push(`<li class="picker-empty">${more} más… sigue escribiendo para filtrar.</li>`);
    this.list.innerHTML = rows.join('');
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.highlight();
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  highlight() {
    for (const li of this.list.querySelectorAll('[role="option"]')) {
      const on = Number(li.dataset.i) === this.active;
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `picker-opt-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.list.hidden) this.open();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.active = Math.max(0, Math.min(this.options.length - 1, this.active + step));
      this.highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // never submit the form from here
      if (!this.list.hidden && this.options[this.active]) this.pick(this.options[this.active]);
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Backspace' && !this.input.value && this.selected.length) {
      this.remove(this.selected[this.selected.length - 1]);
    }
  }

  onPaste(e) {
    const text = e.clipboardData.getData('text');
    if (!/[,\n]/.test(text)) return;
    e.preventDefault();
    const missing = [];
    for (const part of text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
      const cat = this.find(part);
      if (cat) this.add(cat.key);
      else missing.push(part);
    }
    this.sync(missing.length ? `No reconocidos: ${missing.join(', ')}` : '');
    this.open();
  }

  pick(cat) {
    if (!cat) return;
    this.add(cat.key);
    this.input.value = '';
    this.sync();
    this.open();
  }

  add(key) {
    if (!this.selected.includes(key)) this.selected.push(key);
  }

  remove(key) {
    this.selected = this.selected.filter((k) => k !== key);
    this.sync();
    this.input.focus();
  }

  clear() {
    this.selected = [];
    this.sync();
  }

  sync(message = '') {
    this.hidden.value = JSON.stringify(this.selected);
    this.chips.innerHTML = this.selected
      .map((key) => {
        const cat = this.byId.get(key);
        const label = cat ? cat.label : key;
        return `<li>${TargetPicker.icon(cat)}<span class="sel-name" title="${TargetPicker.esc(label)}">${TargetPicker.esc(label)}</span>${cat ? TargetPicker.rarity(cat) : '<span></span>'}<button type="button" class="remove" data-name="${TargetPicker.esc(key)}" aria-label="Quitar ${TargetPicker.esc(label)}" title="Quitar">×</button></li>`;
      })
      .join('');
    const n = this.selected.length;
    this.selectedBox.hidden = n === 0;
    if (n) this.input.classList.remove('invalid');
    this.count.textContent = `${n} gato${n === 1 ? '' : 's'} elegido${n === 1 ? '' : 's'}`;
    this.status.innerHTML = message ? `<span class="bad">${TargetPicker.esc(message)}</span>` : TargetPicker.esc(this.statusText);
  }
}
