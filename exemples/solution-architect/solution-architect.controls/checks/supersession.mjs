// FM-29 — une supersession est enregistrée aux deux endroits, et le plan de supersession est réalisé.
const ADR_FILE = /^docs\/adr\/adr-(\d{3})-.+\.md$/;
const REGISTRY = 'docs/adr/supersessions.md';
export default async function check(ctx) {
  const changed = ctx.changed || [];
  const problems = [];
  const registry = ctx.fs.exists(REGISTRY) ? ctx.fs.readText(REGISTRY) : '';
  const before = ctx.baseline?.read(REGISTRY) || '';
  const addedRows = registry.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l) && !before.includes(l));
  const newAdrs = changed.filter((p) => ADR_FILE.test(p) && !ctx.baseline?.exists(p) && ctx.fs.exists(p));
  const supersedes = {}; // ADR-NNN (nouveau) -> [ADR-MMM]
  for (const p of newAdrs) {
    const nnn = `ADR-${ADR_FILE.exec(p)[1]}`;
    supersedes[nnn] = [...ctx.fs.readText(p).matchAll(/\*\*Supersedes:\*\*\s*\[?(ADR-\d{3})/g)].map((m) => m[1]);
    for (const mmm of supersedes[nnn]) {
      if (!addedRows.some((r) => r.includes(mmm) && r.includes(nnn))) problems.push(`${nnn} remplace ${mmm} mais ${REGISTRY} n'a pas la ligne correspondante`);
    }
  }
  for (const r of addedRows) {
    const ids = r.match(/ADR-\d{3}/g) || [];
    if (ids.length >= 2 && !(supersedes[ids[1]] || []).includes(ids[0])) problems.push(`${REGISTRY} : ligne « ${ids[0]} → ${ids[1]} » sans ligne **Supersedes:** dans ${ids[1]}`);
  }
  for (const plan of changed.filter((p) => /\/supersession-plan-.+\.md$/.test(p) && ctx.fs.exists(p))) {
    for (const row of ctx.fs.readText(plan).split(/\r?\n/).filter((l) => /^\|\s*ADR-\d{3}/.test(l))) {
      const ids = row.match(/ADR-\d{3}/g);
      const [old, neo] = [ids[0], ids[ids.length - 1]];
      if (old === neo) continue;
      if (!(supersedes[neo] || []).includes(old)) problems.push(`${plan} : ${neo} devait remplacer ${old} — ligne **Supersedes:** absente ou ADR non écrit`);
    }
  }
  return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
}
