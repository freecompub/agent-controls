#!/usr/bin/env node
// Génère le plugin : node generate.mjs <chemin/controls.yaml>
// Reconstruit entièrement <dossier du contrat>/dist/<plugin>/ à partir du contrat et de l'agent source.
import fs from 'node:fs';
import path from 'node:path';
import { loadContract, SKILL_ROOT } from './lib/contract.mjs';
import { renderAgent } from './lib/agentfile.mjs';
import { lensesOf, reviewerAgentName, reviewerInstructions } from './runtime/lib/reviewer.mjs';
import yaml from './vendor/js-yaml.mjs';

const CLAUDE_TOOLS = {
  'file.read': ['Read', 'Glob', 'Grep'],
  'file.write': ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
  'shell.exec': ['Bash', 'KillShell'],
  'web.fetch': ['WebFetch', 'WebSearch'],
  'subagent.spawn': ['Task', 'Agent'],
  'mcp.call': ['mcp__.*'],
};
const COPILOT_EXTRA = { 'file.write': ['apply_patch', 'str_replace_editor'], 'shell.exec': ['powershell'] }; // outils sans équivalent Claude

const target = process.argv[2];
if (!target) { console.error('usage : node generate.mjs <controls.yaml>'); process.exit(2); }

const loaded = loadContract(target);
if (loaded.errors.length) {
  for (const e of loaded.errors) console.log(`ERREUR ${e}`);
  console.log('\nGénération refusée : corrige le contrat (phase 4).');
  process.exit(1);
}
const { contract, dir, agent } = loaded;
const warnings = [...loaded.warnings];
const name = contract.plugin.name || contract.agent.name;
const clients = new Set(contract.agent.clients);
const forClaude = clients.has('claude-code');
const forCopilot = clients.has('copilot-cli') || clients.has('copilot-vscode');

// --- Dossier de sortie : supprimé puis reconstruit, uniquement sous <contrat>/dist/
const distRoot = path.join(dir, 'dist');
const out = path.join(distRoot, name);
if (!path.resolve(out).startsWith(path.resolve(distRoot) + path.sep)) throw new Error('chemin de sortie inattendu');
fs.rmSync(out, { recursive: true, force: true });
const write = (rel, content) => {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
};

// --- Délais des hooks (secondes), dérivés du contrat
const postCmd = contract.controls.filter((c) => c.event === 'PostToolUse' && c.check.type === 'run-command')
  .reduce((s, c) => s + (c.check.timeout_ms || 2000), 0);
const replay = contract.controls.filter((c) => ['PostToolUse', 'SubagentStop'].includes(c.event) && c.check.type === 'run-command')
  .reduce((s, c) => s + (c.check.timeout_ms || 2000), 0);
const hookTimeouts = {
  PreToolUse: 15, // inclut la photographie Git initiale du run
  PostToolUse: Math.ceil(5 + postCmd / 1000),
  SubagentStop: Math.ceil(30 + ((contract.reviewer?.timeout_ms || 0) + replay * 4) / 1000), // rejeu : plusieurs fichiers possibles
  Stop: 5,
};

// --- Contrat compilé (lu par le runtime)
const compiled = {
  version: 1,
  agent: { name: contract.agent.name, clients: contract.agent.clients, source_sha256: contract.agent.source_sha256 },
  plugin: { name, version: contract.plugin.version },
  runtime: { ...contract.runtime, hook_timeouts_s: hookTimeouts },
  failure_modes: contract.failure_modes,
  controls: contract.controls.map(({ fixtures, ...c }) => c),
  ...(contract.blocked_exit ? { blocked_exit: (({ check, ...b }) => ({ require_no_changes: true, ...b, ...(check ? { check: (({ fixtures, ...k }) => k)(check) } : {}) }))(contract.blocked_exit) } : {}),
  ...(contract.modes ? { modes: contract.modes } : {}),
  ...(contract.report ? { report: contract.report } : {}),
};
if (contract.reviewer) {
  const { fixtures, ...r } = contract.reviewer;
  compiled.reviewer = r;
}
write('controls.json', compiled);

