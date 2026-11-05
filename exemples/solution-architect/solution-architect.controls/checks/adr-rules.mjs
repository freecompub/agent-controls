// Règles des fichiers d'ADR définies par l'agent (FM-04, FM-09, FM-10, FM-11). params.rule choisit la règle.
const ADR_FILE = /^docs\/adr\/adr-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const IS_ADR = (p) => /^docs\/adr\/adr-[^/]+\.md$/.test(p);
const KEYS = ['adr', 'title', 'status', 'chosen', 'decision', 'supersedes', 'date', 'ratified_by'];
const num = (p) => Number((/adr-(\d+)-/.exec(p) || [])[1]);

function header(text) {
  const m = /(^|\n)---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const keys = {};
  for (const line of m[2].split(/\r?\n/)) { const k = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line); if (k) keys[k[1]] = k[2].trim().replace(/^["']|["']$/g, ''); }
  return keys;
}

export default async function check(ctx) {
  const { rule } = ctx.params;
  const adrs = ctx.input.paths.filter(IS_ADR);
  const isNew = (p) => !ctx.baseline?.exists(p);
  const problems = [];
  if (rule === 'filename') {
    for (const p of adrs) if (!ADR_FILE.test(p)) problems.push(`${p} : nom attendu docs/adr/adr-NNN-slug.md`);
  }
  if (rule === 'header' || rule === 'proposed') {
    for (const p of adrs.filter(isNew)) {
      if (!ctx.fs.exists(p)) continue;
      const h = header(ctx.fs.readText(p));
      if (rule === 'header') {
        if (!h) { problems.push(`${p} : en-tête YAML absent (rends l'ADR avec artifact.mjs adr)`); continue; }
        const missing = KEYS.filter((k) => !(k in h));
        if (missing.length) problems.push(`${p} : clé(s) d'en-tête absente(s) : ${missing.join(', ')}`);
      } else if (h && h.status !== 'Proposed') problems.push(`${p} : un nouvel ADR est « Proposed », pas « ${h.status} »`);
    }
  }
  if (rule === 'numbering') {
    const before = (ctx.baseline?.list() || []).filter((p) => ADR_FILE.test(p)).map(num);
    const created = (ctx.changed || []).filter((p) => ADR_FILE.test(p) && isNew(p)).map(num).sort((a, b) => a - b);
    const max = before.length ? Math.max(...before) : 0;
    created.forEach((n, i) => {
      if (before.includes(n)) problems.push(`ADR-${String(n).padStart(3, '0')} existe déjà`);
      else if (n !== max + 1 + i) problems.push(`numérotation : ADR-${String(max + 1 + i).padStart(3, '0')} attendu, ADR-${String(n).padStart(3, '0')} trouvé`);
    });
  }
  return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
}
