import { plan, parseRequest, catalogOf, UserError } from './core/planner.js';
import { TargetPicker } from './picker.js';
import { godfatLink } from './core/godfat-link.js';
import { initMascot } from './mascot.js';
import { initStats, countEvent } from './stats.js';

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

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('es-ES');
// Dates in the user's own time zone (toISOString would give the UTC day).
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDate(new Date());

const KIND_LABEL = {
  standard: 'Simples y 11-draw',
  guaranteed: 'Garantizado 11',
  stepup: 'Step-up 3+5+7',
};
const ACTION_LABEL = {
  single: (s) => (s.count > 1 ? `${s.count} tiros simples` : 'Tiro simple'),
  multi: () => '11-draw',
  guaranteed: () => '11-draw garantizado',
  stepup: () => 'Step-up 3+5+7',
};

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  setBusy('Calculando…');
  $('#error').hidden = true;
  $('#progress').textContent = 'Calculando las tiradas de tu semilla y las mejores rutas…';
  show('status');
  // Let the page paint the progress (and finish scrolling to it, on phones the
  // results are below the form) before the synchronous calculation.
  const scrolled = bringIntoView($('#status'));
  await new Promise((resolve) => setTimeout(resolve, scrolled ? 450 : 30));
  let gotResult = false;
  let fieldError = null;
  countEvent('calcular-ruta', 'Rutas calculadas');
  try {
    const result = plan(body, gachaData);
    gotResult = true;
    current = { data: result, selected: result.routes.findIndex((r) => r.found) };
    render();
    if (current.selected >= 0) mascot.play(); // a route found: the cat celebrates
    else countEvent('sin-ruta', 'Cálculos sin ninguna ruta posible');
  } catch (err) {
    if (err instanceof UserError && err.field) fieldError = err; // e.g. the day changed meanwhile
    else if (err instanceof UserError) showError(err.message);
    else {
      console.error(err);
      countEvent('error-inesperado', 'Errores inesperados al calcular');
      showError(
        `Error inesperado al calcular: ${err.message}. Si se repite, avísanos con «Reportar un error» (al pie de la página): el correo lleva ya los datos de tu formulario.`
      );
    }
  } finally {
    setBusy(null);
    show(gotResult ? 'results' : 'empty');
    if (fieldError) showFieldError(fieldError.field, fieldError.message);
    else bringIntoView($(gotResult ? '#results' : '#error'));
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
  $('#results').innerHTML = [
    data.routes.some((r) => r.found) ? renderSupport() : '', // only when it has just been useful
    renderContext(data),
    renderDiagnostics(data),
    data.routes.some((r) => r.found) ? renderRoutesTable(data) : '', // none: the diagnostics explain why
    renderDetail(data),
  ].join('');
  for (const d of document.querySelectorAll('#results details[data-section]')) d.open = open.has(d.dataset.section);
  for (const tr of document.querySelectorAll('.routes tbody tr[data-i]')) {
    tr.addEventListener('click', () => {
      current.selected = Number(tr.dataset.i);
      render();
    });
  }
}

const SUPPORT_URL = 'https://ko-fi.com/tonajzp';

// Shown on top of every analysis: the moment the tool has just been useful.
function renderSupport() {
  return `<aside class="support" aria-label="Apoyar el proyecto">
    <span class="support-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 14.2 2.5 8.9A3.4 3.4 0 0 1 7.3 4.1l.7.7.7-.7a3.4 3.4 0 0 1 4.8 4.8z"/></svg></span>
    <b class="support-title">¿Te ha ayudado a planear tus tiradas?</b>
    <p class="support-body">TBC Seed Router es gratis y sin anuncios. Con una pequeña donación me ayudas a tenerla al día
      con cada banner nuevo y a seguir creando herramientas gratuitas para la comunidad.</p>
    <a class="support-button" href="${SUPPORT_URL}" target="_blank" rel="noopener">Apoyar con una donación</a>
  </aside>`;
}

const withHour = (iso, hour) => `${iso}${hour ? ` ${hour}` : ''}`;

