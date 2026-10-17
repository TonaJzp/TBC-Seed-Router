import { parseRequest, catalogOf, UserError } from './core/planner.js';
import { createCalculator, CancelledError } from './calc-client.js';
import { TargetPicker } from './picker.js';
import { renderResults, esc } from './results.js';
import { initMascot } from './mascot.js';
import { initStats, countEvent } from './stats.js';
import { analysisLoad } from './core/load.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#route-form');
const STORAGE_KEY = 'bc-seed-router-form';
const picker = new TargetPicker($('#picker'));
const mascot = initMascot($('#mascot'));
const DAY_MS = 86_400_000;
const STALE_DATA_DAYS = 3; // the data is rebuilt every day
const UNVERIFIED_DAYS = 4; // and checked against godfat every day

let gachaData = null; // banner data (data/gacha.json), loaded at start
let dataFailed = false; // it could not be loaded: the error says why

// Dates in the user's own time zone (toISOString would give the UTC day).
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDate(new Date());

// Browsers can block site data (strict privacy settings): localStorage then
// throws. The page must work the same; it just does not remember anything.
function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

let current = null; // last result, to re-render when another route is selected

// --- Form -----------------------------------------------------------------

// The plan always starts today: no past dates, and "to" never before "from".
// The calendar won't offer earlier days; typed ones are flagged, not changed.
// Chrome fires "change" on every typed digit, and any write to `min` (even the
// same value) resets the segment being typed, so "12" ended up as "02".
function syncDateLimits() {
  const today = todayIso();
  setMin(form.from, today);
  setMin(form.to, form.from.value > today ? form.from.value : today);
}

function setMin(input, value) {
  if (input.min !== value) input.min = value;
}

function dateProblem(el) {
  const today = todayIso();
  const show = (iso) => iso.split('-').reverse().join('/');
  if (el.value < today) return `No puede ser anterior a hoy (${show(today)}).`;
  if (el === form.to && el.value < form.from.value) return 'No puede ser anterior a «Desde».';
  return 'Revisa esta fecha.';
}

// Inventory fields start at 0: entering one empties it, so typing 50 doesn't
// give "050", and leaving it empty puts the 0 back.
const INVENTORY = [form.tickets, form.food];
function zeroIfEmpty(el) {
  if (el.value === '' && !el.validity.badInput) el.value = '0';
}
for (const el of INVENTORY) {
  el.addEventListener('focus', () => {
    if (el.value === '0') el.value = '';
  });
  el.addEventListener('blur', () => zeroIfEmpty(el));
}

function restoreForm() {
  const today = new Date();
  form.from.value = isoDate(today);
  const inTwoWeeks = new Date(today);
  inTwoWeeks.setDate(today.getDate() + 14);
  form.to.value = isoDate(inTwoWeeks);
  syncDateLimits();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const [k, v] of Object.entries(saved)) {
      const el = form.elements[k];
      if (!el || k === 'from' || k === 'to') continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
  } catch {
    /* ignore corrupt storage */
  }
}

function readForm() {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  store(STORAGE_KEY, JSON.stringify(data));
  return { ...data, targets: picker.value(), today: todayIso() };
}

// --- Field errors ---------------------------------------------------------
// A problem with a field is told under it, in red, and the page takes you
// there: on phones the button is far below the fields, and on wide screens the
// field may be scrolled out of the sidebar.

/** What is wrong with a field, in words, or null (the form is novalidate). */
function fieldProblem(el) {
  const v = el.validity;
  if (v.valid) return null;
  if (el.name === 'url') return 'Pega aquí la URL de tu semilla en godfat o solo el número de semilla.';
  if (el.type === 'date') return v.valueMissing || v.badInput ? 'Elige una fecha.' : dateProblem(el);
  if (v.valueMissing || v.badInput) return 'Escribe un número.';
  if (v.rangeUnderflow || v.rangeOverflow) return el.max ? `Tiene que estar entre ${el.min} y ${el.max}.` : 'No puede ser negativo.';
  if (v.stepMismatch) return el.step === '1' ? 'Tiene que ser un número entero.' : `Usa un múltiplo de ${el.step}, por ejemplo ${el.defaultValue}.`;
  return 'Revisa este valor.';
}

