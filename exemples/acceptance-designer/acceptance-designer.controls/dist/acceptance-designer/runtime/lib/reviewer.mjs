// Dossiers de revue par lentille. Le reviewer est un agent du plugin, lancé par le client lui-même :
// il lit son dossier, écrit son verdict dans verdict.json, et nos hooks contrôlent tout le reste.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './checks.mjs';

const INLINE_DIFF_MAX = 60000;
const MAX_CONTEXT_FILES = 60;
const MAX_KNOWLEDGE = 40000;

/** Nom de l'agent reviewer d'une lentille. */
export const reviewerAgentName = (agent, lens) => `${agent}-review-${lens}`;

/** Lentilles effectives : celles du contrat, ou une lentille unique « general ». */
export function lensesOf(reviewer, criteria) {
  const declared = reviewer.lenses?.length ? reviewer.lenses : [{ name: 'general', context: reviewer.context || [] }];
  return declared
    .map((l) => ({
      name: l.name,
      inputs: l.inputs || reviewer.inputs || ['task', 'diff', 'artifacts'],
      context: l.context || [],
      access: l.access || 'listed',
      knowledge: (reviewer.knowledge || []).filter((k) => !k.lenses || k.lenses.includes(l.name)),
      criteria: criteria.filter((c) => (reviewer.lenses?.length ? c.lens === l.name : true)),
    }))
    .filter((l) => l.criteria.length);
}

/**
 * Écrit le dossier de revue d'une lentille : prompt.md (entrées, critères, format) et l'emplacement attendu du verdict.
 * Le jeton `nonce` prouve que le verdict a été produit à partir de ce dossier précis.
 */
export function writeBundle({ dir, projectDir, agent, lens, task, diffText, changed, pluginRoot, nonce }) {
  fs.mkdirSync(dir, { recursive: true });
  const rel = (p) => path.relative(projectDir, p).split(path.sep).join('/');
  const f = (n) => path.join(dir, n);
  const verdictPath = rel(f('verdict.json'));
  const has = (k) => lens.inputs.includes(k);
  const context = [...new Set(lens.context.flatMap((g) => listFiles(projectDir, g)))].slice(0, MAX_CONTEXT_FILES);
  const parts = [
    `# Dossier de revue — agent ${agent}, lentille « ${lens.name} »`,
    '',
    lens.access === 'project'
      ? 'Tu évalues uniquement les critères ci-dessous. Pars des entrées de ce dossier ; tu peux aussi chercher et lire dans tout le projet, en lecture seule, pour établir tes réponses.'
      : 'Tu évalues uniquement les critères ci-dessous, à partir des seules entrées de ce dossier. N\'ouvre pas d\'autres fichiers que ceux qui y sont listés.',
    '',
    '## Entrées',
  ];
  if (has('task')) {
    fs.writeFileSync(f('task.md'), task || '(consigne non capturée)');
    parts.push('', '### Consigne donnée à l\'agent', '```', task || '(consigne non capturée)', '```');
  }
  if (has('artifacts')) parts.push('', '### Fichiers produits ou modifiés par l\'agent', ...(changed.length ? changed.map((c) => `- ${c}`) : ['(aucun)']));
  if (has('diff')) {
    fs.writeFileSync(f('diff.patch'), diffText || '');
    parts.push('', '### Diff', diffText && diffText.length <= INLINE_DIFF_MAX
      ? `\`\`\`diff\n${diffText}\n\`\`\`` : `Trop volumineux pour être inclus : lis ${rel(f('diff.patch'))}.`);
  }
  if (context.length) parts.push('', '### Fichiers de référence à lire', ...context.map((c) => `- ${c}`));
  let budget = MAX_KNOWLEDGE;
  for (const k of lens.knowledge) {
    try {
      const text = fs.readFileSync(path.join(pluginRoot, k.path), 'utf8').slice(0, Math.max(0, budget));
      budget -= text.length;
      if (text) parts.push('', `### Référence : ${path.basename(k.path)}`, text.trim());
    } catch { /* absent : signalé par le gate */ }
  }
  parts.push(
    '', '## Critères',
    ...lens.criteria.map((c) => `- ${c.id} : ${c.question}`),
    '', '## Verdict',
    `Écris ton verdict dans \`${verdictPath}\`, et dans aucun autre fichier. Ce fichier contient uniquement cet objet JSON :`,
    `{"version":1,"dossier":"${nonce}","criteria":[{"id":"C1","answer":"yes","evidence":[]},{"id":"C2","answer":"no","evidence":[{"path":"chemin/fichier","line":12,"note":"ce qui ne va pas, en moins de 300 caractères"}]},{"id":"C3","answer":"inconclusive","evidence":[{"path":"chemin/attendu","note":"ce qui manque pour juger"}]}]}`,
    `Le champ « dossier » vaut exactement « ${nonce} ». Chaque critère ci-dessus apparaît exactement une fois, et aucun autre.`,
    '« answer » vaut « yes », « no », ou « inconclusive » si les éléments disponibles ne permettent pas de juger. « evidence » est obligatoire pour « no » (ce qui ne va pas) et pour « inconclusive » (ce qui manque).',
  );
  fs.writeFileSync(f('prompt.md'), parts.join('\n'));
  return { dossier: rel(dir), promptFile: rel(f('prompt.md')), verdictPath };
}

/** Consignes générales du reviewer, communes à toutes les lentilles (corps des fichiers d'agent générés). */
export function reviewerInstructions(agent, description) {
  return [
    `Tu es un reviewer de l'agent « ${agent} »${description ? ` (${description})` : ''}.`,
    '',
    'Ta consigne contient le chemin d\'un dossier de revue. Lis le fichier prompt.md de ce dossier et applique-le strictement : il contient tes entrées, tes critères et le format de ton verdict.',
    '',
    'Règles :',
    '- Tu juges uniquement le résultat (diff, fichiers, livrables), jamais les intentions ou les explications de l\'agent.',
    '- Tu réponds à chaque critère par oui ou non. Si tu doutes de la qualité, la réponse est non ; si les éléments manquent pour juger, la réponse est « inconclusive », en disant ce qui manque.',
    '- Chaque « non » cite au moins un fichier, et la ligne quand c\'est possible, avec une note courte et actionnable.',
    '- Tu écris uniquement le fichier verdict.json du dossier. Toute autre écriture est refusée et invalide ta revue.',
    '- Quand le verdict est écrit, tu termines sans autre action.',
  ].join('\n');
}
