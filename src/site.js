'use strict';

// Public identity of the deployed site: who runs it, how to reach them, where
// it is hosted and the optional support link. Everything comes from
// environment variables so the same code runs locally and in production (see
// "Publicar la app" in the README). The legal pages and the User-Agent sent to
// godfat and Miraheze are built from this.

const NAME = 'TBC Seed Router';
const VERSION = '1.0';

const clean = (v) => String(v ?? '').trim();
const httpsUrl = (v) => {
  try {
    const url = new URL(clean(v));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
};

function loadSite(env = process.env) {
  const site = {
    name: NAME,
    production: env.NODE_ENV === 'production',
    url: httpsUrl(env.SITE_URL).replace(/\/+$/, ''),
    ownerName: clean(env.OWNER_NAME) || 'TonaJzp',
    contactEmail: clean(env.CONTACT_EMAIL),
    // Only needed (and only shown) once the site takes support payments.
    ownerNif: clean(env.OWNER_NIF),
    ownerAddress: clean(env.OWNER_ADDRESS),
    // e.g. "Koyeb SAS (Francia), servidores en Fráncfort (Alemania)"
    hosting: clean(env.HOSTING_PROVIDER),
    donateUrl: httpsUrl(env.DONATE_URL),
    donatePlatform: clean(env.DONATE_PLATFORM) || 'la plataforma de pago',
    // Kill switch, e.g. if godfat asks to stop: the app stays up but stops reading it.
    godfatEnabled: clean(env.GODFAT_ENABLED).toLowerCase() !== 'false',
  };
  // Taking money makes the site an economic activity: the legal notice must
  // then identify the owner fully, so the support link stays hidden until it can.
  site.donationsEnabled = Boolean(site.donateUrl && site.contactEmail && site.ownerNif && site.ownerAddress);
  // Identifies the app to the sites it reads, with a way to reach its owner.
  const contact = [site.url && `+${site.url}`, site.contactEmail].filter(Boolean).join('; ');
  site.userAgent = `TBCSeedRouter/${VERSION} (${contact || 'local'})`;
  return site;
}

/** Configuration problems: `errors` stop a production start, `warnings` don't. */
function siteProblems(site) {
  const errors = [];
  const warnings = [];
  if (site.production) {
    if (!site.contactEmail) errors.push('Falta CONTACT_EMAIL (email público de contacto).');
    if (!site.url) errors.push('Falta SITE_URL (dirección pública https:// de la web).');
    if (!site.hosting) warnings.push('Falta HOSTING_PROVIDER: la política de privacidad no dirá quién aloja la web.');
  }
  if (site.donateUrl && !site.donationsEnabled) {
    warnings.push('DONATE_URL está definido pero el enlace de apoyo queda oculto: faltan CONTACT_EMAIL, OWNER_NIF u OWNER_ADDRESS.');
  }
  return { errors, warnings };
}

module.exports = { loadSite, siteProblems, site: loadSite() };
