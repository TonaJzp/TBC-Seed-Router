'use strict';

// The /legal page: legal notice (LSSI-CE art. 10), privacy policy (GDPR arts.
// 13-14), credits and licences of the data the app uses, and the optional
// support section. Rendered on the server from the site configuration so it
// is readable without JavaScript.

const UPDATED = '08/10/2026';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const mail = (email) => (email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '<em>(sin configurar)</em>');

function ownerRows(site) {
  const rows = [
    ['Titular', esc(site.ownerName)],
    site.ownerNif && ['NIF', esc(site.ownerNif)],
    site.ownerAddress && ['Domicilio', esc(site.ownerAddress)],
    ['Contacto', mail(site.contactEmail)],
  ].filter(Boolean);
  return `<dl class="owner">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function notice(site) {
  return `<section id="aviso">
  <h2>Aviso legal</h2>
  ${ownerRows(site)}
  <h3>Qué es esta web</h3>
  <p>${esc(site.name)} es una herramienta gratuita y <b>no oficial</b> que ayuda a planificar los tiros del gacha de
  The Battle Cats a partir de la semilla que tú mismo introduces. No tiene relación con el juego ni con tu cuenta:
  no se conecta al juego ni lo modifica, solo hace cálculos con datos públicos.</p>
  <h3>Sin relación con PONOS ni con las fuentes de datos</h3>
  <p>«The Battle Cats» y «PONOS» son marcas de PONOS Corporation. Esta web no está afiliada, patrocinada ni aprobada
  por PONOS Corporation, por bc.godfat.org ni por la Battle Cats Wiki.</p>
  <h3>Propiedad intelectual</h3>
  <p>El código y el diseño de esta web son de su titular. Los nombres de las unidades, sus imágenes y el resto de
  elementos del juego pertenecen a PONOS Corporation y se muestran solo para identificar cada gato. Los datos de
  terceros se usan según sus licencias (ver <a href="#creditos">Créditos y licencias</a>).</p>
  <h3>Responsabilidad</h3>
  <p>Los resultados son una estimación calculada con los datos que publica bc.godfat.org y pueden contener errores o
  quedar desfasados si el juego o los eventos cambian. Compruébalos en godfat (cada paso tiene su enlace) antes de
  gastar nada. El titular no responde de las decisiones que tomes en el juego ni de lo que gastes en él, ni garantiza
  que la web esté siempre disponible.</p>
  <h3>Uso razonable</h3>
  <p>Para no sobrecargar las webs de las que se leen los datos, el número de búsquedas por persona está limitado y no
  se permite usar esta web de forma automatizada o masiva.</p>
  <h3>Legislación</h3>
  <p>Este aviso se rige por la legislación española.</p>
</section>`;
}

function privacy(site) {
  const hosting = site.hosting
    ? `${esc(site.hosting)}, que actúa como encargado del tratamiento con un contrato conforme al art. 28 del RGPD`
    : 'el proveedor de alojamiento de la web, que actúa como encargado del tratamiento';
  return `<section id="privacidad">
  <h2>Política de privacidad</h2>
  <p><b>Responsable:</b> ${esc(site.ownerName)} · ${mail(site.contactEmail)}</p>
  <p>Esta web no usa cookies, ni analítica, ni publicidad, ni carga recursos de terceros: tu navegador solo se
  comunica con este servidor.</p>
  <h3>Qué datos se tratan y para qué</h3>
  <ul>
    <li><b>Lo que escribes en el formulario</b> (URL de tu semilla, gatos objetivo, fechas e inventario). Se envía al
    servidor solo cuando pulsas «Calcular rutas», para hacer el cálculo. A bc.godfat.org solo se le pide el número de
    semilla y los banners. Los resultados se guardan en la memoria del servidor un máximo de 30 minutos para no repetir
    consultas, sin asociarlos a ti, y nunca se escriben en disco.</li>
    <li><b>Tu dirección IP.</b> El servidor la usa, solo en memoria, para limitar cuántas búsquedas puede hacer cada
    persona, y la olvida en cuanto termina ese periodo (minutos). El proveedor de alojamiento puede conservarla en sus
    registros técnicos por seguridad durante el tiempo que fije su política.</li>
    <li><b>Almacenamiento local de tu navegador</b> (<i>localStorage</i>). Guarda el último formulario y el tema claro u
    oscuro para que no tengas que repetirlos. Se queda en tu navegador: al servidor solo llega lo que envías al pulsar
    «Calcular rutas». Como es necesario
    para la función que pides, no requiere consentimiento (art. 22.2 LSSI-CE). Puedes borrarlo con el botón
    «Borrar los datos guardados en este navegador» de la página principal.</li>
  </ul>
  <h3>Base jurídica</h3>
  <p>Prestarte el servicio que solicitas (art. 6.1.b RGPD) y el interés legítimo en proteger la web y las fuentes de
  datos frente a abusos (art. 6.1.f RGPD).</p>
  <h3>Con quién se comparten</h3>
  <p>Con ${hosting}.${site.donationsEnabled ? ` Si haces una aportación voluntaria, la gestiona ${esc(site.donatePlatform)} como responsable independiente según su propia política de privacidad; aquí solo se recibe lo que esa plataforma comunique (por ejemplo, nombre, email e importe) y se conserva lo que exija la normativa fiscal.` : ''}
  No se venden ni se ceden datos a nadie más.</p>
  <h3>Tus derechos</h3>
  <p>Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo
  a ${mail(site.contactEmail)}. Ten en cuenta que la web no guarda datos que permitan identificarte. Si crees que no
  se han respetado, puedes reclamar ante la Agencia Española de Protección de Datos
  (${ext('https://www.aepd.es', 'www.aepd.es')}).</p>
</section>`;
}

function credits() {
  return `<section id="creditos">
  <h2>Créditos y licencias</h2>
  <h3>bc.godfat.org</h3>
  <p>Las tablas de tiros de cada semilla vienen de ${ext('https://bc.godfat.org/', 'Battle Cats Rolls')}, creado por
  Lin Jen-Shin (godfat), cuyo ${ext('https://gitlab.com/godfat/battle-cats-rolls', 'código')} es libre (licencia
  Apache 2.0). Esta web lee las páginas públicas que godfat genera para tu semilla, no copia su código, y enlaza a
  godfat en cada paso para que puedas comprobarlo. La herramienta original es suya.</p>
  <h3>Battle Cats Wiki</h3>
  <p>La lista de gatos (nombres, rarezas y nombres alternativos) procede de la
  ${ext('https://battlecats.miraheze.org/', 'Battle Cats Wiki')} en Miraheze, cuyos textos se publican bajo
  ${ext('https://creativecommons.org/licenses/by-sa/4.0/deed.es', 'CC BY-SA 4.0')}. Esta web la adapta (quita las
  unidades exclusivas de Japón y añade el identificador de godfat) y publica la lista adaptada bajo la misma licencia
  en <a href="/api/cats">/api/cats</a> (JSON).</p>
  <h3>Imágenes y elementos del juego</h3>
  <p>The Battle Cats y las imágenes de sus unidades © PONOS Corporation. Las imágenes se obtienen a través de la
  Battle Cats Wiki y se sirven desde este servidor.</p>
</section>`;
}

function support(site) {
  if (!site.donationsEnabled) return '';
  return `<section id="apoyo">
  <h2>Apoyar el proyecto</h2>
  <p>${esc(site.name)} es y seguirá siendo gratuita. Si te resulta útil, puedes dejar una propina voluntaria para
  ayudar a pagar el servidor y el tiempo de desarrollo.</p>
  <ul>
    <li>No es una compra: no desbloquea funciones ni da ninguna ventaja.</li>
    <li>Es para el desarrollo de esta herramienta. PONOS, godfat y la Battle Cats Wiki no tienen relación con ella ni
    reciben nada.</li>
    <li>El pago se hace en ${esc(site.donatePlatform)}; esta web nunca ve los datos de tu tarjeta.</li>
    <li>Si te equivocas de importe, escribe a ${mail(site.contactEmail)}.</li>
  </ul>
  <p>${ext(site.donateUrl, 'Dejar una propina')}</p>
</section>`;
}

function renderLegal(site) {
  const nav = [
    ['aviso', 'Aviso legal'],
    ['privacidad', 'Privacidad'],
    ['creditos', 'Créditos y licencias'],
    site.donationsEnabled && ['apoyo', 'Apoyar el proyecto'],
  ].filter(Boolean);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Información legal · ${esc(site.name)}</title>
  <script src="/theme-init.js"></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="doc">
  <header class="doc-head">
    <a href="/">Volver a la app</a>
    <nav>${nav.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav>
  </header>
  <main class="doc-body">
    <h1>Información legal</h1>
    <p class="updated">Última actualización: ${UPDATED}</p>
    ${notice(site)}
    ${privacy(site)}
    ${credits()}
    ${support(site)}
  </main>
</body>
</html>
`;
}

module.exports = { renderLegal };