/** Shows `message` under the field (or removes it, with null). */
function setFieldError(el, message) {
  el.classList.toggle('invalid', !!message);
  const id = `${el.name}-error`;
  let note = document.getElementById(id);
  if (!message) {
    note?.remove();
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    return;
  }
  if (!note) {
    note = document.createElement('small');
    note.id = id;
    note.className = 'field-error';
    el.after(note);
  }
  note.textContent = message;
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', id);
}

/** Scrolls the field to the middle of the screen and puts the cursor in it. */
function goToField(el) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  if (el === picker.input) picker.focusQuietly({ preventScroll: true });
  else el.focus({ preventScroll: true });
}

/** Shows a problem found by the planner under its field and goes there. */
function showFieldError(field, message) {
  $('#error').hidden = true;
  if (field === 'targets') {
    picker.showError(message);
    goToField(picker.input);
    return;
  }
  setFieldError(form.elements[field], message);
  goToField(form.elements[field]);
}

/**
 * Marks every field with a problem, each with its message, and returns the
 * first one in the form (the one to go to), or null.
 */
function validateForm() {
  syncDateLimits(); // the page may have been left open since yesterday
  for (const el of INVENTORY) zeroIfEmpty(el); // Enter pressed while one was empty
  let first = null;
  for (const el of form.elements) {
    if (el.name === 'targets') {
      if (!picker.value().length) {
        picker.showError('Elige al menos un gato objetivo.');
        first ||= picker.input;
      }
      continue;
    }
    if (!el.name || el.type === 'checkbox') continue;
    const problem = fieldProblem(el);
    setFieldError(el, problem);
    if (problem) first ||= el;
  }
  return first;
}

/** The first problem the planner finds in the form's values, tied to its field. */
function requestProblem(body) {
  try {
    parseRequest(body);
    return null;
  } catch (err) {
    return err instanceof UserError && err.field ? err : null;
  }
}

// Fixing a field takes its message away; the date limits move together.
function recheckField(e) {
  const el = e.target;
  if (!el.name || !el.classList.contains('invalid')) return;
  setFieldError(el, null);
  if (el === form.from && form.to.classList.contains('invalid')) setFieldError(form.to, fieldProblem(form.to));
}

// --- Request --------------------------------------------------------------

function show(section) {
  for (const id of ['empty', 'status', 'results']) $(`#${id}`).hidden = id !== section;
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}

/** While working, the button says so (and cannot be pressed again). */
function setBusy(label) {
  $('#submit').disabled = !!label;
  $('#submit').textContent = label || 'Calcular rutas';
}

// --- Load -----------------------------------------------------------------
// How heavy the analysis of the form will be (core/load.js), shown above the
// button as the form changes. The heaviest level asks to be confirmed.

let load = null;

function updateLoad() {
  const f = form.elements;
  load = analysisLoad({
    data: gachaData,
    targets: picker.value(),
    from: f.from.value,
    to: f.to.value,
    rolls: Number(f.rolls.value),
    tickets: Number(f.tickets.value) || 0,
    now: new Date(),
  });
  const box = $('#load');
  box.hidden = !load;
  if (!load) return;
  box.dataset.level = load.level;
  $('#load-level').textContent = load.label;
  $('#load-fill').style.width = `${Math.round(load.share * 100)}%`;
  $('#load-time').textContent = load.guaranteed
    ? `Suele tardar ${load.range} en un ordenador; en un móvil, más. Es una estimación.`
    : `Puede tardar ${load.range} en un ordenador, y más en un móvil. Te pediremos confirmación.`;
}

