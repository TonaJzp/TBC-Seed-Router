// Turns the daily run into a notification for the owner: if anything failed or
// does not match godfat, it opens a GitHub issue labelled "vigilancia" (GitHub
// emails the owner), comments on it when the problem changes, and closes it
// when everything is fine again. Exit code 1 when there is something to look
// at, so the run is also marked as failed.
//
// Environment (set by the workflow): GITHUB_TOKEN, GITHUB_REPOSITORY,
// RUN_URL, TESTS_OUTCOME (lint and tests), BUILD_OUTCOME, DEPLOY_OUTCOME, and OPTIMALITY_OUTCOME,
// OPTIMALITY_SEED, OPTIMALITY_CASES (the daily exploration of optimal routes).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'vigilancia';
const TITLE = 'Vigilancia: hay algo que revisar';
// godfat being down for a while is not our problem; for longer it is.
const UNVERIFIED_DAYS = 3;
// godfat's page can list a new banner before its open data has it (hours, on
// 2026-10-16). Pending for this many calendar days, or starting tomorrow at
// the latest, it is no longer a delay. Days, not hours: the daily run can
// start hours late.
const PENDING_DAYS = 2;
const MAX_LISTED = 10;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch {
    return null;
  }
};

/** Problems found by this run, as markdown sections (empty if all is well). */
function findProblems(env, build, verify, now = new Date()) {
  const problems = [];
  if (env.TESTS_OUTCOME && env.TESTS_OUTCOME !== 'success') {
    problems.push('### Han fallado los tests, el lint o la instalación\nNo se ha publicado nada: la web sigue con la versión anterior. Mira el registro de la ejecución.');
    return problems;
  }
  if (env.BUILD_OUTCOME !== 'success' || !build?.ok) {
    problems.push(
      '### No se han podido actualizar los datos\n' +
        'La web sigue publicada con los datos anteriores.\n\n' +
        (build?.errors?.length ? build.errors.map((e) => `- ${e}`).join('\n') : '- El paso de construcción falló; mira el registro de la ejecución.')
    );
  }
  if (build?.warnings?.length) {
    problems.push('### Avisos en los datos\n' + build.warnings.map((w) => `- ${w}`).join('\n'));
  }
  if (build?.iconsMissing?.length) {
    const list = build.iconsMissing.slice(0, MAX_LISTED).map((c) => `- ${c.name} (${c.id}): ${c.reason}`);
    if (build.iconsMissing.length > MAX_LISTED) list.push(`- y ${build.iconsMissing.length - MAX_LISTED} más`);
    problems.push(
      `### Faltan iconos\n${build.iconsMissing.length} gatos de los banners salen en la web sin imagen. ` +
        'El cálculo no se ve afectado.\n\n' +
        list.join('\n')
    );
  }
  if (env.OPTIMALITY_OUTCOME === 'failure') {
    problems.push(
      '### Una ruta no es la más barata\n' +
        'La exploración diaria compara las rutas con una búsqueda exhaustiva en casos nuevos cada día, y en alguno la app ' +
        'mostró una ruta más cara que la mejor posible (o el test no pudo terminar). La exploración no frena la ' +
        'publicación. El registro de la ejecución da el caso con todos sus valores y el criterio: una vez corregido, ' +
        'añádelo a HARD_CASES en test/optimality.test.js para que no vuelva a pasar. Para repetirlo:\n\n' +
        `\`OPTIMALITY_SEED=${env.OPTIMALITY_SEED} OPTIMALITY_CASES=${env.OPTIMALITY_CASES || 400} node --test test/optimality.test.js\``
    );
  }
  if (env.DEPLOY_OUTCOME && env.DEPLOY_OUTCOME !== 'success' && env.BUILD_OUTCOME === 'success') {
    problems.push(
      '### No se ha podido publicar la web\n' +
        'El despliegue en GitHub Pages falló o no llegó a hacerse. Comprueba que el repositorio es público y que en ' +
        '*Settings → Pages* la fuente es *GitHub Actions*; si es así, mira el registro de la ejecución.'
    );
  }
  if (verify?.result === 'mismatch') {
    const lines = verify.differences.map((d) => `- **${d.kind}** (${d.count})\n${d.examples.map((e) => `  - ${e}`).join('\n')}`);
    problems.push(
      `### La app no coincide con bc.godfat.org\n` +
        `Semilla ${verify.seed}, ${verify.banners} banners, ${verify.rolls} tiros. La web muestra un aviso a los usuarios hasta que vuelva a coincidir.\n\n` +
        lines.join('\n')
    );
  }
  const overdue = overduePending(verify?.pending, now);
  if (overdue.length) {
    problems.push(
      '### Faltan banners que godfat ya muestra\n' +
        'bc.godfat.org los muestra, pero los datos abiertos de godfat no los tienen y la web no puede planificarlos. ' +
        'Suele ser un retraso de unas horas; esto ya no lo es. Mira si godfat ha dejado de actualizar sus datos o si la web los descarta.\n\n' +
        overdue.map((p) => `- ${p.id} «${p.name}»: empieza el ${p.start}, pendiente desde el ${p.since}`).join('\n')
    );
  }
  if (verify?.result === 'unreachable' || (!verify && env.BUILD_OUTCOME === 'success')) {
    const lastOk = verify?.lastOk ? new Date(verify.lastOk) : null;
    if (!lastOk || now - lastOk > UNVERIFIED_DAYS * 86_400_000) {
      problems.push(
        `### No se puede comprobar contra bc.godfat.org\n` +
          `Última comprobación correcta: ${lastOk ? lastOk.toISOString().slice(0, 10) : 'ninguna'}.\n\n- ${verify?.error || 'La comprobación no llegó a ejecutarse.'}`
      );
    }
  }
  return problems;
}