// Summary on top of the analysis: the seed and its key figures, then
// table-like rows that open (banners, legend cells) and the lilac note.
function renderContext(data) {
  const rows = data.events
    .map(
      (e) => `<tr>
        <td class="num dates">${esc(withHour(e.start, e.startTime))} – ${esc(withHour(e.end, e.endTime))}</td>
        <td class="bname">${esc(e.name)}</td>
        <td class="kind">${esc(KIND_LABEL[e.kind] || e.kind)}</td>
      </tr>`
    )
    .join('');
  const skipped = data.skipped
    .map((s) => `<tr><td class="dates"></td><td class="muted bname">${esc(s.name)}</td><td class="kind">Excluido: ${esc(s.reason)}</td></tr>`)
    .join('');
  return `<section class="summary" aria-label="Resumen del análisis">
    <header class="summary-top">
      <div class="seed-id"><span class="seed-label">Semilla</span><h2 class="seed-num">${esc(data.seed)}</h2></div>
      <p class="summary-facts"><b>${fmt(data.rolls)}</b> tiros por pista · <b>${data.events.length}</b> banners · 1 Rare Ticket = <b>150</b> Cat Food</p>
    </header>
    ${disclosure('banners', 'Banners analizados', data.events.length,
      `<div class="table-wrap"><table class="banners events"><thead><tr><th>Fechas</th><th>Banner</th><th>Tipo</th></tr></thead>
      <tbody>${rows}${skipped}</tbody></table></div>`)}
    ${renderAllLegendCells(data)}
    ${renderNotices(data)}
  </section>`;
}

/** A row of the summary that opens: title, a count, and its content. */
function disclosure(section, title, count, body) {
  return `<details class="summary-row" data-section="${section}">
    <summary><span>${title}</span><span class="count">${count}</span></summary>
    <div class="summary-body">${body}</div>
  </details>`;
}

const COLOR_DOT = { morada: 'legend', lila: 'legend-fest' };

/** Id of the diagnostic card that explains each missing cat, by its name. */
function reasonIds(data) {
  const ids = new Map();
  (data.diagnostics || []).forEach((d, i) => {
    for (const name of d.targets?.length ? d.targets : [d.target]) if (name && !ids.has(name)) ids.set(name, `diag-${i}`);
  });
  return ids;
}

/** Legendaries a legend cell can give, each with a button to add it as a target. */
function legendOptions(cell) {
  if (!cell.legends.length) return '<span class="muted">ningún banner de tus fechas da legendario aquí (sale un uber)</span>';
  const byName = new Map();
  for (const l of cell.legends) byName.set(l.name, [...(byName.get(l.name) || []), l]);
  return [...byName]
    .map(([name, options]) => {
      return `<span class="legend-option">
        <b>${esc(name)}</b> <span class="muted">en ${options.map((l) => esc(l.eventName)).join(', ')}</span>
        ${addTargetButton(name)}
      </span>`;
    })
    .join('');
}