/** Asks before a very heavy analysis; resolves true to go ahead. */
function confirmHeavy(l) {
  const dialog = $('#heavy-dialog');
  $('#heavy-range').textContent = l.range;
  if (typeof dialog.showModal !== 'function') {
    // A browser without <dialog>: the plain question, same choice.
    return Promise.resolve(window.confirm(`Análisis muy pesado: puede tardar ${l.range} en un ordenador, y más en un móvil. Si llega al límite de seguridad, la ruta no estará garantizada como la mejor. ¿Calcular de todas formas?`));
  }
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'go'), { once: true });
    dialog.showModal();
  });
}
$('#heavy-go').addEventListener('click', () => $('#heavy-dialog').close('go'));
$('#heavy-back').addEventListener('click', () => $('#heavy-dialog').close('back'));

// --- Calculation ----------------------------------------------------------
// It runs off the page (calc-client.js), so the page keeps responding: the
// progress says the phase, the time it has taken and what such an analysis
// usually takes, and «Cancelar» stops it. There is no time limit; the search
// has a size limit (optimizer.js MAX_STATES) so memory never runs out.
const calculator = createCalculator();
const HINT_S = 10; // from here on a wait starts to look like a failure: say why and what can be done
// The estimate is for a computer: a phone (coarse pointer) gets this much more
// before the wait is called longer than estimated.
const PHONE_FACTOR = 4;
const PHASE_TEXT = {
  prepare: () => 'Preparando las tiradas de tu semilla…',
  route: (p) => `Buscando la ruta ${p.index} de ${p.total} («${p.label}»)…`,
  diagnose: () => 'Buscando por qué falta algún gato…',
};

const clock = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

/**
 * Counts the time under the progress, with the estimate of `l` (the load, or
 * null); returns the function that stops it. The hint says why it takes time:
 * from the start when the load is heavy, else after HINT_S seconds, and says
 * so once the estimate is passed.
 */
function startClock(l) {
  const t0 = Date.now();
  const estimate = $('#progress-estimate');
  estimate.hidden = !l;
  if (l) estimate.textContent = `Estimación: ${l.range} en un ordenador; en un móvil puede tardar varias veces más. Es orientativa, no exacta.`;
  const hintFrom = l?.level === 'heavy' || l?.level === 'veryHeavy' ? 0 : HINT_S;
  const overAt = l ? l.maxS * (window.matchMedia('(pointer: coarse)').matches ? PHONE_FACTOR : 1) : Infinity;
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const over = s > overAt;
    $('#elapsed').textContent = ` · ${clock(s)}`;
    $('#progress-hint').hidden = s < hintFrom && !over;
    $('#progress-hint').classList.toggle('over', over);
    $('#progress-over').hidden = !over;
  };
  tick();
  const timer = setInterval(tick, 250);
  return () => {
    clearInterval(timer);
    $('#elapsed').textContent = '';
    $('#progress-hint').hidden = true;
    estimate.hidden = true;
  };
}

$('#cancel').addEventListener('click', () => calculator.cancel());

