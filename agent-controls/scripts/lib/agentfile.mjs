// Lecture et conversion des fichiers d'agent entre les formats Claude Code et Copilot.
import fs from 'node:fs';
import path from 'node:path';
import yaml from '../vendor/js-yaml.mjs';

export function readAgent(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const fm = m ? (yaml.load(m[1]) || {}) : {};
  const body = m ? m[2] : text;
  const format = file.endsWith('.agent.md') ? 'copilot' : 'claude';
  const id = format === 'copilot' ? path.basename(file, '.agent.md') : (fm.name || path.basename(file, '.md'));
  const tools = fm.tools === undefined ? null
    : Array.isArray(fm.tools) ? fm.tools.map(String) : String(fm.tools).split(',').map((s) => s.trim()).filter(Boolean);
  return { text, fm, body, format, id, tools, model: fm.model ?? null };
}

// Alias Copilot (insensibles à la casse) → outils Claude Code.
const COPILOT_TO_CLAUDE = {
  read: ['Read'], edit: ['Write', 'Edit'], search: ['Grep', 'Glob'],
  execute: ['Bash'], shell: ['Bash'], web: ['WebFetch', 'WebSearch'], agent: ['Task'], todo: ['TodoWrite'],
};
// Outils Claude Code → alias Copilot.
const CLAUDE_TO_COPILOT = {
  Read: 'read', NotebookRead: 'read', Write: 'edit', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Grep: 'search', Glob: 'search', LS: 'search', Bash: 'execute', WebFetch: 'web', WebSearch: 'web',
  Task: 'agent', Agent: 'agent', TodoWrite: 'todo',
  TaskOutput: 'execute', BashOutput: 'execute', KillShell: 'execute', KillBash: 'execute', // famille shell côté Copilot
};

/** Convertit la liste d'outils ; lève une erreur sur un outil inconnu plutôt que de deviner. */
export function convertTools(tools, from, to) {
  if (tools === null || from === to) return tools;
  const out = new Set();
  const unknown = [];
  for (const t of tools) {
    if (from === 'claude') {
      const parts = t.split('__');
      if (parts[0] === 'mcp' && parts.length >= 3) out.add(`${parts[1]}/${parts.slice(2).join('__')}`);
      else if (CLAUDE_TO_COPILOT[t]) out.add(CLAUDE_TO_COPILOT[t]);
      else unknown.push(t);
    } else {
      const k = t.toLowerCase();
      if (COPILOT_TO_CLAUDE[k]) COPILOT_TO_CLAUDE[k].forEach((x) => out.add(x));
      else if (/^[^/]+\/[^/]+$/.test(t) && !t.endsWith('/*')) out.add(`mcp__${t.replace('/', '__')}`);
      else unknown.push(t);
    }
  }
  if (unknown.length) {
    throw new Error(`outil(s) sans équivalent connu en format ${to} : ${unknown.join(', ')}. Ajoute la correspondance ou retire l'outil de l'agent.`);
  }
  return [...out];
}

/** Produit le fichier d'agent dans le format demandé. Le corps du prompt n'est jamais modifié. */
export function renderAgent(agent, to, name, warnings) {
  const fm = { name, description: agent.fm.description ?? '' };
  const tools = convertTools(agent.tools, agent.format, to);
  if (tools) fm.tools = to === 'claude' ? tools.join(', ') : tools;
  if (agent.model) {
    if (agent.format === to) fm.model = agent.model;
    else warnings.push(`modèle « ${agent.model} » non reporté en format ${to} : les identifiants de modèles diffèrent entre clients.`);
  }
  // Les autres champs sont conservés, même d'un format à l'autre : un champ comme user-invocable perdu en route
  // changerait le comportement de l'agent sans prévenir. Un client ignore les champs qu'il ne connaît pas.
  const carried = [];
  for (const [k, v] of Object.entries(agent.fm)) {
    if (k in fm || k === 'tools' || k === 'model') continue;
    fm[k] = v;
    if (agent.format !== to) carried.push(k);
  }
  if (carried.length) warnings.push(`champ(s) reporté(s) tels quels en format ${to}, à vérifier sur ce client : ${carried.join(', ')}`);
  return `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n${agent.body}`;
}
