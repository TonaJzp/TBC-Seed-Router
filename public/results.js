// The results of an analysis as HTML: the summary, the reasons something is
// missing, the table of routes and the detail of the selected one. Pure: it
// reads the result of plan() and returns markup; app.js puts it on the page
// and wires its buttons. Every text from the data goes through esc().

import { godfatLink } from './core/godfat-link.js';
import { BASE, LEGEND_FEST_SCORE } from './core/gacha.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Number(n).toLocaleString('es-ES');

const KIND_LABEL = {
  standard: 'Simples y 11-draw',
  guaranteed: 'Garantizado 11',
  stepup: 'Step-up 3+5+7',
};
const ACTION_LABEL = {
  single: (s) => (s.count > 1 ? `${s.count} tiros simples` : 'Tiro simple'),
  multi: () => '11-draw',
  guaranteed: () => '11-draw garantizado',
  stepup1: (s) =>
    s.count > 1
      ? `<span title="El paso 1 del step-up (3 tiros por 300 Cat Food), ${s.count} veces">Step-up: paso 1 × ${s.count}</span>`
      : '<span title="Solo el paso 1 del step-up: 3 tiros por 300 Cat Food">Step-up: paso 1</span>',
  stepup12: () => '<span title="Pasos 1 y 2 del step-up: 8 tiros por 1050 Cat Food">Step-up: pasos 1 y 2</span>',
  stepup: () => '<span title="Los 3 pasos del step-up: 15 tiros, el último un uber garantizado, por 2100 Cat Food">Step-up completo</span>',
};

// What the page shows besides the result: the selected route (an index of
// data.routes) and whether a cat is already a target (for its button).
let view = { selected: 0, isSelected: () => false };

/** The HTML of the results of `data` (plan()), with route `selected` in detail. */
export function renderResults(data, { selected, isSelected }) {
  view = { selected, isSelected };
  return [
    renderUnproven(data),
    data.routes.some((r) => r.found) ? renderSupport() : '', // only when it has just been useful
    renderContext(data),
    renderDiagnostics(data),
    data.routes.some((r) => r.found) ? renderRoutesTable(data) : '', // none: the diagnostics explain why
    renderDetail(data),
  ].join('');
}

// A route found when the search reached its safety limit is the best one it
// saw, not one proven the best: said on top, before anything else.
function renderUnproven(data) {
  const cut = data.routes.filter((r) => r.found && r.exhausted);
  if (!cut.length) return '';
  const names = cut.map((r) => `«${esc(r.label)}»`).join(', ');
  const which = cut.some((r) => r.recommended)
    ? cut.length > 1 ? `la ruta recomendada y otras (${names})` : 'la ruta recomendada'
    : `${cut.length > 1 ? 'las rutas' : 'la ruta'} ${names}`;
  return `<section class="notice alert unproven" role="note">
    <b>Ruta no garantizada como la mejor</b>
    <p>El análisis era tan grande que llegó al límite de seguridad del cálculo, que evita que la página se
      quede sin memoria. Afecta a ${which}: es la mejor que encontró, pero puede existir otra mejor.</p>
    <p>Para obtener una ruta garantizada, quita algunos ubers o legendarios, o revisa menos tiros.</p>
  </section>`;
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
      <p class="summary-facts">${data.start ? `Empiezas en <b>${esc(data.start)}</b> · ` : ''}<b>${fmt(data.rolls)}</b> tiros por pista · <b>${data.events.length}</b> banners · 1 Rare Ticket = <b>150</b> Cat Food</p>
    </header>
    ${(data.notices || []).map((n) => `<div class="notice"><p>${esc(n)}</p></div>`).join('')}
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
  target: ['Cambia la ruta', 'Ahí la ruta saca uno de tus objetivos, y no lo saca en ningún otro paso: tirarla en este banner lo perdería. Añádelo a tus objetivos y la ruta se recalcula.'],
};

/** "Add to targets" button, or a tag if it already is one. */
const addTargetButton = (name) =>
  view.isSelected(name)
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
          const [label, why] = FIT[l.sameRoute ? 'same' : c.inDraw ? 'draw' : l.losesTarget ? 'target' : 'next'];
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

