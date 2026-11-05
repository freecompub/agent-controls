#!/usr/bin/env node
// Montre ce que reçoit réellement chaque lentille du reviewer, sans l'appeler.
//   node preview_review.mjs <controls.yaml> <nom de fixture du reviewer> [--lens <nom>]
// Construit le projet de la fixture comme le runner, calcule le diff, puis écrit et affiche le prompt de chaque lentille.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadContract } from './lib/contract.mjs';

const args = process.argv.slice(2);
const [target, fixtureName] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--lens');
const onlyLens = args.includes('--lens') ? args[args.indexOf('--lens') + 1] : null;
if (!target || !fixtureName) { console.error('usage : node preview_review.mjs <controls.yaml> <fixture> [--lens <nom>]'); process.exit(2); }

const { contract, dir, errors } = loadContract(target);
if (errors.length) { errors.forEach((e) => console.log(`ERREUR ${e}`)); process.exit(1); }
const plugin = path.join(dir, 'dist', contract.plugin.name || contract.agent.name);
const compiled = JSON.parse(fs.readFileSync(path.join(plugin, 'controls.json'), 'utf8'));
const f = (contract.reviewer?.fixtures || []).find((x) => x.name === fixtureName);
if (!f) { console.log(`Fixture du reviewer inconnue : ${fixtureName}`); process.exit(1); }
const fx = JSON.parse(fs.readFileSync(path.resolve(dir, f.input), 'utf8'));
const lib = (m) => import(pathToFileURL(path.join(plugin, 'runtime', 'lib', m)).href);
const [state, git, modes, reviewer, log] = await Promise.all(['state.mjs', 'git.mjs', 'modes.mjs', 'reviewer.mjs', 'log.mjs'].map(lib));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-controls-preview-'));
const sh = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const put = (files = {}) => Object.entries(files).forEach(([r, c]) => { fs.mkdirSync(path.dirname(path.join(root, r)), { recursive: true }); fs.writeFileSync(path.join(root, r), c); });
sh('init', '-q'); sh('config', 'user.email', 'p@p'); sh('config', 'user.name', 'p');
put(fx.project?.baseline); sh('add', '-A'); sh('commit', '-qm', 'baseline', '--allow-empty');
log.ensureWorkspace(root);
if (fx.task) state.savePendingTask(root, 's', contract.agent.name, fx.task);
const run = state.getOrCreateRun({ projectDir: root, sessionId: 's', agentId: 'a', agent: contract.agent.name, contract: compiled, remaining: () => 30000 });
put(fx.project?.files);
const now = git.snapshot(root, path.join(run.dir, 'now.index'), 30000);
const changed = git.changedFiles(root, run.st.baseline, now);
const diffText = git.diff(root, run.st.baseline, now);
const agentFile = (lensName) => path.join(plugin, 'agents', `${contract.agent.name}-review-${lensName}.md`);

console.log(`Fixture « ${fixtureName} » — mode ${run.st.mode || 'normal'} — ${changed.length} fichier(s) modifié(s)\n`);
for (const lens of reviewer.lensesOf(compiled.reviewer, modes.active(compiled, run.st).criteria)) {
  if (onlyLens && lens.name !== onlyLens) continue;
  const b = reviewer.writeBundle({ dir: path.join(run.dir, 'preview', lens.name), projectDir: root, agent: contract.agent.name, lens, task: run.st.task, diffText, changed, pluginRoot: plugin, nonce: '0123456789abcdef' });
  const prompt = fs.readFileSync(path.join(root, b.promptFile), 'utf8');
  const instructions = fs.existsSync(agentFile(lens.name)) ? fs.readFileSync(agentFile(lens.name), 'utf8') : '(agent reviewer non généré pour Claude Code)';
  console.log(`${'═'.repeat(70)}\nLENTILLE ${lens.name} — accès ${lens.access}\n${'═'.repeat(70)}`);
  console.log(`── Agent reviewer (${path.basename(agentFile(lens.name))})\n${instructions}`);
  console.log(`── Dossier de revue (${b.promptFile}), ${prompt.length} caractères\n${prompt}\n`);
}
fs.rmSync(root, { recursive: true, force: true });
