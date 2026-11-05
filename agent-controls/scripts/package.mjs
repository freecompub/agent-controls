#!/usr/bin/env node
// Gate de packaging : node package.mjs <chemin/controls.yaml> [--marketplace <dossier> [--marketplace-name <nom>]]
// Échoue si une condition n'est pas remplie ; ne contourne rien. En cas de succès, enregistre la version
// livrée et, sur demande, inscrit le plugin dans un marketplace.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadContract } from './lib/contract.mjs';
import { digestDir } from './lib/digest.mjs';
import { reviewerDigest } from './lib/reviewdigest.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const target = args.find((a, i) => !a.startsWith('--') && !['--marketplace', '--marketplace-name'].includes(args[i - 1]));
if (!target) { console.error('usage : node package.mjs <controls.yaml> [--marketplace <dossier> [--marketplace-name <nom>]]'); process.exit(2); }

const failures = [];
const fail = (m) => failures.push(m);
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(`${p} illisible : ${e.message}`); return null; } };

// 1. Contrat
const loaded = loadContract(target);
if (loaded.errors.length) { loaded.errors.forEach((e) => console.log(`ERREUR ${e}`)); console.log('\nGate refusé : contrat invalide (phase 4).'); process.exit(1); }
const { contract, dir } = loaded;
const name = contract.plugin.name || contract.agent.name;
const version = contract.plugin.version;
const plugin = path.join(dir, 'dist', name);
if (!fs.existsSync(path.join(plugin, 'controls.json'))) { console.log('Gate refusé : plugin absent, lance generate.mjs (phase 5).'); process.exit(1); }
const digest = digestDir(plugin);
const clients = new Set(contract.agent.clients);
const forClaude = clients.has('claude-code');
const forCopilot = [...clients].some((c) => c.startsWith('copilot'));

// 2. Plugin conforme au contrat
const compiled = readJSON(path.join(plugin, 'controls.json'));
if (compiled) {
  if (compiled.agent.source_sha256 !== contract.agent.source_sha256) fail('le plugin a été généré depuis une autre version de l\'agent : régénère');
  if (JSON.stringify(compiled.controls) !== JSON.stringify(contract.controls.map(({ fixtures, ...c }) => c))) fail('les contrôles du plugin ne correspondent plus au contrat : régénère');
  if (compiled.plugin?.version !== version) fail(`version du plugin compilé (${compiled.plugin?.version}) ≠ version du contrat (${version}) : régénère`);
  const t = compiled.runtime?.hook_timeouts_s || {};
  if (contract.reviewer && !(t.SubagentStop * 1000 > contract.reviewer.timeout_ms)) fail('le délai du hook SubagentStop ne couvre pas le délai du reviewer');
}

// 3. Rapport de fixtures : présent, réussi, obtenu sur CE plugin, complet
const reportPath = path.join(dir, '.fixtures-report.json');
const report = fs.existsSync(reportPath) ? readJSON(reportPath) : (fail('aucun rapport de fixtures : lance run_fixtures.mjs (phase 6)'), null);
if (report) {
  if (report.plugin_digest !== digest) fail('le plugin a changé depuis les dernières fixtures : relance run_fixtures.mjs');
  if (!report.passed) fail('les dernières fixtures ont échoué ou dépassé un budget');
  const ran = new Set(report.results.filter((r) => !r.skipped).map((r) => `${r.client}|${r.owner}|${r.fixture}`));
  const runClients = [...new Set(contract.agent.clients.map((c) => (c.startsWith('copilot') ? 'copilot' : 'claude')))];
  const fixtures = [
    ...contract.controls.flatMap((c) => c.fixtures.map((f) => [c.id, f])),
    ...(contract.reviewer?.fixtures || []).map((f) => ['reviewer', f]),
    ...(contract.blocked_exit?.check?.fixtures || []).map((f) => ['blocked_exit', f]),
  ];
  for (const client of runClients) {
    for (const [owner, f] of fixtures) {
      const fx = readJSON(path.resolve(dir, f.input));
      if (fx?.live) continue;
      if (!ran.has(`${client}|${owner}|${f.name}`)) fail(`fixture non exécutée : ${owner}/${f.name} (${client})`);
    }
  }
  for (const b of report.latency || []) if (!b.ok) fail(`budget dépassé : ${b.client} ${b.event} p95=${b.p95} ms > ${b.budget} ms`);
}

// 3 bis. Revue réelle : le jugement du reviewer doit avoir été exécuté sur les fixtures live, avec ce prompt et ces critères.
let reviewerVerified = true;
if (contract.reviewer) {
  const livePath = path.join(dir, '.live-report.json');
  const lr = fs.existsSync(livePath) ? JSON.parse(fs.readFileSync(livePath, 'utf8')) : null;
  const problem = !lr ? 'le reviewer n\'a jamais été exécuté réellement : live_review.mjs prepare, revue dans le client, puis live_review.mjs collect (phase 6)'
    : lr.reviewer_digest !== reviewerDigest(plugin) ? 'le reviewer a changé depuis la dernière revue réelle : refais live_review.mjs prepare puis collect'
      : !lr.passed ? 'la dernière revue réelle n\'a pas donné les verdicts attendus sur les fixtures live' : null;
  if (problem) {
    if (args.includes('--allow-unverified-reviewer')) { reviewerVerified = false; console.log(`AVERTISSEMENT ${problem} — livré quand même (--allow-unverified-reviewer)`); }
    else fail(problem);
  }
}

