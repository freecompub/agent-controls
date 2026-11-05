// FM-14 et FM-15 — un arrêt bloqué est justifié :
//  - missing_artefact : rien n'a été écrit, et les artefacts déclarés manquants n'existent pas ;
//  - decision_drift : un fichier de blocker a été écrit pendant ce run, ou un blocker non résolu existait déjà (réémission).
const BLOCKER = /\/blockers\/[^/]+\/decision-drift-.+\.md$/;
export default async function check(ctx) {
  const msg = ctx.message || '';
  const changed = ctx.changed || [];
  if (/decision_drift/.test(msg)) {
    if (changed.some((p) => BLOCKER.test(p) && !p.endsWith('-resolution.md'))) return { ok: true };
    const before = ctx.baseline?.list() || [];
    const open = before.filter((p) => BLOCKER.test(p) && !p.endsWith('-resolution.md') && !before.includes(p.replace(/\.md$/, '-resolution.md')));
    if (open.length && !changed.length) return { ok: true }; // réémission d'un blocker en attente
    return { ok: false, details: 'blocker decision_drift annoncé sans fichier de blocker écrit ni blocker en attente' };
  }
  const m = /\{[\s\S]*\}/.exec(msg);
  let blocker = null;
  try { blocker = m ? JSON.parse(m[0]) : null; } catch { return { ok: false, details: 'blocker annoncé mais JSON illisible' }; }
  if (blocker?.type !== 'missing_artefact') return { ok: true };
  if (changed.length) return { ok: false, details: `arrêt missing_artefact après avoir écrit : ${changed.slice(0, 5).join(', ')}` };
  const missing = blocker.context?.missing;
  if (!Array.isArray(missing) || !missing.length) return { ok: false, details: 'blocker missing_artefact sans liste context.missing' };
  const present = missing.filter((p) => typeof p === 'string' && !/[{*]/.test(p) && ctx.fs.exists(p));
  return present.length ? { ok: false, details: `artefact(s) déclaré(s) manquant(s) mais présent(s) : ${present.join(', ')}` } : { ok: true };
}
