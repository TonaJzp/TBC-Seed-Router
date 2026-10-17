// Before publishing, marks every script and style of the site with the
// version (the commit): `./core/planner.js` becomes `./core/planner.js?v=…`.
// GitHub Pages lets browsers keep each file for 10 minutes, so right after a
// deploy a visitor could otherwise mix new and old modules. Only the copy
// that is published is changed (in CI); the code in the repository and the
// local app stay as they are.
//
//   node scripts/stamp-version.js <version> [dir=public]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// A relative module in an import or export (`from './x.js'`, a bare
// `import './x.js'`), or a module URL built from it (`new URL('./x.js', …)`).
const JS_REFS = /(\bfrom\s*|\bimport\s*|\bnew URL\(\s*)(['"])(\.\.?\/[^'"?#\s]+\.js)\2/g;
// A local script or style of a page: src="app.js", href="style.css".
const HTML_REFS = /(\b(?:src|href)=)(["'])((?!\w+:|\/|#)[^"'?#\s]+\.(?:js|css))\2/g;
const VERSION = /^[\w.-]+$/;

function stampJs(code, version) {
  return code.replace(JS_REFS, (_, lead, q, spec) => `${lead}${q}${spec}?v=${version}${q}`);
}

function stampHtml(html, version) {
  return html.replace(HTML_REFS, (_, lead, q, spec) => `${lead}${q}${spec}?v=${version}${q}`);
}

/** Stamps every .js and .html file under `dir` (the data folder apart); returns the files changed. */
function stampDir(dir, version) {
  if (!VERSION.test(version || '')) throw new Error(`Versión no válida: «${version}»`);
  const changed = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'data') walk(file);
        continue;
      }
      const stamp = file.endsWith('.js') ? stampJs : file.endsWith('.html') ? stampHtml : null;
      if (!stamp) continue;
      const before = fs.readFileSync(file, 'utf8');
      const after = stamp(before, version);
      if (after !== before) {
        fs.writeFileSync(file, after);
        changed.push(path.relative(dir, file).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return changed.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')] = process.argv.slice(2);
  const changed = stampDir(dir, version);
  console.log(`Versión ${version} en ${changed.length} archivos: ${changed.join(', ')}`);
}

export { stampJs, stampHtml, stampDir };