function renderAllLegendCells(data) {
  const cells = data.legendCells || [];
  if (!cells.length) return '';
  const rows = cells
    .map((c) => `<tr><td class="mono nowrap"><i class="dot ${COLOR_DOT[c.color]}"></i>${esc(c.key)}</td><td>${legendOptions(c)}</td></tr>`)
    .join('');
  return disclosure('legend', `Casillas de legendario en tus próximos ${data.rolls} tiros`, cells.length,
    `<div class="table-wrap"><table class="banners legend-all"><thead><tr><th>Casilla</th><th>Legendario posible según los banners de tus fechas</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

const FIT = {
  same: ['Misma ruta', 'Tira esa casilla en este banner: mismo coste y el resto de la ruta no cambia.'],
  draw: ['Cambia la ruta', 'Esa casilla va dentro de un 11-draw y su banner no se puede cambiar solo para esa tirada: añádelo a tus objetivos y la ruta se recalcula.'],
  next: ['Cambia la ruta', 'Tirarla en este banner cambiaría las tiradas siguientes: añádelo a tus objetivos y la ruta se recalcula.'],
};

/** "Add to targets" button, or a tag if it already is one. */
const addTargetButton = (name) =>
  picker.isSelected(name)
    ? '<span class="tag">ya es objetivo</span>'
    : `<button type="button" class="link-button" data-add-target="${esc(name)}">Añadir a objetivos</button>`;

/**
 * Legend cells the selected route rolls: what it gets in each, and every
 * other legendary that a banner open at that moment would give there, one
 * row each, with whether it keeps the route.
 */
function renderRouteLegendCells(r, data) {
  if (!r.legendCells.length) {
    return '<h3 class="section-title">Casillas de legendario</h3><p class="muted">Esta ruta no pasa por ninguna casilla de legendario.</p>';
  }
  const evById = new Map(data.events.map((e) => [e.id, e]));
  const groups = r.legendCells
    .map((c) => {
      const got =
        c.got.rarity === 'legendary'
          ? `<b>${esc(c.got.name)}</b><span class="tag">legendario</span>`
          : `${esc(c.got.name)}<small class="clip" title="${esc(c.eventName)}">no legendario · ${esc(c.eventName)}</small>`;
      const options = [...c.legends].sort((a, b) => Number(b.sameRoute) - Number(a.sameRoute));
      const rows = options.length
        ? options.map((l) => {
          const ev = evById.get(l.eventId);
          const [label, why] = FIT[l.sameRoute ? 'same' : c.inDraw ? 'draw' : 'next'];
          return `<td class="opt"><b>${esc(l.name)}</b></td>
              <td class="ev" title="${esc(l.eventName)}"><span class="ev-name">${esc(l.eventName)}</span>${ev ? `<small>hasta el ${esc(shortWithHour(ev.end, ev.endTime))}</small>` : ''}</td>
              <td class="fitc"><span class="fit ${l.sameRoute ? 'same' : 'change'}" title="${esc(why)}">${label}</span></td>
              <td class="add">${addTargetButton(l.name)}</td>`;
        })
        : [`<td colspan="4" class="muted">${c.got.rarity === 'legendary' ? 'Ningún otro banner activo en ese momento da otro legendario aquí.' : 'Ningún banner activo en ese momento da legendario aquí.'}</td>`];
      const lead = `<td rowspan="${rows.length}" class="cell"><i class="dot ${COLOR_DOT[c.color]}"></i>${esc(c.key)}<small>paso ${c.step}</small></td>
        <td rowspan="${rows.length}" class="got">${got}</td>`;
      return rows.map((row, i) => `<tr class="${i === 0 ? 'first' : 'more'}">${i === 0 ? lead : ''}${row}</tr>`).join('');
    })
    .join('');
  const lost = r.legendCells.filter((c) => c.got.rarity !== 'legendary' && c.legends.length).length;
  const warn = lost
    ? `<p class="notice">Esta ruta gasta ${lost} casilla${lost > 1 ? 's' : ''} de legendario sin sacar el legendario. Si quieres alguno, añádelo como objetivo y se recalculará la ruta para conseguirlo junto a los demás.</p>`
    : '';
  return `<h3 class="section-title">Casillas de legendario en esta ruta</h3>
    ${warn}
    <p class="hint">Otros legendarios que darían los banners activos cuando esta ruta tira cada casilla. «Misma ruta»: tírala en ese banner y nada más cambia. «Cambia la ruta»: añádelo a tus objetivos y se recalcula.</p>
    <div class="table-wrap"><table class="legend-cells">
      <thead><tr><th>Casilla</th><th>Qué sacas ahí</th><th>Otro legendario posible</th><th>En el banner</th><th>En esta ruta</th><th></th></tr></thead>
      <tbody>${groups}</tbody>
    </table></div>`;
}

// Why the plan can't get every cat: one card per cause, with the affected
// cats, the concrete cells/banners, what to do, and links to check it on godfat.
function renderDiagnostics(data) {
  const items = data.diagnostics || [];
  if (!items.length) return '';
  const routeless = !data.routes.some((r) => r.found);
  const intro = routeless
    ? 'No se ha podido calcular ninguna ruta. Estos son los motivos:'
    : 'La ruta recomendada no consigue todos los gatos elegidos. Estos son los motivos:';
  const cards = items
    .map(
      (d, i) => `<article class="diag" id="diag-${i}" tabindex="-1">
        <h4>${esc(d.headline)}</h4>
        ${d.target ? `<p class="diag-target">Afecta a: <b>${esc(d.target)}</b></p>` : ''}
        <ul>${d.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${d.fix ? `<p class="diag-fix"><span>Qué puedes hacer</span>${esc(d.fix)}</p>` : ''}
        ${d.links.length
          ? `<p class="diag-links"><span>Compruébalo en godfat:</span> ${d.links
            .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.label)}">${esc(l.label.split(' · ')[0])}</a>`)
            .join(' ')}</p>`
          : ''
        }
      </article>`
    )
    .join('');
  return `<section class="diagnostics" id="diagnostics">
    <h3 class="section-title">Por qué no se puede conseguir todo</h3>
    <p class="diag-intro">${intro}</p>
    ${cards}
  </section>`;
}

