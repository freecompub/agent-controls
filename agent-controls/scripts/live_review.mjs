#!/usr/bin/env node
// Revue réelle des fixtures live, exécutée par le client lui-même (ni CLI en mode script, ni SDK, ni API).
//
//   node live_review.mjs prepare <controls.yaml> <dossier>
//     Crée un projet par fixture live, dans l'état « revue en attente » : agent terminé, contrôles passés,
//     dossiers de revue écrits. Il reste à ouvrir le client dans chaque projet, plugin installé, et à lui
//     demander de terminer : le verrou du thread principal impose de lancer les reviewers.
//
//   node live_review.mjs collect <controls.yaml> <dossier>
//     Lit le résultat de chaque projet, le compare à l'attendu et écrit .live-report.json pour le gate.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadContract } from './lib/contract.mjs';
import { reviewerDigest } from './lib/reviewdigest.mjs';

const [mode, target, outDir] = process.argv.slice(2);
if (!['prepare', 'collect'].includes(mode) || !target || !outDir) {
  console.error('usage : node live_review.mjs prepare|collect <controls.yaml> <dossier>');
  process.exit(2);
}
const { contract, dir, errors } = loadContract(target);
if (errors.length) { errors.forEach((e) => console.log(`ERREUR ${e}`)); process.exit(1); }
const name = contract.plugin.name || contract.agent.name;
const plugin = path.join(dir, 'dist', name);
const compiled = JSON.parse(fs.readFileSync(path.join(plugin, 'controls.json'), 'utf8'));
const lives = (contract.reviewer?.fixtures || [])
  .map((f) => ({ f, fx: JSON.parse(fs.readFileSync(path.resolve(dir, f.input), 'utf8')) }))
  .filter((x) => x.fx.live);
if (!lives.length) { console.log('Aucune fixture live dans le contrat.'); process.exit(1); }
const root = path.resolve(outDir);

if (mode === 'prepare') {
  const state = await import(pathToFileURL(path.join(plugin, 'runtime', 'lib', 'state.mjs')).href);
  const log = await import(pathToFileURL(path.join(plugin, 'runtime', 'lib', 'log.mjs')).href);
  fs.mkdirSync(root, { recursive: true });
  for (const { f, fx } of lives) {
    const p = path.join(root, f.name);
    fs.rmSync(p, { recursive: true, force: true });
    fs.mkdirSync(p, { recursive: true });
    const git = (...a) => spawnSync('git', a, { cwd: p, encoding: 'utf8' });
    const put = (files = {}) => Object.entries(files).forEach(([r, c]) => { fs.mkdirSync(path.dirname(path.join(p, r)), { recursive: true }); fs.writeFileSync(path.join(p, r), c); });
    git('init', '-q'); git('config', 'user.email', 'live@agent-controls'); git('config', 'user.name', 'live');
    put(fx.project?.baseline); git('add', '-A'); git('commit', '-qm', 'baseline', '--allow-empty');
    log.ensureWorkspace(p);
    if (fx.task) state.savePendingTask(p, 'live-prepare', contract.agent.name, fx.task);
    const run = state.getOrCreateRun({ projectDir: p, sessionId: 'live-prepare', agentId: 'live', agent: contract.agent.name, contract: compiled, remaining: () => 30000 });
    put(fx.project?.files);
    // Fin de l'agent, telle que le client la signalerait : contrôles rejoués, dossiers de revue écrits.
    const r = spawnSync(process.execPath, [path.join(plugin, 'runtime', 'dispatch.mjs'), 'claude', 'SubagentStop'], {
      cwd: p, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: p },
      input: JSON.stringify({ session_id: 'live-prepare', cwd: p, hook_event_name: 'SubagentStop', agent_id: 'live', agent_type: contract.agent.name }),
    });
    const st = state.loadRun(p, run.id).st;
    if (st.status !== 'awaiting_review') {
      console.log(`✗ ${f.name} : la fixture ne passe pas les contrôles (${st.status}) — ${(r.stdout || '').slice(0, 200)}`);
      continue;
    }
    fs.writeFileSync(path.join(p, '.agent-controls', '.runs', '_prepared.json'), JSON.stringify({ agent: contract.agent.name, run: run.id }));
    fs.writeFileSync(path.join(p, '.agent-controls', 'live-fixture.json'), JSON.stringify({ fixture: f.name, expect: f.expect, reason_contains: fx.reason_contains || null, run: run.id }));
    console.log(`✓ ${f.name} : revue en attente (${Object.keys(st.review.lenses).join(', ')})`);
  }
  console.log(`
Pour chaque projet sous ${root} :
  1. ouvre le client (Claude Code ou Copilot) dans le dossier, avec le plugin ${name} installé ;
  2. écris : « Termine le travail en cours. »
     Le verrou du thread principal impose de lancer les reviewers ; laisse-le faire jusqu'au bout,
     sans relancer l'agent ${contract.agent.name} si une reprise est demandée.
Puis : node live_review.mjs collect ${target} ${outDir}`);
  process.exit(0);
}

// collect
const results = [];
for (const { f } of lives) {
  const p = path.join(root, f.name);
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(p, '.agent-controls', 'live-fixture.json'), 'utf8')); } catch { return null; } })();
  if (!meta) { results.push({ fixture: f.name, ok: false, problem: 'projet non préparé' }); continue; }
  const st = JSON.parse(fs.readFileSync(path.join(p, '.agent-controls', '.runs', meta.run, 'state.json'), 'utf8'));
  const got = st.status === 'passed' ? 'allow' : ['rework_required', 'escalated'].includes(st.status) ? 'block' : st.status;
  const findings = (() => { try { return fs.readFileSync(path.join(p, '.agent-controls', '.runs', meta.run, 'findings.md'), 'utf8'); } catch { return st.findings || ''; } })();
  const problems = [];
  if (got === 'awaiting_review') problems.push('revue non effectuée');
  else if (got !== meta.expect) problems.push(`attendu ${meta.expect}, obtenu ${got} (${st.status})`);
  if (meta.reason_contains && got === 'block' && !findings.includes(meta.reason_contains)) problems.push(`les findings ne contiennent pas ${meta.reason_contains}`);
  const lenses = Object.fromEntries(Object.entries(st.review?.lenses || {}).map(([k, v]) => [k, v.status]));
  results.push({ fixture: f.name, expect: meta.expect, got, status: st.status, lenses, ok: !problems.length, problems });
  console.log(`${problems.length ? '✗' : '✓'} ${f.name.padEnd(28)} attendu ${meta.expect.padEnd(6)} obtenu ${String(got).padEnd(16)} ${problems.join(' ; ')}`);
}
const passed = results.every((r) => r.ok);
fs.writeFileSync(path.join(dir, '.live-report.json'), JSON.stringify({ version: 1, at: new Date().toISOString(), reviewer_digest: reviewerDigest(plugin), passed, results }, null, 2));
console.log(`\nRevue réelle : ${results.filter((r) => r.ok).length}/${results.length} fixture(s) conforme(s). Rapport : .live-report.json`);
process.exit(passed ? 0 : 1);
