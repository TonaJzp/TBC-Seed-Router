import { plan, catalogOf, UserError } from './core/planner.js';
import { TargetPicker } from './picker.js';
import { godfatLink } from './core/godfat-link.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#route-form');
const STORAGE_KEY = 'bc-seed-router-form';
const picker = new TargetPicker($('#picker'));
const DAY_MS = 86_400_000;
const STALE_DATA_DAYS = 3; // the data is rebuilt every day
const UNVERIFIED_DAYS = 4; // and checked against godfat every day

let gachaData = null; // banner data (data/gacha.json), loaded at start

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
function syncDateLimits() {
  const today = todayIso();
  form.from.min = today;
  form.to.min = form.from.value > today ? form.from.value : today;
}

function dateProblem() {
  const today = todayIso();
  const show = (iso) => iso.split('-').reverse().join('/');
  if (form.from.value && form.from.value < today) return `La fecha «Desde» no puede ser anterior a hoy (${show(today)}).`;
  if (form.to.value && form.to.value < form.from.value) return 'La fecha «Hasta» no puede ser anterior a «Desde».';
  if (form.to.value && form.to.value < today) return `La fecha «Hasta» no puede ser anterior a hoy (${show(today)}).`;
  return null;
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

function validateForm() {
  syncDateLimits(); // the page may have been left open since yesterday
  let ok = true;
  for (const el of form.elements) {
    if (!el.name || el.type === 'checkbox') continue;
    const valid = el.checkValidity();
    el.classList.toggle('invalid', !valid);
    ok &&= valid;
  }
  const hasTargets = picker.value().length > 0;
  $('#picker-input').classList.toggle('invalid', !hasTargets);
  return ok && hasTargets;
}

// --- Request --------------------------------------------------------------

function show(section) {
  for (const id of ['empty', 'status', 'results']) $(`#${id}`).hidden = id !== section;
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}

async function submit(event) {
  event.preventDefault();
  if (!gachaData) return;
  if (!validateForm()) {
    showError(dateProblem() || (picker.value().length ? 'Revisa los campos marcados en rojo.' : 'Elige al menos un gato objetivo.'));
    return;
  }
  const body = readForm();
  $('#submit').disabled = true;
  $('#error').hidden = true;
  $('#progress').innerHTML = '<li>Calculando las tiradas de tu semilla y las rutas óptimas...</li>';
  show('status');
  // Let the page paint the progress before the (synchronous) calculation.
  await new Promise((resolve) => setTimeout(resolve, 30));
  let gotResult = false;
  try {
    const result = plan(body, gachaData);
    gotResult = true;
    current = { data: result, selected: result.routes.findIndex((r) => r.found) };
    render();
  } catch (err) {
    if (err instanceof UserError) showError(err.message);
    else {
      console.error(err);
      showError(
        `Error inesperado al calcular: ${err.message}. Si se repite, avísalo en el repositorio del proyecto (enlace al pie de la página) indicando tu semilla y los gatos elegidos.`
      );
    }
  } finally {
    $('#submit').disabled = false;
    show(gotResult ? 'results' : 'empty');
  }
}

// --- Rendering ------------------------------------------------------------

function render() {
  const { data } = current;
  $('#results').innerHTML = [
    renderContext(data),
    renderNotices(data),
    renderDiagnostics(data),
    data.routes.length ? renderRoutesTable(data) : '',
    renderDetail(data),
  ].join('');
  for (const tr of document.querySelectorAll('.routes tbody tr[data-i]')) {
    tr.addEventListener('click', () => {
      current.selected = Number(tr.dataset.i);
      render();
    });
  }
}

const withHour = (iso, hour) => `${iso}${hour ? ` ${hour}` : ''}`;

function renderContext(data) {
  const rows = data.events
    .map(
      (e) => `<tr>
        <td class="num">${esc(withHour(e.start, e.startTime))} – ${esc(withHour(e.end, e.endTime))}</td>
        <td>${esc(e.name)}</td>
        <td class="kind">${esc(KIND_LABEL[e.kind] || e.kind)}</td>
      </tr>`
    )
    .join('');
  const skipped = data.skipped
    .map((s) => `<tr><td></td><td class="muted">${esc(s.name)}</td><td class="kind">Excluido: ${esc(s.reason)}</td></tr>`)
    .join('');
  return `<div class="context">
    <h2>Semilla ${esc(data.seed)}</h2>
    <span>${data.rolls} tiros por pista · ${data.events.length} banners · coste total con 1 Rare Ticket = 150 Cat Food</span>
    <details>
      <summary>Banners analizados</summary>
      <table class="banners"><thead><tr><th>Fechas</th><th>Banner</th><th>Tipo</th></tr></thead>
      <tbody>${rows}${skipped}</tbody></table>
    </details>
    ${renderAllLegendCells(data)}
  </div>`;
}

const COLOR_DOT = { morada: 'legend', lila: 'legend-fest' };

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
  return `<details>
    <summary>Casillas de legendario en tus próximos ${data.rolls} tiros (${cells.length})</summary>
    <table class="banners"><thead><tr><th>Casilla</th><th>Legendario posible según los banners de tus fechas</th></tr></thead><tbody>${rows}</tbody></table>
  </details>`;
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
            return `<td><b>${esc(l.name)}</b></td>
              <td class="ev" title="${esc(l.eventName)}"><span class="ev-name">${esc(l.eventName)}</span>${ev ? `<small>hasta el ${esc(shortWithHour(ev.end, ev.endTime))}</small>` : ''}</td>
              <td><span class="fit ${l.sameRoute ? 'same' : 'change'}" title="${esc(why)}">${label}</span></td>
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
      (d) => `<article class="diag">
        <h4>${esc(d.headline)}</h4>
        ${d.target ? `<p class="diag-target">Afecta a: <b>${esc(d.target)}</b></p>` : ''}
        <ul>${d.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${d.fix ? `<p class="diag-fix"><span>Qué puedes hacer</span>${esc(d.fix)}</p>` : ''}
        ${
          d.links.length
            ? `<p class="diag-links"><span>Compruébalo en godfat:</span> ${d.links
                .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.label)}">${esc(l.label.split(' · ')[0])}</a>`)
                .join(' ')}</p>`
            : ''
        }
      </article>`
    )
    .join('');
  return `<section class="diagnostics">
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
    lines.push('Las casillas lilas no se protegen: desde tu fecha «Desde» no hay ningún banner anunciado con más probabilidad de legendario (Royalfest, doble legend...).');
  } else if (p.legendFest) {
    const banners = p.doubleLegendEvents.map((e) => `${esc(e.name)} (${shortDate(e.start)}–${shortDate(e.end)})`);
    lines.push(`Casillas lilas protegidas: dan legendario en ${banners.join('; ')}.`);
  }
  return lines.length ? `<div class="notice">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : '';
}