// Every press of "Calcular rutas" ends somewhere you can see: the progress and
// then the results, the field to fix, or the error, never a silent no-op.
async function submit(event) {
  event.preventDefault();
  if ($('#submit').disabled) return; // a calculation is already running
  if (!gachaData && !dataFailed) {
    // Still loading (a slow connection): wait for it, in sight.
    setBusy('Cargando datos…');
    $('#progress').textContent = 'Cargando los datos de los banners…';
    show('status');
    bringIntoView($('#status'));
    await dataLoaded;
    setBusy(null);
    show(current ? 'results' : 'empty');
  }
  if (!gachaData) {
    bringIntoView($('#error')); // loadData explains why
    return;
  }
  const invalid = validateForm();
  if (invalid) {
    $('#error').hidden = true;
    goToField(invalid);
    return;
  }
  const body = readForm();
  const wrong = requestProblem(body);
  if (wrong) {
    showFieldError(wrong.field, wrong.message);
    return;
  }
  updateLoad(); // the time may have moved on since the last change
  const heavy = load;
  if (heavy && !heavy.guaranteed && !(await confirmHeavy(heavy))) return;
  setBusy('Calculando…');
  $('#error').hidden = true;
  $('#cancelled').hidden = true;
  $('#progress').textContent = 'Calculando las tiradas de tu semilla y las mejores rutas…';
  $('#cancel').hidden = false;
  show('status');
  bringIntoView($('#status'));
  const stopClock = startClock(heavy);
  let gotResult = false;
  let cancelled = false;
  let fieldError = null;
  countEvent('calcular-ruta', 'Rutas calculadas');
  try {
    const result = await calculator.run(body, {
      data: gachaData,
      now: new Date(),
      onProgress: (p) => {
        if (PHASE_TEXT[p.phase]) $('#progress').textContent = PHASE_TEXT[p.phase](p);
      },
    });
    gotResult = true;
    current = { data: result, selected: result.routes.findIndex((r) => r.found) };
    render();
    if (current.selected >= 0) mascot.play(); // a route found: the cat celebrates
    else countEvent('sin-ruta', 'Cálculos sin ninguna ruta posible');
  } catch (err) {
    if (err instanceof CancelledError) cancelled = true;
    else if (err instanceof UserError && err.field) fieldError = err; // e.g. the day changed meanwhile
    else if (err instanceof UserError) showError(err.message);
    else {
      console.error(err);
      countEvent('error-inesperado', 'Errores inesperados al calcular');
      showError(
        `Error inesperado al calcular: ${err.message}. Si se repite, avísanos con «Reportar un error» (al pie de la página): el correo lleva ya los datos de tu formulario.`
      );
    }
  } finally {
    stopClock();
    $('#cancel').hidden = true;
    setBusy(null);
    if (cancelled) {
      // Back to what there was, the form as it is.
      show(current ? 'results' : 'empty');
      $('#cancelled').textContent = current ? 'Cálculo cancelado. Siguen los resultados anteriores.' : 'Cálculo cancelado.';
      $('#cancelled').hidden = false;
      $('#submit').focus({ preventScroll: true }); // the focused «Cancelar» is gone
      bringIntoView($('#cancelled'));
    } else {
      show(gotResult ? 'results' : 'empty');
      if (fieldError) showFieldError(fieldError.field, fieldError.message);
      else bringIntoView($(gotResult ? '#results' : '#error'));
    }
  }
}

/**
 * Scrolls smoothly so that `el` starts at the top of the screen, unless it is
 * already near the top. Returns whether it scrolled.
 */
function bringIntoView(el) {
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight / 3) return false;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  return true;
}

// --- Rendering ------------------------------------------------------------

function render() {
  const { data } = current;
  // Picking another route re-renders everything: keep the open rows open.
  const open = new Set([...document.querySelectorAll('#results details[open][data-section]')].map((d) => d.dataset.section));
  $('#results').innerHTML = renderResults(data, { selected: current.selected, isSelected: (name) => picker.isSelected(name) });
  for (const d of document.querySelectorAll('#results details[data-section]')) d.open = open.has(d.dataset.section);
  for (const tr of document.querySelectorAll('.routes tbody tr[data-i]')) {
    tr.addEventListener('click', () => {
      current.selected = Number(tr.dataset.i);
      render();
    });
  }
}

// --- Theme ----------------------------------------------------------------
// The initial theme is set by the inline script in <head> (no flash).
const THEME_KEY = 'bc-seed-router-theme';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#211f1d' : '#f5f4f1');
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('#theme-label').textContent = dark ? 'Claro' : 'Oscuro';
}
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store(THEME_KEY, next);
  applyTheme(next);
});
applyTheme(document.documentElement.dataset.theme || 'light');

