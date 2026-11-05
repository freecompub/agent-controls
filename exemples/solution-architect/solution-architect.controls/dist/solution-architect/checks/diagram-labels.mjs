// FM-22 — dans les diagrammes Mermaid, chaque nœud porte une des étiquettes imposées par l'agent.
const LABELS = /\b(Command|Query|Aggregate Root|Aggregate|Entity|Value Object|Domain Service|Domain Event|Repository|Read Model)\b/;
export default async function check(ctx) {
  const problems = [];
  for (const p of ctx.input.paths.filter((x) => /diagrams-.+\.md$/.test(x) && ctx.fs.exists(x))) {
    const text = ctx.fs.readText(p);
    for (const block of text.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
      if (!/^\s*(graph|flowchart)\b/m.test(block[1])) continue; // seuls les diagrammes de composants portent des nœuds étiquetés
      for (const line of block[1].split(/\r?\n/)) {
        if (/^\s*(subgraph|end\b|graph|flowchart|%%|classDef|class |style )/.test(line)) continue;
        for (const m of line.replace(/\|[^|]*\|/g, '').matchAll(/([A-Za-z0-9_]+)\s*[[({]+"?([^\])}"]+)"?[\])}]+/g)) {
          if (!LABELS.test(m[2])) problems.push(`${p} : nœud « ${m[1]} » sans étiquette imposée (« ${m[2].trim()} »)`);
        }
      }
    }
  }
  return problems.length ? { ok: false, details: problems.slice(0, 10).join('\n') } : { ok: true };
}
