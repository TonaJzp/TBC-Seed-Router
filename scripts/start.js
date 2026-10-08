// `npm start`: updates the banner data when it is missing or older than
// 12 hours, then serves the site on this computer and opens the browser.
// Without internet it keeps using the data it already has.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data', 'gacha.json');
const MAX_AGE_MS = 12 * 3600_000;

const age = fs.existsSync(DATA) ? Date.now() - fs.statSync(DATA).mtimeMs : Infinity;
if (age > MAX_AGE_MS) {
  console.log(age === Infinity ? 'Primera vez: descargando los datos de los banners...' : 'Actualizando los datos de los banners...');
  const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js')], { stdio: 'inherit' });
  if (build.status !== 0) {
    if (!fs.existsSync(DATA)) {
      console.error('No se pudieron descargar los datos y no hay una copia anterior. Comprueba tu conexión a internet y vuelve a intentarlo.');
      process.exit(1);
    }
    console.warn('No se pudieron actualizar los datos; se usa la copia anterior.');
  }
}
spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'serve.js'), '--open'], { stdio: 'inherit' });