function renderRoutesTable(data) {
  const rows = data.routes
    .map((r, i) => {
      if (!r.found) {
        return `<tr><td><span class="name">${esc(r.label)}</span><span class="sub">${esc(r.reason)}</span></td><td colspan="7"></td></tr>`;
      }
      const t = r.totals;
      const got = r.targets.filter((x) => x.obtained).length;
      const requested = r.targets.length + (data.unplanned || []).length;
      const draws = t.multiDraws || t.guaranteedDraws ? `${t.multiDraws} + ${t.guaranteedDraws}` : '—';
      const note = r.sameAs
        ? `Misma ruta que «${esc(r.sameAs)}».`
        : r.sameCostAs
          ? `Mismo coste que «${esc(r.sameCostAs)}»: no hay alternativa mejor en este criterio.`
          : esc(r.description);
      return `<tr data-i="${i}" class="${i === current.selected ? 'selected' : ''}">
        <td><span class="name">${esc(r.label)}${r.recommended ? '<span class="tag">Recomendada</span>' : ''}</span>
          <span class="sub">${note}</span></td>
        <td class="r num ${got < requested ? 'bad' : ''}">${got}/${requested}</td>
        <td class="r num">${fmt(t.ticketsUsed)}</td>
        <td class="r num">${fmt(t.foodUsed)}</td>
        <td class="r num"><b>${fmt(t.totalCost)}</b></td>
        <td class="r num">${fmt(t.pulls)}</td>
        <td class="r num nowrap">${draws}</td>
        <td class="r">${t.affordable ? '<span class="ok">Sí</span>' : `<span class="bad">Faltan ${fmt(t.shortfall)}</span>`}</td>
      </tr>`;
    })
    .join('');
  return `<h3 class="section-title">Rutas</h3>
    <div class="table-wrap"><table class="routes">
      <thead><tr>
        <th>Ruta</th><th class="r">Objetivos</th><th class="r">Rare Tickets</th><th class="r">Cat Food</th>
        <th class="r">Coste total</th><th class="r">Tiros</th><th class="r" title="11-draws normales + garantizados (incluye step-up)">11-draws + gar.</th><th class="r">Con tu Cat Food</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderDetail(data) {
  const r = data.routes[current.selected];
  if (!r || !r.found) return '';
  const t = r.totals;
  const warnings = [
    !r.complete &&
      `No existe ninguna ruta que consiga todos los objetivos con estas fechas, protecciones y tiros. Esta consigue el máximo posible; el motivo de cada gato que falta está en «Por qué no se puede conseguir todo».`,
    r.exhausted && 'La búsqueda alcanzó su límite de tamaño: el resultado puede no ser el óptimo.',
    r.overBudget && `Ninguna ruta cabe en tu Cat Food actual: esta necesita ${fmt(t.shortfall)} más.`,
  ].filter(Boolean);
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

  const targets = r.targets
    .map((x) =>
      x.obtained
        ? `<li><span>${esc(x.names.join(' / '))}</span><span class="where">paso ${x.step}</span></li>`
        : `<li class="missing"><span>${esc(x.names.join(' / '))}</span><span class="where">ver motivo arriba</span></li>`
    )
    .concat((data.unplanned || []).map((name) => `<li class="missing"><span>${esc(name)}</span><span class="where">ver motivo arriba</span></li>`))
    .join('');

  return `<section class="detail">
    <div class="detail-head">
      <h3>${esc(r.label)}</h3>
      <p>${esc(r.description)}</p>
    </div>
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
      <tbody>${r.steps.map((s, i) => renderStep(s, data, r.steps[i - 1])).join('')}</tbody>
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

function renderStep(s, data, prev) {
  // The table as godfat draws it after the cat rolled just before this step.
  const last = prev ? prev.cats[prev.cats.length - 1].id : data.last;
  const untilRow = Math.max(Number.parseInt(s.from, 10), Number.parseInt(s.to, 10));
  const { url: link, shifted } = godfatLink({ seed: data.seed, eventId: s.eventId, key: s.from, untilRow, last });
  const ev = data.events.find((e) => e.id === s.eventId);
  const change = prev && prev.eventId !== s.eventId ? ' · <b>cambio de banner</b>' : '';
  const pay = [s.ticketsSpent && `${s.ticketsSpent} ticket${s.ticketsSpent > 1 ? 's' : ''}`, s.foodSpent && `${fmt(s.foodSpent)} CF`]
    .filter(Boolean)
    .join(' + ');
  const note = /descuento/.test(s.payment) ? '<small>con descuento</small>' : '';
  const jump = s.dupeSwitch ? '<span class="jump">cruce por duplicado</span>' : '';
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
    <td><div class="cats">${cats}</div></td>
  </tr>`;
}

// --- Theme ----------------------------------------------------------------
// The initial theme is set by the inline script in <head> (no flash).
const THEME_KEY = 'bc-seed-router-theme';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('#theme-label').textContent = dark ? 'Claro' : 'Oscuro';
}
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
applyTheme(document.documentElement.dataset.theme || 'light');

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
  const checked = status?.lastOk ? ` · comprobados con bc.godfat.org el ${showDate(status.lastOk)}` : '';
  $('#data-info').textContent = `Banners: datos de godfat${committed} (${commit})${checked}.`;
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
    showError(
      location.protocol === 'file:'
        ? 'Esta página no funciona abriendo el archivo HTML directamente. Usa la web publicada o arranca la app con «Iniciar TBC Seed Router.bat».'
        : `No se pudieron cargar los datos de los banners (${err.message}). Recarga la página; si se repite, avísalo en el repositorio del proyecto.`
    );
    $('#submit').disabled = true;
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

$('#forget-data').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(THEME_KEY);
  location.reload();
});

restoreForm();
loadData();
form.from.addEventListener('change', syncDateLimits);
form.to.addEventListener('change', syncDateLimits);
form.addEventListener('submit', submit);

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