// A cut search proves nothing is impossible: the title does not say it is.
// With no route at all, any cut search may be why there is none.
function diagnosticsTitle(data) {
  const recommended = data.routes.find((r) => r.recommended);
  if (!recommended) return data.routes.some((r) => r.exhausted) ? 'Por qué no se ha encontrado ninguna ruta' : 'Por qué no se puede conseguir todo';
  return recommended.exhausted ? 'Por qué la ruta no lo consigue todo' : 'Por qué no se puede conseguir todo';
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
    <h3 class="section-title">${diagnosticsTitle(data)}</h3>
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
  }
  // Banners with an even higher legend rate (over 0.6 %) give Legendaries on
  // cells godfat paints as uber: they are lilac here.
  const higher = p.doubleLegendEvents.filter((e) => e.legendFrom < LEGEND_FEST_SCORE);
  const rate = (e) => `${((BASE - e.legendFrom) / 100).toLocaleString('es-ES')} % de legendario`;
  const higherNote = 'también dan legendario algunas casillas que godfat pinta como uber; aquí cuentan como lilas.';
  if (p.legendFest) {
    const banners = p.doubleLegendEvents.map(
      (e) => `«${esc(e.name)}» (${shortDate(e.start)}–${shortDate(e.end)}${e.legendFrom < LEGEND_FEST_SCORE ? `; ${rate(e)}` : ''})`
    );
    lines.push(`<b>Casillas lilas protegidas.</b> Dan legendario en ${banners.join('; ')}.`);
    if (higher.length) lines.push(`Con más del 0,6 % de legendario, ${higherNote}`);
  } else if (higher.length) {
    lines.push(`En ${higher.map((e) => `«${esc(e.name)}» (${rate(e)})`).join('; ')} ${higherNote}`);
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
      const parts = t.stepUpParts || 0;
      const draws = t.multiDraws + g + parts
        ? `${t.multiDraws + g + parts}${g ? `<span class="sub">${g} garantizado${g > 1 ? 's' : ''}</span>` : ''}${
            parts ? `<span class="sub">${parts} step-up a medias</span>` : ''
          }`
        : '—';
      const note = r.sameAs
        ? `Misma ruta que ${routeName(data, r.sameAs)}.`
        : r.sameCostAs
          ? `Mismo coste que ${routeName(data, r.sameCostAs)}${r.exhausted ? '.' : ': no hay alternativa mejor en este criterio.'}`
          : esc(r.description);
      return `<tr data-i="${i}" class="${i === view.selected ? 'selected' : ''}">
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
  const shown = data.routes[view.selected];
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
        <th class="r" title="Cuántos 11-draws o step-ups hace la ruta. Debajo, cuántos son garantizados (o step-up completos) y cuántos step-up se quedan en el paso 1 o 2.">11-draws</th>
        <th class="r" title="Si la Cat Food que tienes basta para hacer la ruta entera; si no, cuánta te falta.">¿Te alcanza?</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${shownNote}
    ${shortNote}`;
}