function renderNotices(data) {
  const lines = [];
  const p = data.protection;
  const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  if (p.legendFestRequested && !p.legendFest) {
    lines.push('<b>Casillas lilas sin proteger.</b> Desde tu fecha «Desde» no hay ningún banner anunciado con más probabilidad de legendario (Royalfest, doble legend…), así que se usan como casillas normales.');
  } else if (p.legendFest) {
    const banners = p.doubleLegendEvents.map((e) => `«${esc(e.name)}» (${shortDate(e.start)}–${shortDate(e.end)})`);
    lines.push(`<b>Casillas lilas protegidas.</b> Dan legendario en ${banners.join('; ')}.`);
  }
  return lines.length
    ? `<div class="summary-note"><i class="dot legend-fest" aria-hidden="true"></i><p>${lines.join(' ')}</p></div>`
    : '';
}

/** How a route is referred to in another one's note: "la recomendada" or «its label». */
function routeName(data, key) {
  const r = data.routes.find((x) => x.key === key);
  return r.recommended ? 'la recomendada' : `«${esc(r.label)}»`;
}

function renderRoutesTable(data) {
  const rows = data.routes
    .map((r, i) => {
      if (!r.found) {
        return `<tr><td><span class="name">${esc(r.label)}</span><span class="sub">${esc(r.reason)}</span></td><td colspan="7" class="filler"></td></tr>`;
      }
      const t = r.totals;
      const got = r.targets.filter((x) => x.obtained).length;
      const requested = r.targets.length + (data.unplanned || []).length;
      const g = t.guaranteedDraws;
      const draws = t.multiDraws + g
        ? `${t.multiDraws + g}${g ? `<span class="sub">${g} garantizado${g > 1 ? 's' : ''}</span>` : ''}`
        : '—';
      const note = r.sameAs
        ? `Misma ruta que ${routeName(data, r.sameAs)}.`
        : r.sameCostAs
          ? `Mismo coste que ${routeName(data, r.sameCostAs)}: no hay alternativa mejor en este criterio.`
          : esc(r.description);
      return `<tr data-i="${i}" class="${i === current.selected ? 'selected' : ''}">
        <td><span class="name">${esc(r.label)}${r.recommended ? '<span class="tag">Recomendada</span>' : ''}</span>
          <span class="sub">${note}</span></td>
        <td class="r num ${got < requested ? 'bad' : ''}" data-label="Objetivos">${got}/${requested}</td>
        <td class="r num" data-label="Rare Tickets">${fmt(t.ticketsUsed)}</td>
        <td class="r num" data-label="Cat Food">${fmt(t.foodUsed)}</td>
        <td class="r num" data-label="Coste total"><b>${fmt(t.totalCost)}</b></td>
        <td class="r num" data-label="Tiros">${fmt(t.pulls)}</td>
        <td class="r num nowrap" data-label="11-draws">${draws}</td>
        <td class="r nowrap afford" data-label="¿Te alcanza?">${t.affordable ? '<span class="ok">Sí</span>' : `<span class="bad">Faltan ${fmt(t.shortfall)} CF</span>`}</td>
      </tr>`;
    })
    .join('');
  const short = data.routes.some((r) => r.found && !r.totals.affordable);
  const shown = data.routes[current.selected];
  const shownNote = shown?.found && data.routes.filter((r) => r.found).length > 1
    ? `<p class="routes-hint shown">Abajo tienes los pasos y detalles de <b>«${esc(shown.label)}»</b>. Para ver los de otra ruta, pulsa sobre ella.</p>`
    : '';
  const shortNote = short
    ? `<p class="hint routes-hint">«Faltan»: Cat Food que necesitarías además de la que tienes (${fmt(data.inventory.food)}) para hacer esa ruta entera. Los Rare Tickets nunca faltan: cada ruta solo usa los que tienes.</p>`
    : '';
  return `<header class="sheet-head"><h3 class="sheet-label">Rutas</h3></header>
    <div class="table-wrap"><table class="routes">
      <thead><tr>
        <th><span class="sr-only">Ruta</span></th><th class="r">Objetivos</th><th class="r">Rare Tickets</th><th class="r">Cat Food</th>
        <th class="r">Coste total</th><th class="r">Tiros</th>
        <th class="r" title="Cuántos 11-draws hace la ruta (1500 Cat Food cada uno). Debajo, cuántos de ellos son garantizados o step-up.">11-draws</th>
        <th class="r" title="Si la Cat Food que tienes basta para hacer la ruta entera; si no, cuánta te falta.">¿Te alcanza?</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${shownNote}
    ${shortNote}`;
}

