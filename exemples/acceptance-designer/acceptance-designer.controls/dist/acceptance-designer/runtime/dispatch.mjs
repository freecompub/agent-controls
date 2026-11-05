#!/usr/bin/env node
// Point d'entrée unique des hooks : node dispatch.mjs <claude|copilot> <Événement>
//
// Règles invariables :
// - stdout reçoit au plus UN objet JSON de décision ; rien d'autre n'y est écrit.
// - rien n'est écrit sur stderr (renvoyé à l'agent par les clients).
// - toute erreur est capturée ; la décision est toujours explicite, jamais laissée au plantage ou à l'expiration.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, isAgent, delegation } from './lib/normalize.mjs';
import { applicability, formatMessage, runCheck } from './lib/checks.mjs';
import { render } from './lib/output.mjs';
import { ensureWorkspace, makeLogger } from './lib/log.mjs';
import fs from 'node:fs';
import { getOrCreateRun, savePendingTask, consumeEscalations, latestRun, setLatestRun } from './lib/state.mjs';
import { reviewerAgentName } from './lib/reviewer.mjs';
import { onSubagentStop, onMainStop, onReviewerStop, pendingAction } from './lib/review.mjs';
import { mask, readJSON } from './lib/util.mjs';
import { baselineReader } from './lib/git.mjs';
import { active } from './lib/modes.mjs';

const T0 = Date.now();
const [client = 'claude', event = ''] = process.argv.slice(2);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_TIMEOUTS_S = { PreToolUse: 5, PostToolUse: 10, SubagentStop: 180, Stop: 5 };

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

let fallback = { type: 'allow' }; // décision appliquée si le délai interne expire ou si tout échoue
let logger = () => {};
let runIdForLog = null;

async function evaluate(controls, n, contract, run, remaining) {
  const blockers = [];
  for (const control of controls) {
    const a = applicability(control, n);
    if (!a.applies) continue;
    const t0 = Date.now();
    let decision;
    let error;
    try {
      if (a.error) throw new Error(a.error);
      const res = await runCheck(control, {
        projectDir: n.projectDir, pluginRoot, agent: contract.agent.name, event: n.event, tool: n.tool,
        paths: a.paths, content: n.input.content, command: n.input.command, remaining,
        baseline: baselineReader(n.projectDir, run.st.baseline),
      });
      decision = res.ok ? 'allow' : (n.event === 'PreToolUse' ? 'deny' : 'block');
      if (!res.ok) blockers.push(formatMessage(control, res.details, a.paths));
    } catch (e) {
      error = mask(String(e.message || e));
      decision = control.on_error === 'block' ? 'error-block' : 'error-allow';
      if (decision === 'error-block') blockers.push(formatMessage(control, error, a.paths, true));
    }
    logger(run.id, {
      kind: 'control', event: n.event, tool: n.toolName, target: a.paths.join(','),
      control: control.id, decision, error, iteration: run.st.iteration, ms: Date.now() - t0,
    });
  }
  return blockers;
}

function adoptPrepared(n, agent) {
  const f = path.join(n.projectDir, '.agent-controls', '.runs', '_prepared.json');
  const prep = readJSON(f);
  if (!prep || prep.agent !== agent) return null;
  try { fs.unlinkSync(f); } catch { return null; }
  setLatestRun(n.projectDir, n.sessionId, agent, prep.run);
  return latestRun(n.projectDir, n.sessionId, agent);
}

