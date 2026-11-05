// FM-19 — format du .feature défini par l'agent : structure Gherkin, un tag de type par scénario, au moins un @happy-path.
const STEP = /^\s*(Given|When|Then|And|But|\*)\s/;
const SCENARIO = /^\s*(Scenario|Scenario Outline|Scenario Template)\s*:/;

export default async function check(ctx) {
  const types = ctx.params.types || ['@happy-path', '@edge-case', '@error-case'];
  const problems = [];
  for (const p of ctx.input.paths.filter((x) => x.endsWith('.feature'))) {
    if (!ctx.fs.exists(p)) continue;
    const lines = ctx.fs.readText(p).split(/\r?\n/);
    if (!lines.some((l) => /^\s*Feature\s*:/.test(l))) problems.push(`${p} : ligne « Feature: » absente`);
    let pendingTags = [];
    let current = null;
    const scenarios = [];
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('@')) { pendingTags.push(...t.split(/\s+/).filter((x) => x.startsWith('@'))); return; }
      if (SCENARIO.test(l)) {
        current = { line: i + 1, outline: /Outline|Template/.test(l), tags: pendingTags, steps: [], examples: false };
        scenarios.push(current);
        pendingTags = [];
        return;
      }
      if (/^\s*(Feature|Rule|Background)\s*:/.test(l)) { pendingTags = []; current = /Background/.test(l) ? null : current; return; }
      if (/^\s*(Examples|Scenarios)\s*:/.test(l) && current) current.examples = true;
      if (STEP.test(l) && current) current.steps.push(t.split(/\s+/)[0]);
    });
    if (!scenarios.length) problems.push(`${p} : aucun scénario`);
    for (const s of scenarios) {
      const kinds = s.tags.filter((x) => types.includes(x));
      if (kinds.length !== 1) problems.push(`${p}:${s.line} : il faut exactement un tag parmi ${types.join(', ')} (trouvé : ${kinds.join(', ') || 'aucun'})`);
      if (!s.steps.includes('When') || !s.steps.includes('Then')) problems.push(`${p}:${s.line} : scénario sans When ou sans Then`);
      if (s.outline && !s.examples) problems.push(`${p}:${s.line} : Scenario Outline sans Examples`);
    }
    if (scenarios.length && !scenarios.some((s) => s.tags.includes('@happy-path'))) problems.push(`${p} : aucun scénario @happy-path`);
  }
  return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
}