function renderDetail(data) {
  const r = data.routes[current.selected];
  if (!r || !r.found) return '';
  const t = r.totals;
  const warnings = [
    !r.complete &&
    `No existe ninguna ruta que consiga todos los objetivos con estas fechas, protecciones y tiros. Esta consigue el máximo posible; el motivo de cada gato que falta está en «Por qué no se puede conseguir todo».`,
    r.exhausted && 'La búsqueda alcanzó su límite de tamaño: el resultado puede no ser el óptimo.',
  ].filter(Boolean);
  // Not enough Cat Food: the most important thing to know about the route.
  const budget = t.affordable
    ? ''
    : `<div class="notice alert" role="note">
        <b>Te faltan ${fmt(t.shortfall)} de Cat Food para esta ruta</b>
        <p>Necesita ${fmt(t.foodUsed)} y tienes ${fmt(data.inventory.food)}. Sin esa Cat Food no podrás hacer todos los pasos, así que no conseguirás todos tus objetivos.${
          r.overBudget ? ' Ninguna ruta de tus fechas cabe en la Cat Food que tienes.' : ''
        }</p>
      </div>`;
  const discountLines = [
    ['Primer 11-Draw a 750', r.discounts.multi],
    ['Primer tiro simple a 50', r.discounts.single],
  ]
    .filter(([, d]) => d)
    .map(([name, d]) =>
      d.step
        ? `<li><b>${name}</b>: se usa en el paso ${d.step}.</li>`
        : `<li><b>${name}</b>: no se usa, ${esc(d.reason)}</li>`
    )
    .join('');

  // A missing cat links straight to the card that explains it.
  const reasons = reasonIds(data);
  const missing = (name) =>
    `<li class="missing"><span>${esc(name)}</span><a class="where why-link" href="#${reasons.get(name) || 'diagnostics'}">Ver motivo <span aria-hidden="true">↑</span></a></li>`;
  const targets = r.targets
    .map((x) =>
      x.obtained
        ? `<li><span>${esc(x.names.join(' / '))}</span><span class="where">paso ${x.step}</span></li>`
        : missing(x.names.join(' / '))
    )
    .concat((data.unplanned || []).map(missing))
    .join('');

  // Step that gets the last target: an 11-draw after it only spends the discount.
  const lastHit = Math.max(0, ...r.targets.filter((x) => x.obtained).map((x) => x.step));
  const cheapest = data.routes.find((x) => x.key === 'optimal');
  const why =
    r.recommendedFor === 'leastFood' && cheapest?.found
      ? `<p class="why">Se recomienda esta porque no tienes Cat Food suficiente para ninguna ruta y es la que menos te pide: gasta primero tus Rare Tickets. «${esc(cheapest.label)}» gasta menos en total porque prefiere 11-draws (más baratos por tiro), pero te pediría ${fmt(cheapest.totals.shortfall)} de Cat Food más.</p>`
      : '';

  return `<section class="detail">
    <div class="detail-head">
      <h3>${esc(r.label)}${r.recommended ? '<span class="tag">Recomendada</span>' : ''}</h3>
      <p>${esc(r.description)}</p>
      ${why}
    </div>
    ${budget}
    ${warnings.length ? `<div class="notice">${warnings.map((w) => `<p>${w}</p>`).join('')}</div>` : ''}
    <dl class="figures">
      <div><dt>Coste total</dt><dd>${fmt(t.totalCost)}</dd></div>
      <div><dt>Rare Tickets</dt><dd>${fmt(t.ticketsUsed)} <span class="muted">/ ${fmt(data.inventory.tickets)}</span></dd></div>
      <div><dt>Cat Food</dt><dd>${fmt(t.foodUsed)} <span class="muted">/ ${fmt(data.inventory.food)}</span></dd></div>
      <div><dt>Tiros</dt><dd>${fmt(t.pulls)}</dd></div>
      <div><dt>Posición final</dt><dd class="mono">${esc(t.finalPosition)}</dd></div>
    </dl>
    ${discountLines ? `<h3 class="section-title">Descuentos</h3><ul class="discounts">${discountLines}</ul>` : ''}
    <h3 class="section-title">Objetivos</h3>
    <ul class="targets">${targets}</ul>
    ${renderRouteLegendCells(r, data)}
    <h3 class="section-title">Pasos</h3>
    <p class="hint steps-hint">Haz cada paso en el banner que indica, el día indicado o después, mientras siga activo. Las horas son las de tu dispositivo, que son las que usa el juego para cambiar los banners. Pulsa el nombre del banner para abrir esa misma tabla en godfat y comprobar los gatos antes de tirar.</p>
    <div class="table-wrap"><table class="steps">
      <thead><tr><th>#</th><th title="Día en el que puedes hacer este paso">Día</th><th>Banner</th><th>Acción</th><th>Posición</th><th class="r">Pago</th><th>Gatos</th></tr></thead>
      <tbody>${r.steps.map((s, i) => renderStep(s, data, r.steps[i - 1], lastHit)).join('')}</tbody>
    </table></div>
    <div class="legend-row">
      <span><span class="cat">Rare</span></span>
      <span><span class="cat super">Super</span></span>
      <span><span class="cat uber">Uber</span></span>
      <span><span class="cat legendary">Legendary</span></span>
      <span><span class="cat target">Objetivo</span></span>
      <span>↺ rare duplicado (cambio de pista)</span>
      <span>★ uber garantizado</span>
      <span><i class="dot legend"></i>casilla morada · <i class="dot legend-fest"></i>casilla lila</span>
    </div>
  </section>`;
}