function renderDetail(data) {
  const r = data.routes[view.selected];
  if (!r || !r.found) return '';
  const t = r.totals;
  // Only a search that ran to the end proves no route gets every target.
  const whole = data.routes.find((x) => x.found && x.complete);
  const warnings = [
    r.complete
      ? r.exhausted && 'La búsqueda alcanzó su límite de tamaño: el resultado puede no ser el óptimo.'
      : !r.exhausted
        ? `No existe ninguna ruta que consiga todos los objetivos con estas fechas, protecciones y tiros. Esta consigue el máximo posible; el motivo de cada gato que falta está en «${diagnosticsTitle(data)}».`
        : whole
          ? `La búsqueda de esta ruta llegó a su límite de tamaño antes de conseguir todos los objetivos. «${esc(whole.label)}» sí los consigue todos.`
          : `La búsqueda llegó a su límite de tamaño antes de encontrar una ruta que consiga todos los objetivos: no está demostrado que no exista. Esta es la que más consigue de las que encontró; lo que se sabe de cada gato que falta está en «${diagnosticsTitle(data)}».`,
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
    ['Primer tiro simple a 30', r.discounts.single],
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
  // Without explanations (the recommended route gets them all) there is nothing to link to.
  const missing = (name) => {
    const id = reasons.get(name) || (data.diagnostics?.length ? 'diagnostics' : null);
    return `<li class="missing"><span>${esc(name)}</span>${
      id ? `<a class="where why-link" href="#${id}">Ver motivo <span aria-hidden="true">↑</span></a>` : ''
    }</li>`;
  };
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
  const gotOf = (x) => x.targets.filter((y) => y.obtained).length;
  const why =
    r.recommendedFor === 'leastFood' && cheapest?.found
      ? `<p class="why">Se recomienda esta porque no tienes Cat Food suficiente para ninguna ruta y es la que menos te pide: gasta primero tus Rare Tickets. «${esc(cheapest.label)}» gasta menos en total porque prefiere 11-draws (más baratos por tiro), pero te pediría ${fmt(cheapest.totals.shortfall)} de Cat Food más.</p>`
      : r.recommendedFor === 'mostTargets' && cheapest?.found
        ? `<p class="why">Se recomienda esta porque consigue más objetivos (${gotOf(r)} de ${r.targets.length + (data.unplanned || []).length}) que «${esc(cheapest.label)}» (${gotOf(cheapest)})${
          cheapest.exhausted ? ', cuya búsqueda llegó a su límite de tamaño antes de terminar' : ''
        }.</p>`
        : '';

  return `<section class="detail">
    <div class="detail-head">
      <h3>${esc(r.label)}${r.recommended ? '<span class="tag">Recomendada</span>' : ''}</h3>
      <p>${esc(r.description)}</p>
      ${why}
    </div>
    ${budget}
    ${renderUpcoming(r)}
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

function linkTitle(s, shifted) {
  if (!shifted) return 'Ver esta tabla en godfat';
  const why = s.godfatFromLast ? ', con tu último gato, para que la primera tirada salga como en la ruta' : '';
  return `Ver en godfat: la tabla empieza en ${esc(s.from)}, que allí aparece como 1A${why}`;
}

/**
 * Banners the route rolls before they open. An update before then can add
 * cats to them, which changes the cells of those cats' rarity (and, for a
 * rare, its duplicates and the rest of the route): recalculate when they open.
 */
function renderUpcoming(r) {
  if (!r.upcoming?.length) return '';
  const one = r.upcoming.length === 1;
  const items = r.upcoming
    .map((u) => `<li>Desde el paso ${u.step}: <span class="banner-name">«${esc(u.eventName)}»</span>, empieza el ${esc(shortWithHour(u.start, u.startTime))}.</li>`)
    .join('');
  return `<div class="notice upcoming" role="note">
      <b>${one ? 'Parte de esta ruta es en un banner que aún no ha empezado' : 'Parte de esta ruta es en banners que aún no han empezado'}</b>
      <ul>${items}</ul>
      <p>Si antes llega una actualización del juego que ${one ? 'le' : 'les'} añade gatos nuevos (casi siempre ubers), cambian las casillas de la rareza de esos gatos y la ruta puede cambiar desde ese paso. Cuando empiece, vuelve a calcular con tu semilla actualizada antes de tirar en ${one ? 'él' : 'cada uno'}.</p>
    </div>`;
}

function renderStep(s, data, prev, lastHit = Infinity) {
  // The table as godfat draws it after the cat rolled just before this step.
  const last = prev ? prev.cats[prev.cats.length - 1].id : data.last;
  const untilRow = Math.max(Number.parseInt(s.from, 10), Number.parseInt(s.to, 10));
  const { url: link, shifted } = godfatLink({ seed: data.seed, eventId: s.eventId, key: s.from, untilRow, last, fromLast: s.godfatFromLast });
  const ev = data.events.find((e) => e.id === s.eventId);
  const change = prev && prev.eventId !== s.eventId ? ' · <b>cambio de banner</b>' : '';
  const pay = [s.ticketsSpent && `${s.ticketsSpent} ticket${s.ticketsSpent > 1 ? 's' : ''}`, s.foodSpent && `${fmt(s.foodSpent)} CF`]
    .filter(Boolean)
    .join(' + ');
  const discounted = s.discount;
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
    <td class="num day"><span class="nowrap">${esc(shortDate(s.date))}</span>${s.opensAt ? `<small>desde las ${esc(s.opensAt)}</small>` : ''}${
      s.stepUpFrom ? `<small title="El step-up vuelve al paso 1 30 minutos después de comprar el paso 1">desde las ${esc(s.stepUpFrom)} (vuelve al paso 1)</small>` : ''
    }${
      s.count > 1 && s.type === 'stepup1'
        ? `<small title="Tras cada paso 1, el step-up tarda 30 minutos en volver al paso 1">uno cada 30 min (el último, ${esc(s.untilTime)})</small>`
        : ''
    }${s.closesAt ? closingNote(s, ev) : ''}</td>
    <td class="banner"><a href="${esc(link)}" target="_blank" rel="noopener" title="${linkTitle(s, shifted)}">${esc(s.eventName)}</a>
      ${ev ? `<span class="active-range">Activo del ${esc(shortWithHour(ev.start, ev.startTime))} al ${esc(shortWithHour(ev.end, ev.endTime))}</span>` : ''}${change ? `<small>${change.replace(/^ · /, '')}</small>` : ''}${s.upcoming ? '<small class="upcoming" title="Si una actualización le añade gatos antes de que empiece, este paso puede cambiar: vuelve a calcular cuando empiece">Aún no ha empezado</small>' : ''}</td>
    <td class="action">${ACTION_LABEL[s.type](s)}${note}</td>
    <td class="pos">${esc(s.from)} → ${esc(s.to)}${jump}</td>
    <td class="r pay num">${pay || '0'}</td>
    <td class="cats-cell">${gotLine}<div class="cats">${cats}</div></td>
  </tr>`;
}
