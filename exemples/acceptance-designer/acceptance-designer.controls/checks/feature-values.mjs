// FM-09 — les valeurs du premier scénario du .feature figurent dans le test d'acceptance (seul ce scénario y est écrit).
const SCENARIO = /^\s*(Scenario|Scenario Outline|Scenario Template)\s*:/;

function firstScenarioValues(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => SCENARIO.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && (SCENARIO.test(l) || /^\s*@/.test(l) || /^\s*Rule\s*:/.test(l)));
  if (end < 0) end = lines.length;
  const values = new Set();
  let inExamples = false; let header = true;
  for (const l of lines.slice(start + 1, end)) {
    if (/^\s*(Examples|Scenarios)\s*:/.test(l)) { inExamples = true; header = true; continue; }
    if (/^\s*\|/.test(l)) {
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
      if (inExamples && header) { header = false; continue; } // ligne d'en-tête : noms des paramètres
      cells.forEach((c) => values.add(c));
      continue;
    }
    for (const m of l.matchAll(/"([^"]+)"/g)) values.add(m[1]);
    const noQuotes = l.replace(/"[^"]*"/g, '').replace(/<[^>]+>/g, '');
    for (const m of noQuotes.matchAll(/(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w.])/g)) values.add(m[0]);
  }
  return [...values];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function check(ctx) {
  const tests = ctx.input.paths.filter((p) => p.endsWith('AcceptanceTests.cs'));
  const features = ctx.input.paths.filter((p) => p.endsWith('.feature'));
  if (!tests.length || !features.length) return { ok: true }; // rien à comparer dans ce run
  const testText = tests.filter((t) => ctx.fs.exists(t)).map((t) => ctx.fs.readText(t)).join('\n');
  const missing = [];
  for (const f of features.filter((x) => ctx.fs.exists(x))) {
    for (const v of firstScenarioValues(ctx.fs.readText(f))) {
      const pattern = /^-?\d+(?:[.,]\d+)?$/.test(v)
        ? new RegExp(`(?<![\\d.])(${escape(v.replace(',', '.'))}|${escape(v)})(?![\\d.])`) // tolère un suffixe de type (480.50m)
        : new RegExp(escape(v));
      if (!pattern.test(testText)) missing.push(`${v} (${f})`);
    }
  }
  return missing.length ? { ok: false, details: `valeur(s) du premier scénario absente(s) du test : ${missing.join(', ')}` } : { ok: true };
}
