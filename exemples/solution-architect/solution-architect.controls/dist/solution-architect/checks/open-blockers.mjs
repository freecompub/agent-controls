// FM-13 — un blocker sans résolution au début du run interdit toute production : l'agent doit le réémettre et s'arrêter.
const BLOCKER = /\/blockers\/[^/]+\/decision-drift-.+\.md$/;
export default async function check(ctx) {
  const before = ctx.baseline?.list() || [];
  const open = before.filter((p) => BLOCKER.test(p) && !p.endsWith('-resolution.md') && !before.includes(p.replace(/\.md$/, '-resolution.md')));
  if (!open.length) return { ok: true };
  const produced = (ctx.changed || []).filter((p) => !BLOCKER.test(p));
  return produced.length
    ? { ok: false, details: `blocker(s) sans résolution : ${open.join(', ')} — rien ne devait être produit, or : ${produced.slice(0, 5).join(', ')}` }
    : { ok: true };
}