async function main() {
  if (process.env.AGENT_CONTROLS_ROLE) return { type: 'allow' }; // commande lancée par un contrôle run-command

  const contract = readJSON(path.join(pluginRoot, 'controls.json'));
  if (!contract) return { type: 'allow' }; // plugin incomplet : rien à appliquer (détecté par le gate de packaging)

  let payload = {};
  try { payload = JSON.parse((await readStdin()) || '{}'); } catch { payload = {}; }
  const n = normalize(client, event, payload);
  const agent = contract.agent.name;
  const timeoutS = contract.runtime?.hook_timeouts_s?.[event] ?? DEFAULT_TIMEOUTS_S[event] ?? 5;
  const deadline = T0 + timeoutS * 1000 - Math.min(2000, timeoutS * 200);
  const remaining = () => Math.max(1, deadline - Date.now());

  ensureWorkspace(n.projectDir);
  logger = makeLogger(n.projectDir, { session: n.sessionId, agent, client, plugin: contract.plugin?.version });

  const ours = isAgent(n.agentNames, agent);
  const lensNames = contract.reviewer ? (contract.reviewer.lenses?.length ? contract.reviewer.lenses.map((l) => l.name) : ['general']) : [];
  const lensOf = (names) => lensNames.find((l) => isAgent(names, reviewerAgentName(agent, l))) || null;

  // ── Thread principal
  if (!ours && !n.agentNames.length) {
    let run = latestRun(n.projectDir, n.sessionId, agent);
    if (!run) run = adoptPrepared(n, agent); // projet préparé par live_review.mjs : la session du client reprend le run
    if (event === 'PreToolUse' && n.tool === 'subagent.spawn') {
      const d = delegation(n);
      if (d.target && isAgent([d.target], agent)) savePendingTask(n.projectDir, n.sessionId, agent, d.prompt);
      const lens = d.target ? lensOf([d.target]) : null;
      if (lens) {
        // Le reviewer doit recevoir son dossier : sinon il jugerait sans ses entrées.
        const pending = run?.st?.status === 'awaiting_review' ? run.st.review.lenses[lens] : null;
        if (!pending || pending.status !== 'pending') {
          return { type: 'deny', reason: `[agent-controls] Aucune revue « ${lens} » en attente pour ${agent} : ce reviewer ne se lance que sur demande des contrôles.` };
        }
        if (!(d.prompt || '').includes(pending.dossier)) {
          return { type: 'deny', reason: `[agent-controls] Consigne incorrecte pour ${pending.agent}. Utilise exactement : « Dossier de revue : ${pending.dossier} »` };
        }
      }
      return { type: 'allow' };
    }
    if (event === 'PostToolUse' && n.tool === 'subagent.spawn') {
      // Retour d'un subagent : on rappelle aussitôt l'action attendue (Claude Code bloque, Copilot ajoute du contexte).
      const action = pendingAction(contract, run);
      return action ? { type: 'block', reason: action } : { type: 'allow' };
    }
    if (event === 'Stop') return onMainStop({ contract, n, run, escalations: consumeEscalations(n.projectDir, n.sessionId) });
    return { type: 'allow' };
  }

  // ── Reviewer du plugin : lecture libre, écriture limitée à son verdict
  const lens = !ours ? lensOf(n.agentNames) : null;
  if (lens) {
    if (event === 'SubagentStop') return onReviewerStop({ contract, n, lensName: lens, log: logger, pluginRoot });
    if (event === 'PreToolUse') {
      const run = latestRun(n.projectDir, n.sessionId, agent);
      const pending = run?.st?.review?.lenses?.[lens];
      const target = pending?.verdictPath;
      const allowed = n.tool === 'file.write' && target && n.input.paths.length && n.input.paths.every((p) => p === target);
      if (allowed) return { type: 'allow' };
      if (n.tool === 'file.read') return { type: 'allow' };
      return { type: 'deny', reason: `[agent-controls] Le reviewer ne peut écrire que ${target || 'son verdict'} ; toute autre action est refusée.` };
    }
    return { type: 'allow' };
  }
  if (!ours) return { type: 'allow' }; // autre subagent : pas concerné

  if (event === 'PreToolUse' || event === 'PostToolUse') {
    // Repli strict dès que possible : une panne plus loin ne doit pas laisser passer un contrôle on_error: block.
    if (contract.controls.some((c) => c.event === event && c.on_error === 'block' && applicability(c, n).applies)) {
      fallback = { type: event === 'PreToolUse' ? 'deny' : 'block', reason: '[agent-controls] Contrôle indisponible : action refusée par précaution.' };
    }
  }

  const run = getOrCreateRun({ projectDir: n.projectDir, sessionId: n.sessionId, agentId: n.agentId, agent, contract, remaining });
  runIdForLog = run.id;
  if (run.created) logger(run.id, { kind: 'run', event, decision: 'started', baseline: Boolean(run.st.baseline), task: Boolean(run.st.task), mode: run.st.mode, ms: run.st.baselineMs });

  if (event === 'SubagentStop') {
    fallback = { type: 'block', reason: '[agent-controls] Délai de revue dépassé. Termine à nouveau pour relancer la revue.' };
    return onSubagentStop({ contract, n, run, log: logger, pluginRoot, remaining });
  }

  if (event === 'PreToolUse' || event === 'PostToolUse') {
    if (n.tool === 'unknown') logger(run.id, { kind: 'warning', event, tool: n.toolName, message: 'outil non reconnu : aucun contrôle par catégorie ne s\'applique' });
    const controls = active(contract, run.st).controls.filter((c) => c.event === event);
    const blockers = await evaluate(controls, n, contract, run, remaining);
    if (!blockers.length) return { type: 'allow' };
    return { type: event === 'PreToolUse' ? 'deny' : 'block', reason: blockers.join('\n\n') };
  }

  return { type: 'allow' };
}

function finish(decision, extra = {}, exit = false) {
  const out = render(client, event, decision);
  logger(runIdForLog, { kind: 'dispatch', event, decision: decision?.type || 'allow', ms: Date.now() - T0, ...extra });
  process.exitCode = 0;
  const end = () => { if (exit) process.exit(0); };
  if (out) process.stdout.write(JSON.stringify(out), end); else end();
}

const contractForTimer = readJSON(path.join(pluginRoot, 'controls.json'));
const timeoutS = contractForTimer?.runtime?.hook_timeouts_s?.[event] ?? DEFAULT_TIMEOUTS_S[event] ?? 5;
let done = false;
const timer = setTimeout(() => {
  if (done) return;
  done = true;
  finish(fallback, { timeout: true }, true);
}, timeoutS * 1000 - Math.min(1000, timeoutS * 100));

main()
  .then((decision) => { if (!done) { done = true; clearTimeout(timer); finish(decision); } })
  .catch((e) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    finish(fallback.type === 'allow' ? { type: 'allow' } : fallback, { error: mask(String(e?.message || e)) });
  });
