#!/usr/bin/env node
// Phase 1 : extrait d'un fichier d'agent ce qui est mécaniquement lisible.
//   node inspect_agent.mjs <agent.md> [--json]
// Outils (et leur catégorie), entrées et sorties déclarées dans le frontmatter, transformées en globs proposés.
// C'est un point de départ pour la fiche : l'analyse du prompt reste à faire.
import path from 'node:path';
import { readAgent, collectDeclaredSkills } from './lib/agentfile.mjs';
import { sha256File } from './lib/contract.mjs';
import { toolCategory } from './runtime/lib/normalize.mjs';

const file = process.argv[2];
if (!file) { console.error('usage : node inspect_agent.mjs <agent.md> [--json]'); process.exit(2); }
const agent = readAgent(path.resolve(file));

const COPILOT_ALIASES = { read: 'file.read', search: 'file.read', edit: 'file.write', execute: 'shell.exec', shell: 'shell.exec', web: 'web.fetch', agent: 'subagent.spawn', todo: 'autre' };
const tools = (agent.tools || []).map((t) => {
  let cat = agent.format === 'copilot' ? COPILOT_ALIASES[t.toLowerCase()] || (t.includes('/') ? 'mcp.call' : 'unknown') : toolCategory(t);
  if (t.startsWith('mcp__') && t.endsWith('*')) cat = 'mcp.call';
  return { tool: t, category: cat };
});

// Cherche récursivement des listes de chemins sous des clés évocatrices.
const IO_KEYS = { inputs: 'inputs', input: 'inputs', reads: 'inputs', context: 'inputs', outputs: 'outputs', output: 'outputs', writes: 'outputs', produces: 'outputs', artifacts: 'outputs', artefacts: 'outputs' };
const io = { inputs: new Set(), outputs: new Set() };
const isPath = (s) => typeof s === 'string' && /[/.]/.test(s) && !/\s{2,}/.test(s) && s.length < 300;
const collect = (node, bucket) => {
  if (Array.isArray(node)) node.forEach((x) => collect(x, bucket));
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => collect(v, IO_KEYS[k.toLowerCase()] || bucket));
  else if (bucket && isPath(node)) io[bucket].add(node.replace(/\s*\(.*$/, '').trim());
};
collect(agent.fm, null);
// Skills chargés : déclarés dans le frontmatter (clé « skills » à n'importe quel niveau) ou annoncés dans le prompt.
const body = agent.body || '';
const skills = new Set(collectDeclaredSkills(agent));

// Incohérences mécaniques : commandes shell dans le prompt sans outil shell déclaré.
const shellTools = tools.some((t) => t.category === 'shell.exec');
const CMD = '(?:git|node|npm|npx|dotnet|python3?|bash|sh)\\s';
const commands = [...new Set([
  ...body.matchAll(new RegExp(`(?:^|\\n)\\s*(?:\\$\\s*)?(${CMD}[^\\n\`]{0,80})`, 'g')),
  ...body.matchAll(new RegExp(`\`(${CMD}[^\`]{0,80})\``, 'g')),
].map((m) => m[1].trim().split(/\s+/).slice(0, 2).join(' ')))];
const toGlob = (p) => p.replace(/\{[^}]+\}/g, '*').replace(/\*{3,}/g, '**');

const result = {
  name: agent.id, format: agent.format, model: agent.model,
  user_invocable: agent.fm['user-invocable'] ?? agent.fm.user_invocable ?? null,
  source_sha256: sha256File(path.resolve(file)),
  tools,
  unknown_tools: tools.filter((t) => t.category === 'unknown').map((t) => t.tool),
  declared_inputs: [...io.inputs].map((p) => ({ declared: p, glob: toGlob(p) })),
  declared_outputs: [...io.outputs].map((p) => ({ declared: p, glob: toGlob(p) })),
  skills: [...skills],
  prompt_commands: commands,
  shell_tool_missing: commands.length > 0 && !shellTools,
};

if (process.argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
console.log(`Agent : ${result.name} (format ${result.format}${result.model ? `, modèle ${result.model}` : ''}${result.user_invocable === false ? ', non invocable par l\'utilisateur' : ''})`);
console.log(`Empreinte : ${result.source_sha256}`);
console.log('\nOutils :');
for (const t of tools) console.log(`  ${t.tool.padEnd(24)} ${t.category}`);
if (result.unknown_tools.length) console.log(`  ⚠ sans catégorie connue : ${result.unknown_tools.join(', ')}`);
for (const [label, list] of [['Entrées déclarées', result.declared_inputs], ['Sorties déclarées', result.declared_outputs]]) {
  console.log(`\n${label} :${list.length ? '' : ' aucune dans le frontmatter (à déduire du prompt)'}`);
  for (const x of list) console.log(`  ${x.glob}`);
}
console.log(`\nSkills chargés par l'agent :${result.skills.length ? '' : ' aucun repéré'}`);
for (const k of result.skills) console.log(`  ${k}`);
if (result.skills.length) console.log('  → leurs règles ne sont pas dans ce fichier : propose à l\'utilisateur de les fournir, sans aller les chercher.');
if (result.shell_tool_missing) console.log(`\n⚠ Le prompt demande des commandes (${result.prompt_commands.join(', ')}) mais aucun outil shell n'est déclaré.`);
console.log('\nÀ compléter par la lecture du prompt : zones écrites non déclarées, livrables, sorties anticipées, modes.');