// --- Help popovers -----------------------------------------------------------
// The "?" next to an option. With a mouse, hovering shows the explanation;
// a click or tap keeps it open until you tap elsewhere or press Escape.
const helpButtons = [...document.querySelectorAll('.help')];
let pinnedHelp = null;
const popOf = (btn) => document.getElementById(btn.getAttribute('aria-controls'));

function openHelp(btn) {
  for (const other of helpButtons) if (other !== btn) closeHelp(other);
  const pop = popOf(btn);
  pop.hidden = false;
  const b = btn.getBoundingClientRect();
  const arrow = b.left + b.width / 2 - pop.getBoundingClientRect().left;
  pop.style.setProperty('--arrow-x', `${Math.max(12, arrow)}px`);
  btn.setAttribute('aria-expanded', 'true');
}

function closeHelp(btn) {
  popOf(btn).hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  if (pinnedHelp === btn) pinnedHelp = null;
}

for (const btn of helpButtons) {
  btn.addEventListener('click', (e) => {
    e.preventDefault(); // it sits inside the option's label: don't tick the checkbox
    e.stopPropagation();
    if (pinnedHelp === btn) closeHelp(btn);
    else {
      openHelp(btn);
      pinnedHelp = btn;
    }
  });
  btn.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && !pinnedHelp) openHelp(btn);
  });
  btn.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && pinnedHelp !== btn) closeHelp(btn);
  });
}
document.addEventListener('click', (e) => {
  if (pinnedHelp && !e.target.closest('.help-pop')) closeHelp(pinnedHelp);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !pinnedHelp) return;
  const btn = pinnedHelp;
  closeHelp(btn);
  btn.focus();
});

// --- Data -----------------------------------------------------------------
// The banners come from godfat's open data, rebuilt every day and checked
// against bc.godfat.org (data/status.json). Visitors are told when the data is
// old or did not match godfat in the last check.

const showDate = (iso) => new Date(iso).toLocaleDateString('es-ES');

function dataNotices(data, status, now = Date.now()) {
  const notices = [];
  if (status?.result === 'mismatch') {
    notices.push(
      `En la última comprobación (${showDate(status.checkedAt)}) algunos datos o cálculos de la app no coincidían con bc.godfat.org. Ya se está revisando; mientras tanto, comprueba cada paso en godfat (cada paso tiene su enlace) antes de gastar nada.`
    );
  } else if (!status?.lastOk || now - Date.parse(status.lastOk) > UNVERIFIED_DAYS * DAY_MS) {
    notices.push(
      `No se ha podido comprobar la app contra bc.godfat.org ${status?.lastOk ? `desde el ${showDate(status.lastOk)}` : 'todavía'}. Comprueba los pasos en godfat antes de gastar.`
    );
  }
  // Banners godfat already lists that its open data does not have yet.
  const pending = status?.pending || [];
  if (pending.length) {
    // A plain date (YYYY-MM-DD): read as such, not as midnight UTC.
    const first = pending.map((p) => p.start).sort()[0].split('-').reverse().join('/');
    notices.push(
      `bc.godfat.org ya anuncia ${pending.length === 1 ? 'un banner que aún no está' : `${pending.length} banners que aún no están`} en los datos de la app (desde el ${first}). Las rutas no los tienen en cuenta: se añadirán en la actualización diaria en cuanto godfat los publique en sus datos abiertos.`
    );
  }
  // Banners of godfat's data the app could not read: left out of the routes.
  const day = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
  const left = (data.skipped || []).filter((s) => s.end && s.end >= todayIso());
  if (left.length) {
    const names = left.map((s) => `«${s.name || s.id}»${s.start ? ` (${day(s.start)}–${day(s.end)})` : ''}`).join(', ');
    notices.push(
      `${left.length === 1 ? 'Un banner de los datos de godfat no se ha podido leer y no entra' : `${left.length} banners de los datos de godfat no se han podido leer y no entran`} en las rutas: ${names}. Ya se está revisando.`
    );
  }
  if (now - Date.parse(data.generatedAt) > STALE_DATA_DAYS * DAY_MS) {
    notices.push(`Los datos de los banners no se actualizan desde el ${showDate(data.generatedAt)}: puede que falten banners anunciados después.`);
  }
  return notices;
}