const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// Banner hours are local: the game applies them in the player's time zone.
const shortWithHour = (iso, hour) => `${shortDate(iso)}${hour ? ` ${hour}` : ''}`;

/** "Before HH:MM", unless the same banner carries on after that hour. */
function closingNote(s, ev) {
  const next = ev?.continuedBy;
  if (!next) return `<small class="deadline">antes de las ${esc(s.closesAt)}</small>`;
  return `<small>antes de las ${esc(s.closesAt)}; luego sigue igual hasta el ${esc(shortWithHour(next.end, next.endTime))}</small>`;
}

function renderStep(s, data, prev, lastHit = Infinity) {
  // The table as godfat draws it after the cat rolled just before this step.
  const last = prev ? prev.cats[prev.cats.length - 1].id : data.last;
  const untilRow = Math.max(Number.parseInt(s.from, 10), Number.parseInt(s.to, 10));
  const { url: link, shifted } = godfatLink({ seed: data.seed, eventId: s.eventId, key: s.from, untilRow, last });
  const ev = data.events.find((e) => e.id === s.eventId);
  const change = prev && prev.eventId !== s.eventId ? ' · <b>cambio de banner</b>' : '';
  const pay = [s.ticketsSpent && `${s.ticketsSpent} ticket${s.ticketsSpent > 1 ? 's' : ''}`, s.foodSpent && `${fmt(s.foodSpent)} CF`]
    .filter(Boolean)
    .join(' + ');
  const discounted = /descuento/.test(s.payment);
  const spendOnly = discounted && s.type !== 'single' && s.index > lastHit;
  const note = spendOnly ? '<small>solo para gastar el descuento</small>' : discounted ? '<small>con descuento</small>' : '';
  const jump = s.dupeSwitch ? '<span class="jump">cruce por duplicado</span>' : '';
  // On phones the card says which targets the step gets (the table marks the cats).
  const got = s.cats.filter((c) => c.newTarget).map((c) => `<b>${esc(c.name)}</b>`);
  const gotLine = got.length ? `<p class="step-got">Consigues ${got.join(', ')}</p>` : '';
  const cats = s.cats
    .map((c) => {
      const cls = ['cat', c.rarity === 'rare' ? '' : c.rarity, c.target ? 'target' : ''].filter(Boolean).join(' ');
      const marks = `${c.rerolled ? '<span class="mark">↺</span>' : ''}${c.guaranteed ? '<span class="mark">★</span>' : ''}`;
      const dot = c.legendCell ? `<i class="dot ${COLOR_DOT[c.legendCell]}" title="Casilla ${c.legendCell} (${esc(c.cell)})"></i>` : '';
      const title = c.protectedSkip ? ' title="Es un objetivo, pero cae en una casilla protegida: aquí no cuenta"' : '';
      return `<span class="${cls}${c.protectedSkip ? ' skipped' : ''}"${title}>${dot}${esc(c.name)}${marks}</span>`;
    })
    .join('');
  return `<tr class="${s.cats.some((c) => c.newTarget) ? 'hit' : ''}">
    <td class="idx num">${s.index}</td>
    <td class="num day"><span class="nowrap">${esc(shortDate(s.date))}</span>${s.opensAt ? `<small>desde las ${esc(s.opensAt)}</small>` : ''}${s.closesAt ? closingNote(s, ev) : ''}</td>
    <td class="banner"><a href="${esc(link)}" target="_blank" rel="noopener" title="${shifted ? `Ver en godfat: allí la casilla ${esc(s.from)} aparece como 1A` : 'Ver esta tabla en godfat'}">${esc(s.eventName)}</a>
      ${ev ? `<span class="active-range">Activo del ${esc(shortWithHour(ev.start, ev.startTime))} al ${esc(shortWithHour(ev.end, ev.endTime))}</span>` : ''}${change ? `<small>${change.replace(/^ · /, '')}</small>` : ''}</td>
    <td class="action">${ACTION_LABEL[s.type](s)}${note}</td>
    <td class="pos">${esc(s.from)} → ${esc(s.to)}${jump}</td>
    <td class="r pay num">${pay || '0'}</td>
    <td class="cats-cell">${gotLine}<div class="cats">${cats}</div></td>
  </tr>`;
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
  localStorage.setItem(THEME_KEY, next);
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
      `En la última comprobación (${showDate(status.checkedAt)}) algunos cálculos de la app no coincidían con bc.godfat.org. Ya se está revisando; mientras tanto, comprueba cada paso en godfat (cada paso tiene su enlace) antes de gastar nada.`
    );
  } else if (!status?.lastOk || now - Date.parse(status.lastOk) > UNVERIFIED_DAYS * DAY_MS) {
    notices.push(
      `No se ha podido comprobar la app contra bc.godfat.org ${status?.lastOk ? `desde el ${showDate(status.lastOk)}` : 'todavía'}. Comprueba los pasos en godfat antes de gastar.`
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
    `Descuentos: 11-draw a 750 ${yes(f.discount11.checked)}${f.discount11.checked ? ` (incluirlo siempre: ${yes(f.spend11.checked)})` : ''} · tiro simple a 50 ${yes(f.discount1.checked)}`,
    `Proteger casillas: moradas ${yes(f.avoidLegend.checked)} · lilas ${yes(f.avoidLegendFest.checked)}`,
    `Datos de la web: ${gachaData ? `${showDate(gachaData.generatedAt)} (${gachaData.source.commit.slice(0, 8)})` : 'sin cargar'}`,
  ].join('\n');
  e.currentTarget.href = `mailto:${CONTACT}?subject=${encodeURIComponent('Error en TBC Seed Router')}&body=${encodeURIComponent(body)}`;
});

$('#forget-data').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(THEME_KEY);
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
