// Analyse et validation du verdict du reviewer. Le statut est toujours recalculé ici.

/** Extrait l'objet JSON de la sortie brute (sortie JSON de la CLI, bloc de code, texte autour). */
export function extractJSON(stdout) {
  let text = String(stdout || '').trim();
  try {
    const o = JSON.parse(text);
    if (o && typeof o.result === 'string') text = o.result; // enveloppe de `claude -p --output-format json`
    else if (o && typeof o === 'object') return o;
  } catch { /* texte libre */ }
  text = text.replace(/```(?:json)?/gi, '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('aucun objet JSON dans la réponse du reviewer');
  return JSON.parse(text.slice(a, b + 1));
}

/**
 * Valide le verdict contre les critères attendus.
 * Retourne { valid: true, failed: [{id, evidence}], passed: [id] } ou { valid: false, error }.
 */
export function validateVerdict(v, criteria) {
  const expected = new Set(criteria.map((c) => c.id));
  const fail = (error) => ({ valid: false, error });
  if (!v || typeof v !== 'object') return fail('verdict absent');
  if (v.version !== 1) return fail('version du verdict différente de 1');
  if (!Array.isArray(v.criteria)) return fail('champ criteria absent');
  const seen = new Set();
  const failed = [];
  const passed = [];
  const inconclusive = [];
  for (const c of v.criteria) {
    if (!c || typeof c.id !== 'string' || !/^C[0-9]+$/.test(c.id)) return fail('identifiant de critère invalide');
    if (!expected.has(c.id)) return fail(`critère inconnu : ${c.id}`);
    if (seen.has(c.id)) return fail(`critère en double : ${c.id}`);
    seen.add(c.id);
    if (!['yes', 'no', 'inconclusive'].includes(c.answer)) return fail(`réponse invalide pour ${c.id}`);
    if (!Array.isArray(c.evidence)) return fail(`evidence absent pour ${c.id}`);
    for (const e of c.evidence) {
      if (!e || typeof e.path !== 'string' || typeof e.note !== 'string' || !e.note || e.note.length > 300) {
        return fail(`élément d'evidence invalide pour ${c.id}`);
      }
      if (e.line !== undefined && !(Number.isInteger(e.line) && e.line >= 1)) return fail(`ligne invalide pour ${c.id}`);
    }
    if (c.answer !== 'yes' && !c.evidence.length) return fail(`evidence obligatoire pour ${c.id} (réponse « ${c.answer} »)`);
    if (c.answer === 'no') failed.push({ id: c.id, evidence: c.evidence });
    else if (c.answer === 'inconclusive') inconclusive.push({ id: c.id, evidence: c.evidence });
    else passed.push(c.id);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length) return fail(`critère(s) sans réponse : ${missing.join(', ')}`);
  return { valid: true, failed, passed, inconclusive };
}
