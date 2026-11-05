// FM-15 et FM-31 — chaque matrice écrite porte sa ligne consistency-gate ; un gate non PASS exige un fichier de blocker,
// et un fichier de blocker exige un gate non PASS.
const MATRIX = /\/details\/[^/]+\/consistency-matrix-.+\.md$/;
const BLOCKER = /\/blockers\/[^/]+\/decision-drift-.+\.md$/;
export default async function check(ctx) {
  const changed = ctx.changed || [];
  const matrices = changed.filter((p) => MATRIX.test(p) && ctx.fs.exists(p));
  const blockers = changed.filter((p) => BLOCKER.test(p) && !p.endsWith('-resolution.md'));
  const problems = [];
  let failing = 0;
  for (const m of matrices) {
    const g = /consistency-gate\s*[:|]\s*\**\s*([A-Z_]+)/i.exec(ctx.fs.readText(m));
    if (!g) { problems.push(`${m} : ligne consistency-gate absente`); continue; }
    if (g[1].toUpperCase() !== 'PASS') failing += 1;
  }
  if (failing && !blockers.length) problems.push('matrice non PASS sans fichier de blocker decision-drift');
  if (blockers.length && matrices.length && !failing) problems.push(`blocker écrit (${blockers.join(', ')}) alors que toutes les matrices sont PASS`);
  return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
}