// --- Runtime et modules custom
fs.cpSync(path.join(SKILL_ROOT, 'scripts', 'runtime'), path.join(out, 'runtime'), { recursive: true });
const modules = [...new Set([
  ...contract.controls.filter((c) => c.check.type === 'custom').map((c) => c.check.module),
  ...(contract.blocked_exit?.check ? [contract.blocked_exit.check.module] : []),
  ...contract.controls.filter((c) => c.check.type === 'schema').map((c) => c.check.schema),
  ...(contract.reviewer?.knowledge || []).map((k) => k.path),
])];
for (const m of modules) write(m, fs.readFileSync(path.resolve(dir, m), 'utf8'));

// --- Agent (copie, dans chaque format ciblé) et agents reviewers (un par lentille)
if (forClaude) write(`agents/${contract.agent.name}.md`, renderAgent(agent, 'claude', contract.agent.name, warnings));
if (forCopilot) write(`copilot/agents/${contract.agent.name}.agent.md`, renderAgent(agent, 'copilot', contract.agent.name, warnings));
if (contract.reviewer) {
  // Les reviewers sont des agents exécutés par le client : ni CLI, ni SDK, ni clé.
  // Lecture libre ; l'écriture (nécessaire au verdict) est limitée par les hooks au seul verdict.json du dossier.
  const body = reviewerInstructions(contract.agent.name, agent.fm.description);
  const model = contract.reviewer.model;
  const modelFor = (c) => (typeof model === 'object' && model ? model[c] : model);
  for (const lens of lensesOf(contract.reviewer, contract.reviewer.criteria)) {
    const name = reviewerAgentName(contract.agent.name, lens.name);
    const description = `Reviewer interne de ${contract.agent.name} (lentille ${lens.name}). Lancé uniquement à la demande des contrôles du plugin, avec un dossier de revue.`;
    if (forClaude) {
      const fm = { name, description, tools: 'Read, Grep, Glob, Write', ...(modelFor('claude') ? { model: modelFor('claude') } : {}) };
      write(`agents/${name}.md`, `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n${body}\n`);
    }
    if (forCopilot) {
      const fm = { name, description, tools: ['read', 'search', 'edit'], 'user-invocable': false, ...(modelFor('copilot') ? { model: modelFor('copilot') } : {}) };
      write(`copilot/agents/${name}.agent.md`, `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n${body}\n`);
    }
  }
}

// --- Hooks
const cmd = (client, event) => {
  const root = client === 'claude' ? '${CLAUDE_PLUGIN_ROOT}' : '${PLUGIN_ROOT}';
  return `node "${root}/runtime/dispatch.mjs" ${client} ${event}`;
};
const toolsFor = (event) => {
  const cats = new Set(contract.controls.filter((c) => c.event === event).flatMap((c) => c.match.tools || Object.keys(CLAUDE_TOOLS)));
  if (event === 'PostToolUse' && contract.reviewer) cats.add('subagent.spawn');
  if (event === 'PreToolUse') {
    // Tout outil capable de modifier le projet doit déclencher le hook : c'est au premier appel que la
    // baseline Git du run est prise. Un outil d'écriture non intercepté fausserait le diff du reviewer.
    ['file.write', 'shell.exec', 'mcp.call', 'subagent.spawn'].forEach((c) => cats.add(c));
  }
  return [...cats];
};
const matcher = (cats, copilot) => [...new Set(cats.flatMap((c) => [...CLAUDE_TOOLS[c], ...(copilot ? COPILOT_EXTRA[c] || [] : [])]))].join('|');
// PostToolUse est toujours déclaré quand il y a un reviewer : au retour d'un subagent, le thread principal reçoit l'action attendue.
const events = ['PreToolUse', ...(contract.controls.some((c) => c.event === 'PostToolUse') || contract.reviewer ? ['PostToolUse'] : []), 'SubagentStop', 'Stop'];

if (forClaude) {
  const hooks = {};
  for (const ev of events) {
    const entry = { hooks: [{ type: 'command', command: cmd('claude', ev), timeout: hookTimeouts[ev] }] };
    if (ev === 'PreToolUse' || ev === 'PostToolUse') entry.matcher = matcher(toolsFor(ev), false);
    hooks[ev] = [entry];
  }
  write('hooks/hooks.json', { hooks });
  write('.claude-plugin/plugin.json', { name, version: contract.plugin.version, description: contract.plugin.description || `Agent ${contract.agent.name} avec ses contrôles` });
}
if (forCopilot) {
  const hooks = {};
  for (const ev of events) {
    const entry = { type: 'command', command: cmd('copilot', ev), timeoutSec: hookTimeouts[ev] };
    if (ev === 'PreToolUse' || ev === 'PostToolUse') entry.matcher = matcher(toolsFor(ev), true);
    hooks[ev] = [entry];
  }
  write('copilot/hooks.json', { version: 1, hooks });
  write('plugin.json', {
    name, version: contract.plugin.version,
    description: contract.plugin.description || `Agent ${contract.agent.name} avec ses contrôles`,
    agents: 'copilot/agents/', hooks: 'copilot/hooks.json',
  });
}

