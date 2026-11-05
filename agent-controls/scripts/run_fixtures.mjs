#!/usr/bin/env node
// Exécute les fixtures à travers les hooks du plugin généré, pour chaque client ciblé.
//   node run_fixtures.mjs <chemin/controls.yaml> [--samples N]   (les fixtures live passent par live_review.mjs)
// Vérifie : décision attendue, isolation (un autre agent n'est pas affecté), invariants de sortie
// (stdout = au plus un JSON, stderr vide) et latence p95 par rapport au budget du contrat.
// Écrit le résultat dans <dossier du contrat>/.fixtures-report.json, lu par le gate de packaging.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadContract } from './lib/contract.mjs';
import { digestDir } from './lib/digest.mjs';
import { reviewerDigest } from './lib/reviewdigest.mjs';

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--samples');
const samples = args.includes('--samples') ? Math.max(1, Number(args[args.indexOf('--samples') + 1]) || 5) : 5;
const live = false;
if (!target) { console.error('usage : node run_fixtures.mjs <controls.yaml> [--samples N]'); process.exit(2); }

const loaded = loadContract(target);
if (loaded.errors.length) { loaded.errors.forEach((e) => console.log(`ERREUR ${e}`)); process.exit(1); }
const { contract, dir } = loaded;
const name = contract.plugin.name || contract.agent.name;
const plugin = path.join(dir, 'dist', name);
const compiledPath = path.join(plugin, 'controls.json');
if (!fs.existsSync(compiledPath)) { console.log('Plugin absent : lance generate.mjs (phase 5).'); process.exit(1); }
const compiled = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
if (compiled.agent.source_sha256 !== contract.agent.source_sha256 || JSON.stringify(compiled.controls) !== JSON.stringify(contract.controls.map(({ fixtures, ...c }) => c))) {
  console.log('Le plugin ne correspond plus au contrat : relance generate.mjs (phase 5).');
  process.exit(1);
}

const dispatch = path.join(plugin, 'runtime', 'dispatch.mjs');
const state = await import(pathToFileURL(path.join(plugin, 'runtime', 'lib', 'state.mjs')).href);
const { ensureWorkspace } = await import(pathToFileURL(path.join(plugin, 'runtime', 'lib', 'log.mjs')).href);
const { active } = await import(pathToFileURL(path.join(plugin, 'runtime', 'lib', 'modes.mjs')).href);
const clients = [...new Set(contract.agent.clients.map((c) => (c.startsWith('copilot') ? 'copilot' : 'claude')))];

const TOOL = { 'file.write': 'Write', 'file.read': 'Read', 'shell.exec': 'Bash', 'web.fetch': 'WebFetch', 'subagent.spawn': 'Task', 'mcp.call': 'mcp__fixture__tool' };

// --- Projet temporaire
function git(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a[0]} : ${r.stderr}`);
}
function writeFiles(root, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function makeProject(fx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-controls-fx-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixtures@agent-controls');
  git(root, 'config', 'user.name', 'fixtures');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFiles(root, fx.event === 'SubagentStop' ? fx.project?.baseline : fx.project?.files);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'baseline', '--allow-empty');
  ensureWorkspace(root); // .agent-controls/ ignoré par Git, comme en usage réel
  return root;
}

// --- Payload client à partir d'une fixture normalisée
function payload(client, fx, root, { agent, sessionId, agentId }) {
  const p = { session_id: sessionId, cwd: root, hook_event_name: fx.event, agent_id: agentId, agent_type: agent };
  if (fx.event === 'PreToolUse' || fx.event === 'PostToolUse') {
    p.tool_name = TOOL[fx.tool] || 'Unknown';
    const i = fx.input || {};
    if (fx.tool === 'shell.exec') p.tool_input = { command: i.command };
    else if (client === 'claude') p.tool_input = { file_path: i.path ? path.join(root, i.path) : undefined, content: i.content };
    else p.tool_input = { path: i.path, file_text: i.content }; // variante d'arguments côté Copilot
    if (fx.event === 'PostToolUse') p[client === 'claude' ? 'tool_response' : 'tool_result'] = { success: true };
  }
  if (fx.event === 'SubagentStop' || fx.event === 'Stop') p.stop_hook_active = false;
  if (fx.final_message) p.last_assistant_message = fx.final_message;
  return p;
}

function invoke(client, event, root, data, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.AGENT_CONTROLS_ROLE;
  if (client === 'claude') env.CLAUDE_PROJECT_DIR = root; else delete env.CLAUDE_PROJECT_DIR;
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [dispatch, client, event], { cwd: root, input: JSON.stringify(data), encoding: 'utf8', env, windowsHide: true, timeout: 300000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...r, ms };
}

// Décision observée + invariants de sortie
function observe(client, event, r) {
  const problems = [];
  if (r.error) problems.push(`échec d'exécution : ${r.error.message}`);
  if (r.status !== 0) problems.push(`code de sortie ${r.status}`);
  if (r.stderr) problems.push('écriture sur stderr');
  const out = (r.stdout || '').trim();
  if (!out) return { got: 'allow', problems };
  let o;
  try { o = JSON.parse(out); } catch { problems.push('stdout n\'est pas un unique objet JSON'); return { got: 'invalide', problems }; }
  if (o.hookSpecificOutput?.permissionDecision === 'deny' || o.permissionDecision === 'deny') return { got: 'deny', problems, reason: o.hookSpecificOutput?.permissionDecisionReason || o.permissionDecisionReason };
  if (o.decision === 'block') return { got: 'block', problems, reason: o.reason };
  if (client === 'copilot' && event === 'SubagentStop' && typeof o.modifiedResponse === 'string' && !o.decision) {
    if (!o.modifiedResponse.includes('[agent-controls]')) problems.push('réponse modifiée sans signal agent-controls');
    return { got: 'allow', problems, note: 'signal transmis au parent (modifiedResponse)' };
  }
  if (client === 'copilot' && event === 'PostToolUse' && o.additionalContext) return { got: 'block', problems, reason: o.additionalContext, note: 'signalé (Copilot ne bloque pas en PostToolUse)' };
  problems.push(`sortie inattendue : ${out.slice(0, 120)}`);
  return { got: 'invalide', problems };
}