/** Pending banners (verify-godfat) that need the owner: too long pending, or starting by tomorrow. */
function overduePending(pending, now) {
  const today = now.toISOString().slice(0, 10);
  const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  return (pending || []).filter((p) => day(today) - day(p.since) >= PENDING_DAYS || day(p.start) <= day(today) + 1);
}

async function github(env, method, endpoint, body) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 422) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const env = process.env;
  const build = readJson('.cache/build-report.json');
  const verify = readJson('.cache/verify-report.json');
  const problems = findProblems(env, build, verify);
  const runLink = env.RUN_URL ? `\n\n[Ver la ejecución](${env.RUN_URL})` : '';

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
    console.log(problems.length ? problems.join('\n\n') : 'Todo en orden.');
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  const [open] = await github(env, 'GET', `/issues?labels=${LABEL}&state=open&per_page=1`);
  if (problems.length) {
    const report = problems.join('\n\n');
    if (!open) {
      await github(env, 'POST', '/labels', { name: LABEL, color: 'b60205', description: 'Avisos automáticos de la comprobación diaria' });
      await github(env, 'POST', '/issues', { title: TITLE, labels: [LABEL], body: `${report}${runLink}` });
    } else {
      // Only write again when the problem changes, not every day.
      const comments = await github(env, 'GET', `/issues/${open.number}/comments?per_page=100`);
      const latest = comments.length ? comments.at(-1).body : open.body;
      if (!latest.startsWith(report)) await github(env, 'POST', `/issues/${open.number}/comments`, { body: `${report}${runLink}` });
    }
    console.log(report);
    process.exitCode = 1;
  } else {
    if (open) {
      await github(env, 'POST', `/issues/${open.number}/comments`, { body: `Todo vuelve a estar en orden.${runLink}` });
      await github(env, 'PATCH', `/issues/${open.number}`, { state: 'closed' });
    }
    console.log('Todo en orden.');
  }
}

export { findProblems };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