// 4. Structure et manifestes
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
if (!NAME_RE.test(name) || name.length > 64) fail(`nom de plugin invalide : ${name}`);
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) fail(`version invalide : ${version}`);
const mustExist = ['runtime/dispatch.mjs', 'README.md'];
if (contract.reviewer) {
  const lensNames = contract.reviewer.lenses?.length ? contract.reviewer.lenses.map((l) => l.name) : ['general'];
  for (const l of lensNames) {
    if (forClaude) mustExist.push(`agents/${contract.agent.name}-review-${l}.md`);
    if (forCopilot) mustExist.push(`copilot/agents/${contract.agent.name}-review-${l}.agent.md`);
  }
}
for (const m of contract.controls.filter((c) => c.check.type === 'custom').map((c) => c.check.module)) mustExist.push(m);
const checkHookCommands = (file, list) => {
  for (const cmd of list) if (!/runtime\/dispatch\.mjs"? (claude|copilot) [A-Za-z]+$/.test(cmd)) fail(`${file} : commande de hook inattendue « ${cmd} »`);
};
if (forClaude) {
  mustExist.push(`agents/${contract.agent.name}.md`);
  const m = readJSON(path.join(plugin, '.claude-plugin', 'plugin.json'));
  if (m && (m.name !== name || m.version !== version)) fail('.claude-plugin/plugin.json : nom ou version incohérent');
  const h = readJSON(path.join(plugin, 'hooks', 'hooks.json'));
  if (h) {
    for (const ev of ['PreToolUse', 'SubagentStop', 'Stop']) if (!h.hooks?.[ev]) fail(`hooks/hooks.json : événement ${ev} absent`);
    checkHookCommands('hooks/hooks.json', Object.values(h.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((x) => x.command)));
  }
}
if (forCopilot) {
  mustExist.push(`copilot/agents/${contract.agent.name}.agent.md`);
  const m = readJSON(path.join(plugin, 'plugin.json'));
  if (m) {
    if (m.name !== name || m.version !== version) fail('plugin.json : nom ou version incohérent');
    if (m.$schema) fail('plugin.json : $schema déclaré (format Agent Plugins) — le plugin doit rester au format historique');
    if (m.agents !== 'copilot/agents/' || m.hooks !== 'copilot/hooks.json') fail('plugin.json : chemins agents/hooks inattendus');
  }
  const h = readJSON(path.join(plugin, 'copilot', 'hooks.json'));
  if (h) {
    if (h.version !== 1) fail('copilot/hooks.json : version différente de 1');
    for (const ev of ['PreToolUse', 'SubagentStop', 'Stop']) if (!h.hooks?.[ev]) fail(`copilot/hooks.json : événement ${ev} absent`);
    checkHookCommands('copilot/hooks.json', Object.values(h.hooks || {}).flat().map((e) => e.command));
    if ((contract.runtime.max_iterations ?? 3) >= 8) fail('max_iterations doit rester inférieur au garde-fou Copilot (8)');
  }
}
for (const f of mustExist) if (!fs.existsSync(path.join(plugin, f))) fail(`fichier absent du plugin : ${f}`);

// 5. Version : tout changement de contenu exige une nouvelle version
const lockPath = path.join(dir, '.package-lock.json');
const lock = fs.existsSync(lockPath) ? readJSON(lockPath) : null;
const cmpSemver = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
if (lock) {
  const c = cmpSemver(version, lock.version);
  if (c < 0) fail(`version ${version} inférieure à la dernière livrée (${lock.version})`);
  else if (c === 0 && lock.digest !== digest) fail(`le contenu a changé depuis la version ${lock.version} livrée : incrémente plugin.version, régénère et relance les fixtures`);
}

if (failures.length) {
  failures.forEach((f) => console.log(`REFUSÉ ${f}`));
  console.log(`\nGate refusé : ${failures.length} condition(s) non remplie(s). Reviens à la phase concernée.`);
  process.exit(1);
}

// 6. Succès : version livrée, marketplace optionnelle
fs.writeFileSync(lockPath, `${JSON.stringify({ version, digest, reviewer_verified: reviewerVerified, at: new Date().toISOString() }, null, 2)}\n`);
const mpDir = opt('--marketplace');
if (mpDir) {
  const mpFile = path.join(path.resolve(mpDir), '.claude-plugin', 'marketplace.json');
  fs.mkdirSync(path.dirname(mpFile), { recursive: true });
  const mp = fs.existsSync(mpFile) ? JSON.parse(fs.readFileSync(mpFile, 'utf8')) : {
    name: opt('--marketplace-name') || path.basename(path.resolve(mpDir)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    owner: { name: 'agent-controls' },
    plugins: [],
  };
  const source = `./${path.relative(path.resolve(mpDir), plugin).split(path.sep).join('/')}`;
  if (source.startsWith('./..')) { console.log('REFUSÉ le plugin doit se trouver sous le dossier de la marketplace'); process.exit(1); }
  const entry = { name, version, description: contract.plugin.description || `Agent ${contract.agent.name} avec ses contrôles`, source };
  mp.plugins = [...(mp.plugins || []).filter((p) => p.name !== name), entry];
  fs.writeFileSync(mpFile, `${JSON.stringify(mp, null, 2)}\n`);
  console.log(`Marketplace « ${mp.name} » mise à jour : ${mpFile}`);
}

console.log(`\nPlugin ${name} ${version} prêt — fixtures à jour, budgets respectés, manifestes valides${reviewerVerified ? ', revue réelle vérifiée' : ', REVUE RÉELLE NON VÉRIFIÉE'}.`);
console.log('Reste la vérification de chargement réel sur chaque client (phase 7, checklist dans references/plugin-format.md).');
if (forClaude) console.log(`  Claude Code : /plugin marketplace add <dossier-ou-dépôt>  puis  /plugin install ${name}@<marketplace>`);
if (forCopilot) console.log(`  Copilot CLI : copilot plugin install ${plugin}`);