// --- Exécution
const results = [];
const latency = {}; // client → event → [ms]
const record = (r) => { results.push(r); };
let seq = 0;

const cases = [
  ...contract.controls.flatMap((c) => c.fixtures.map((f) => ({ owner: c.id, event: c.event, f }))),
  ...(contract.reviewer?.fixtures || []).map((f) => ({ owner: 'reviewer', event: 'SubagentStop', f })),
  ...(contract.blocked_exit?.check?.fixtures || []).map((f) => ({ owner: 'blocked_exit', event: 'SubagentStop', f })),
];

for (const client of clients) {
  for (const { owner, event, f } of cases) {
    const fx = JSON.parse(fs.readFileSync(path.resolve(dir, f.input), 'utf8'));
    fx.event = fx.event || event;
    if (fx.live) { record({ client, owner, fixture: f.name, expect: f.expect, got: 'live', ok: true, skipped: true }); continue; } // revue réelle : live_review.mjs
    const root = makeProject(fx);
    try {
      const ids = { agent: contract.agent.name, sessionId: `fx-${++seq}`, agentId: `fx-agent-${seq}` };
      // Run déjà ouvert (baseline prise) : on mesure les appels en régime établi.
      if (fx.task) state.savePendingTask(root, ids.sessionId, contract.agent.name, fx.task);
      const run = state.getOrCreateRun({ projectDir: root, sessionId: ids.sessionId, agentId: ids.agentId, agent: contract.agent.name, contract: compiled, remaining: () => 30000 });
      if (fx.iteration > 1) { run.st.iteration = fx.iteration - 1; state.saveRun(run); }

      const extraEnv = {};
      if (event === 'SubagentStop') {
        writeFiles(root, fx.project?.files);
      } else if (event === 'PostToolUse' && fx.input?.path && typeof fx.input.content === 'string') {
        writeFiles(root, { [fx.input.path]: fx.input.content });
      }

      const data = payload(client, fx, root, ids);
      let r = invoke(client, event, root, data, extraEnv);
      let obs = observe(client, event, r);
      // Fixture du reviewer : on joue la suite comme le ferait le client — chaque reviewer écrit son verdict
      // (simulé) dans son dossier et se termine, puis le thread principal tente de conclure. La décision
      // observée est celle du Stop du thread principal : « allow » = validé, « block » = reprise ou escalade.
      if (owner === 'reviewer' && obs.got === 'allow') {
        const st = state.loadRun(root, run.id).st;
        if (st.status === 'awaiting_review') {
          for (const [lensName, lens] of Object.entries(st.review.lenses)) {
            const ids2 = new Set(active(compiled, st).criteria.filter((c) => !compiled.reviewer.lenses?.length || c.lens === lensName).map((c) => c.id));
            const mv = fx.mock_verdict || {};
            const verdict = typeof mv === 'string' ? mv
              : JSON.stringify({ version: 1, dossier: st.review.nonce, ...mv, criteria: (mv.criteria || []).filter((c) => ids2.has(c.id)) });
            writeFiles(root, { [lens.verdictPath]: verdict });
            const rr = invoke(client, 'SubagentStop', root, { session_id: ids.sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: `rev-${lensName}`, agent_type: lens.agent, stop_hook_active: false });
            const ro = observe(client, 'SubagentStop', rr);
            if (ro.problems.length) obs.problems.push(...ro.problems.map((x) => `reviewer ${lensName} : ${x}`));
          }
        }
        r = invoke(client, 'Stop', root, { session_id: ids.sessionId, cwd: root, hook_event_name: 'Stop', stop_hook_active: false });
        const problems = obs.problems;
        obs = observe(client, 'Stop', r);
        obs.problems.unshift(...problems);
      }
      // Le bon contrôle doit être à l'origine du blocage, pas un autre : on vérifie la raison.
      const mustContain = fx.reason_contains ?? (f.expect === 'allow' || owner === 'reviewer' ? null
        : owner === 'blocked_exit' ? 'Arrêt bloqué injustifié' : `[${owner}]`);
      if (mustContain && obs.got === f.expect && !(obs.reason || '').includes(mustContain)) {
        obs.problems.push(`la raison ne contient pas « ${mustContain} » : un autre contrôle a bloqué`);
      }
      if (event === 'SubagentStop') {
        const st = state.loadRun(root, run.id).st;
        if (fx.expect_status && st?.status !== fx.expect_status) obs.problems.push(`statut du run « ${st?.status} » au lieu de « ${fx.expect_status} »`);
        if (compiled.report?.path && st?.status !== 'running') {
          const rp = compiled.report.path.replaceAll('{agent}', compiled.agent.name).replaceAll('{date}', (st.created || '').slice(0, 10)).replaceAll('{run}', run.id);
          if (!fs.existsSync(path.join(root, rp))) obs.problems.push(`rapport de run absent : ${rp}`);
        }
      }
      const ok = obs.got === f.expect && !obs.problems.length;
      record({ client, owner, fixture: f.name, expect: f.expect, got: obs.got, ok, problems: obs.problems, note: obs.note, ms: Math.round(r.ms), reason: ok ? undefined : obs.reason });

      if (event === 'PreToolUse' || event === 'PostToolUse') {
        (latency[client] ??= {})[event] ??= [];
        latency[client][event].push(r.ms);
        for (let i = 1; i < samples; i++) latency[client][event].push(invoke(client, event, root, data, extraEnv).ms);
        // Isolation : le même appel venant d'un autre agent doit passer.
        if (f.expect !== 'allow') {
          const other = invoke(client, event, root, { ...data, agent_type: 'autre-agent', agent_id: 'autre' });
          const o2 = observe(client, event, other);
          record({ client, owner, fixture: `${f.name} (autre agent)`, expect: 'allow', got: o2.got, ok: o2.got === 'allow' && !o2.problems.length, problems: o2.problems, ms: Math.round(other.ms) });
        }
      }
    } catch (e) {
      record({ client, owner, fixture: f.name, expect: f.expect, got: 'erreur', ok: false, problems: [e.message] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

// --- Latences
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const budgets = [];
for (const [client, evs] of Object.entries(latency)) {
  for (const [event, arr] of Object.entries(evs)) {
    const budget = contract.runtime.budget_ms?.[event];
    const p50 = Math.round(pct(arr, 50));
    const p95 = Math.round(pct(arr, 95));
    budgets.push({ client, event, n: arr.length, p50, p95, budget: budget ?? null, ok: budget === undefined || p95 <= budget });
  }
}

// --- Rapport
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(`${pad('Client', 8)}${pad('Contrôle', 13)}${pad('Fixture', 34)}${pad('Attendu', 9)}${pad('Obtenu', 9)}${pad('ms', 6)}Résultat`);
for (const r of results) {
  console.log(`${pad(r.client, 8)}${pad(r.owner, 13)}${pad(r.fixture, 34)}${pad(r.expect, 9)}${pad(r.got, 9)}${pad(r.ms, 6)}${r.skipped ? 'revue réelle : live_review.mjs' : r.ok ? 'OK' : 'ÉCHEC'}${r.note ? ` — ${r.note}` : ''}`);
  for (const p of r.problems || []) console.log(`        ↳ ${p}`);
  if (!r.ok && r.reason) r.reason.split('\n').filter(Boolean).slice(0, 6).forEach((l) => console.log(`        ↳ ${l}`));
}
console.log('\nLatence (temps réel, démarrage de Node compris)');
for (const b of budgets) {
  console.log(`  ${pad(b.client, 8)}${pad(b.event, 13)}n=${pad(b.n, 4)}p50=${pad(`${b.p50} ms`, 9)}p95=${pad(`${b.p95} ms`, 9)}budget=${b.budget ?? '—'} ${b.ok ? 'OK' : 'DÉPASSÉ'}`);
}

const failed = results.filter((r) => !r.ok);
const over = budgets.filter((b) => !b.ok);
const report = {
  version: 1, at: new Date().toISOString(), plugin: name, plugin_version: contract.plugin.version,
  plugin_digest: digestDir(plugin), samples, live,
  passed: !failed.length && !over.length, results, latency: budgets,
};
fs.writeFileSync(path.join(dir, '.fixtures-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} vérification(s) réussie(s)${over.length ? `, ${over.length} budget(s) dépassé(s)` : ''}.`);
process.exit(report.passed ? 0 : 1);
