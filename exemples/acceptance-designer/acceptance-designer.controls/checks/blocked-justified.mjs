// FM-17 — un arrêt « missing_artefact » n'est justifié que si les artefacts déclarés manquants n'existent pas.
export default async function check(ctx) {
  const m = /\{[\s\S]*\}/.exec(ctx.message || '');
  if (!m) return { ok: true }; // RECONCILIATION NEEDED : pas vérifiable mécaniquement
  let blocker;
  try { blocker = JSON.parse(m[0]); } catch { return { ok: false, details: 'blocker annoncé mais JSON illisible' }; }
  if (blocker.status !== 'blocked') return { ok: true };
  if (blocker.type !== 'missing_artefact') return { ok: true };
  const missing = blocker.context?.missing;
  if (!Array.isArray(missing) || !missing.length) return { ok: false, details: 'blocker missing_artefact sans liste context.missing' };
  const present = missing.filter((p) => typeof p === 'string' && !/[{*]/.test(p) && ctx.fs.exists(p));
  return present.length ? { ok: false, details: `artefact(s) déclaré(s) manquant(s) mais présent(s) : ${present.join(', ')}` } : { ok: true };
}