function renderDataInfo(data, status) {
  const commit = data.source.commit === 'local' ? 'copia local' : data.source.commit.slice(0, 8);
  const committed = data.source.committedAt ? ` del ${showDate(data.source.committedAt)}` : '';
  // Status dot: green when checked against godfat lately, amber when the
  // check is old or missing, red when it did not match.
  const mismatch = status?.result === 'mismatch';
  const recent = status?.lastOk && Date.now() - Date.parse(status.lastOk) <= UNVERIFIED_DAYS * DAY_MS;
  const state = mismatch ? 'bad' : recent ? 'ok' : 'warn';
  const check = mismatch
    ? `No coincidía con bc.godfat.org el ${showDate(status.checkedAt)}`
    : status?.lastOk
      ? `Comprobados con bc.godfat.org el ${showDate(status.lastOk)}`
      : 'Aún sin comprobar con bc.godfat.org';
  $('#data-info').innerHTML = `<span class="foot-label">Datos</span>
    <span>Banners de godfat${esc(committed)} <code>${esc(commit)}</code></span>
    <span class="foot-check ${state}"><i aria-hidden="true"></i>${esc(check)}</span>`;
  const notices = dataNotices(data, status);
  $('#data-notice').hidden = !notices.length;
  $('#data-notice').innerHTML = notices.map((n) => `<p>${esc(n)}</p>`).join('');
}

// The game applies the banner hours in the player's local time, like the
// plan: say which hour and which time zone, so nobody has to convert anything.
function renderTimeNote(data) {
  const hours = new Set(data.events.flatMap((e) => [e.startTime, e.endTime]).filter(Boolean));
  const when = hours.size === 1 ? `a las ${[...hours][0]}` : 'a su hora (casi siempre las 11:00)';
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    // Without Intl the note just leaves the zone out.
  }
  $('#time-note').textContent = `Los banners abren y cierran ${when} en la hora de este dispositivo${zone ? ` (${zone})` : ''}, como en el juego.`;
}