// --- README
const rows = contract.failure_modes.map((fm) => {
  const by = [...contract.controls.filter((c) => c.covers.includes(fm.id)).map((c) => `${c.id} (${c.event})`),
    ...(contract.reviewer?.criteria || []).filter((c) => c.covers.includes(fm.id)).map((c) => `reviewer ${c.id}`)];
  return `| ${fm.id} | ${fm.severity} | ${fm.description} | ${by.join(', ')} |`;
});
write('README.md', [
  `# ${name} ${contract.plugin.version}`,
  '',
  `Agent \`${contract.agent.name}\` livré avec ses contrôles. Plugin généré par le skill agent-controls : ne pas éditer à la main.`,
  '',
  '## Installation',
  '',
  ...(forClaude ? ['Claude Code : ajouter la marketplace qui référence ce dossier (`/plugin marketplace add <chemin-ou-dépôt>`), puis `/plugin install ' + name + '@<marketplace>`.', ''] : []),
  ...(forCopilot ? ['Copilot CLI : `copilot plugin install <chemin-de-ce-dossier>`.', ''] : []),
  'Prérequis : Node.js 18 ou plus, et un projet sous Git.',
  '',
  '## Couverture',
  '',
  '| Mode | Gravité | Défaillance | Contrôles |',
  '|---|---|---|---|',
  ...rows,
  '',
  ...((contract.deferred || []).length ? [
    '## Contrôles à durcir',
    '',
    'Couverts aujourd\'hui par le reviewer ; un hook déterministe est envisagé dès qu\'un exemple sera disponible.',
    '',
    '| Id | Modes | Hook envisagé | Il manque |',
    '|---|---|---|---|',
    ...contract.deferred.map((d) => `| ${d.id} | ${d.covers.join(', ')} | ${d.planned} | ${d.needs} |`),
    '',
  ] : []),
  ...((contract.uncovered_sources || []).length ? [
    '## Règles non couvertes',
    '',
    'L\'agent s\'appuie sur ces sources, qui n\'ont pas été fournies pour construire les contrôles : leurs règles ne sont vérifiées ni par les hooks ni par les reviewers.',
    '',
    '| Source | Type | Ce qui n\'est pas contrôlé |',
    '|---|---|---|',
    ...contract.uncovered_sources.map((u) => `| ${u.name} | ${u.kind} | ${u.impact} |`),
    '',
  ] : []),
  '## Fonctionnement',
  '',
  `- Les contrôles ne s'appliquent qu'à l'agent \`${contract.agent.name}\` utilisé comme subagent. Les autres agents de la session ne sont pas affectés.`,
  `- À la fin de l'agent, les contrôles sont rejoués sur les fichiers modifiés${contract.reviewer ? ', puis un reviewer en lecture seule évalue le travail' : ''}. Après ${contract.runtime.max_iterations} tentatives refusées, le travail est escaladé vers l'utilisateur.`,
  '- Mesures et logs : `.agent-controls/.runs/` dans le projet (non versionné). Rapport : `node <plugin>/runtime/report.mjs`.',
  '- Désactiver le plugin retire l\'agent et ses contrôles.',
  '',
  '## Limites connues',
  '',
  '- Copilot : un contrôle `PostToolUse` ne bloque pas immédiatement ; il est imposé à la fin de l\'agent.',
  '- Copilot : un agent du projet portant le même nom masque celui du plugin ; les contrôles s\'appliquent alors à la définition du projet.',
  '- Copilot cloud agent : les plugins n\'y sont pas chargés, aucun contrôle ne s\'y applique.',
  '',
].join('\n'));

console.log(`Plugin généré : ${path.relative(process.cwd(), out) || out}`);
console.log(`Clients : ${[...clients].join(', ')} — délais des hooks (s) : ${JSON.stringify(hookTimeouts)}`);
for (const w of warnings) console.log(`AVERTISSEMENT ${w}`);