async function loadData() {
  try {
    const res = await fetch('data/gacha.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    gachaData = await res.json();
  } catch (err) {
    countEvent('error-datos', 'Errores al cargar los datos de los banners');
    showError(
      location.protocol === 'file:'
        ? 'Esta página no funciona abriendo el archivo HTML directamente. Usa la web publicada o arranca la app con «Iniciar TBC Seed Router.bat».'
        : `No se pudieron cargar los datos de los banners (${err.message}). Recarga la página; si se repite, escribe a tbcseedrouter@gmail.com.`
    );
    dataFailed = true; // the button stays: pressing it brings this error into view
    picker.fail();
    return;
  }
  let status = null;
  try {
    const res = await fetch('data/status.json', { cache: 'no-cache' });
    if (res.ok) status = await res.json();
  } catch {
    /* no check published yet: the notice says so */
  }
  const icons = new Set(gachaData.icons || []);
  const cats = catalogOf(gachaData).map((c) => ({ ...c, image: icons.has(c.id) ? `icons/${c.id}.png` : null }));
  picker.load(cats, gachaData.generatedAt);
  updateLoad(); // picker.load restores the saved cats before the data is set
  renderDataInfo(gachaData, status);
  renderTimeNote(gachaData);
}

// "Reportar un error": an e-mail with the form's data already filled in, so
// the problem can be reproduced. Built on click, with the current values.
const CONTACT = 'tbcseedrouter@gmail.com';
$('#report-link').addEventListener('click', (e) => {
  const f = form.elements;
  const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const yes = (on) => (on ? 'sí' : 'no');
  const cats = picker.value().map((key) => picker.byId.get(key)?.name || key);
  const body = [
    'Hola, he encontrado un problema en TBC Seed Router.',
    '',
    'Qué ha pasado (y en qué ruta y paso, si es un error de cálculo):',
    '',
    '',
    '--- Datos del análisis ---',
    `Semilla: ${f.url.value.trim() || '—'}`,
    `Gatos elegidos: ${cats.join(', ') || '—'}`,
    `Fechas: ${day(f.from.value)} – ${day(f.to.value)}`,
    `Tiros revisados: ${f.rolls.value || '—'}`,
    `Rare Tickets: ${f.tickets.value || 0} · Cat Food: ${f.food.value || 0}`,
    `Descuentos: 11-draw a 750 ${yes(f.discount11.checked)}${f.discount11.checked ? ` (incluirlo siempre: ${yes(f.spend11.checked)})` : ''} · tiro simple a 30 ${yes(f.discount1.checked)}`,
    `Proteger casillas: moradas ${yes(f.avoidLegend.checked)} · lilas ${yes(f.avoidLegendFest.checked)}`,
    `Datos de la web: ${gachaData ? `${showDate(gachaData.generatedAt)} (${gachaData.source.commit.slice(0, 8)})` : 'sin cargar'}`,
  ].join('\n');
  e.currentTarget.href = `mailto:${CONTACT}?subject=${encodeURIComponent('Error en TBC Seed Router')}&body=${encodeURIComponent(body)}`;
});

$('#forget-data').addEventListener('click', () => {
  store(STORAGE_KEY, null);
  store(THEME_KEY, null);
  location.reload();
});

initStats();
restoreForm();
// «Incluirlo siempre en la ruta» belongs to the 11-draw discount: shown only with it.
const syncSpendOption = () => {
  $('#spend11-row').hidden = !form.discount11.checked;
};
syncSpendOption();
form.discount11.addEventListener('change', syncSpendOption);
const dataLoaded = loadData();
form.from.addEventListener('change', syncDateLimits);
form.to.addEventListener('change', syncDateLimits);
form.addEventListener('input', recheckField);
form.addEventListener('change', recheckField);
// The load follows the cats, dates, rolls and tickets as they change.
form.addEventListener('input', updateLoad);
form.addEventListener('change', updateLoad);
$('#picker').addEventListener('targetschange', updateLoad);
form.addEventListener('submit', submit);

// "Ver motivo": a quick smooth scroll to the card that explains the missing
// cat, which lights up for a moment so it is clear which one it is.
function scrollToCard(card) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const margin = 16;
  const from = window.scrollY;
  const to = Math.max(0, from + card.getBoundingClientRect().top - margin);
  const distance = to - from;
  const duration = reduce ? 0 : Math.min(450, Math.max(250, Math.abs(distance) / 6));
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const stepTo = (now) => {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    window.scrollTo(0, from + distance * ease(t));
    if (t < 1) requestAnimationFrame(stepTo);
    else {
      card.focus({ preventScroll: true });
      card.classList.remove('flash');
      void card.offsetWidth; // restart the animation if it is already lit
      card.classList.add('flash');
    }
  };
  requestAnimationFrame(stepTo);
}

$('#results').addEventListener('click', (e) => {
  const link = e.target.closest('a.why-link');
  if (!link) return;
  const card = document.getElementById(link.getAttribute('href').slice(1));
  if (!card) return;
  e.preventDefault();
  scrollToCard(card);
});

// "Añadir a objetivos y recalcular" on a legendary suggested in the results.
$('#results').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add-target]');
  if (!btn) return;
  if (!picker.addByName(btn.dataset.addTarget)) {
    showError(`No se encontró «${btn.dataset.addTarget}» en la lista de gatos.`);
    return;
  }
  form.requestSubmit();
});
