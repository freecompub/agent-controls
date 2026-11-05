// Fin de l'agent contrôlé, revue par les agents reviewers du plugin, et verrou du thread principal.
//
// 1. L'agent contrôlé termine : contrôles rejoués ; en cas d'échec, il est bloqué dans son contexte.
// 2. S'ils passent : un dossier de revue par lentille est préparé, le run passe en « awaiting_review ».
// 3. Le thread principal ne peut pas conclure tant que les reviewers n'ont pas rendu un verdict valide.
// 4. Chaque reviewer écrit verdict.json ; à la dernière lentille, le statut est recalculé : validé,
//    reprise demandée (nouvelle délégation de l'agent) ou escalade.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { baselineReader, changedFiles, diff, snapshot } from './git.mjs';
import { applicability, formatMessage, runCheck } from './checks.mjs';
import { latestRun, saveEscalation, saveRun } from './state.mjs';
import { lensesOf, reviewerAgentName, writeBundle } from './reviewer.mjs';
import { validateVerdict } from './verdict.mjs';
import { mask } from './util.mjs';
import { active, isBlockedExit, lastAssistantText } from './modes.mjs';
import { writeRunReport } from './runreport.mjs';
import { globToRegExp } from './glob.mjs';

const DEBUG = process.env.AGENT_CONTROLS_DEBUG === '1';
const MAX_VERDICT_ATTEMPTS = 2;

// ───────────────────────────── 1-2. Fin de l'agent contrôlé

export async function onSubagentStop({ contract, n, run, log, pluginRoot, remaining }) {
  const st = run.st;
  const agent = contract.agent.name;
  const max = contract.runtime?.max_iterations ?? 3;
  if (['escalated', 'awaiting_review', 'passed', 'blocked'].includes(st.status)) return { type: 'allow' };

  const blockers = [];
  const report = { controls: [], lenses: [], observations: [] };
  const fail = (id, message) => { blockers.push(message); report.controls.push({ id, message }); };
  const iteration = st.iteration + 1;

  if (!st.baseline) {
    return escalate({ contract, n, run, log, iteration, findings: [`Pas de baseline : ${st.baselineError || 'inconnue'}.`], report });
  }
  let now; let changed = []; let diffText = '';
  try {
    now = snapshot(n.projectDir, path.join(run.dir, 'now.index'), Math.max(1000, remaining() - 1000));
    const own = contract.report?.path ? globToRegExp(contract.report.path.replace(/\{[a-z]+\}/g, '*')) : null;
    changed = changedFiles(n.projectDir, st.baseline, now).filter((p) => !own || !own.test(p));
    diffText = diff(n.projectDir, st.baseline, now, undefined, own ? [contract.report.path.split('{')[0]] : []);
  } catch (e) {
    fail('agent-controls', `[agent-controls] Impossible de calculer le diff : ${mask(e.message)}`);
  }

  // Sortie bloquée légitime : pas de revue d'un travail volontairement non fait.
  const { controls, criteria } = active(contract, st);
  if (!blockers.length && contract.blocked_exit) {
    const message = n.finalMessage || lastAssistantText(n.transcriptPath);
    if (isBlockedExit(contract, message)) {
      const justification = await checkBlocked({ contract, n, pluginRoot, message, changed, baseline: baselineReader(n.projectDir, st.baseline) });
      const permitted = (contract.blocked_exit.allowed_changes || []).map((g) => globToRegExp(g));
      const unexpected = changed.filter((p) => !permitted.some((re) => re.test(p)));
      if (contract.blocked_exit.require_no_changes !== false && unexpected.length) {
        fail('blocked_exit', `[agent-controls] Arrêt « bloqué » déclaré, mais des fichiers ont été modifiés : ${unexpected.join(', ')}. Annule ces modifications ou termine le travail.`);
      } else if (!justification.ok) {
        fail('blocked_exit', `[agent-controls] Arrêt bloqué injustifié : ${mask(justification.details)}. Reprends le travail.`);
        log(run.id, { kind: 'control', event: 'SubagentStop', control: 'blocked_exit', decision: 'block', iteration });
      } else {
        st.iteration = iteration;
        st.status = 'blocked';
        saveRun(run);
        log(run.id, { kind: 'run', event: 'SubagentStop', decision: 'blocked', iteration });
        writeRunReport({ contract, run, projectDir: n.projectDir, status: 'blocked', iteration, ...report });
        return { type: 'allow' };
      }
    }
  }

  // Contrôles rejoués sur les fichiers modifiés : PostToolUse (indispensable sous Copilot) et SubagentStop.
  for (const control of controls.filter((c) => c.event === 'PostToolUse' || c.event === 'SubagentStop')) {
    if (control.event === 'PostToolUse' && control.match?.tools && !control.match.tools.includes('file.write')) continue;
    const a = applicability(control, n, changed);
    if (!a.applies || (control.event === 'PostToolUse' && !a.paths.length)) continue;
    const t0 = Date.now();
    let decision;
    try {
      const res = await runCheck(control, {
        projectDir: n.projectDir, pluginRoot, agent, event: 'SubagentStop', tool: 'file.write',
        paths: a.paths, content: null, command: null, changed, remaining,
        baseline: baselineReader(n.projectDir, st.baseline),
      });
      decision = res.ok ? 'allow' : 'block';
      if (!res.ok) fail(control.id, formatMessage(control, res.details, a.paths));
    } catch (e) {
      decision = control.on_error === 'block' ? 'error-block' : 'error-allow';
      if (decision === 'error-block') fail(control.id, formatMessage(control, e.message, a.paths, true));
      log(run.id, { kind: 'control', event: 'SubagentStop', control: control.id, decision, error: mask(e.message), iteration, ms: Date.now() - t0 });
      continue;
    }
    log(run.id, { kind: 'control', event: 'SubagentStop', control: control.id, decision, target: a.paths.join(','), iteration, ms: Date.now() - t0 });
  }

  st.iteration = iteration;
  if (blockers.length) {
    // Échec déterministe : correction dans le contexte de l'agent, sans payer de revue.
    if (iteration >= max) return escalate({ contract, n, run, log, iteration, findings: blockers, report });
    saveRun(run);
    writeRunReport({ contract, run, projectDir: n.projectDir, status: 'refused', iteration, ...report });
    return {
      type: 'block',
      reason: [`[agent-controls] Travail refusé (tentative ${iteration}/${max}). Corrige ces points, puis termine à nouveau :`, '', ...blockers].join('\n'),
    };
  }

  // Pas de reviewer, ou aucun critère actif : validé.
  if (!contract.reviewer || !criteria.length) {
    st.status = 'passed';
    saveRun(run);
    log(run.id, { kind: 'run', event: 'SubagentStop', decision: 'passed', iteration });
    writeRunReport({ contract, run, projectDir: n.projectDir, status: 'passed', iteration, ...report });
    return { type: 'allow' };
  }

  // Revue : un dossier par lentille, puis le thread principal doit lancer les reviewers.
  const round = (st.review?.round || 0) + 1;
  const nonce = crypto.randomBytes(8).toString('hex');
  const lenses = {};
  for (const lens of lensesOf(contract.reviewer, criteria)) {
    const dir = path.join(run.dir, `review-${round}`, lens.name);
    const b = writeBundle({ dir, projectDir: n.projectDir, agent, lens, task: st.task, diffText, changed, pluginRoot, nonce });
    lenses[lens.name] = { agent: reviewerAgentName(agent, lens.name), ...b, status: 'pending', attempts: 0 };
  }
  st.status = 'awaiting_review';
  st.review = { round, nonce, snapshot: now, lenses, started: new Date().toISOString() };
  saveRun(run);
  log(run.id, { kind: 'run', event: 'SubagentStop', decision: 'awaiting_review', lenses: Object.keys(lenses), iteration });
  writeRunReport({ contract, run, projectDir: n.projectDir, status: 'awaiting_review', iteration, ...report });
  return { type: 'allow', response: `${n.finalMessage ? `${n.finalMessage}\n\n` : ''}${pendingAction(contract, run)}` };
}

// ───────────────────────────── 4. Fin d'un reviewer

export async function onReviewerStop({ contract, n, lensName, log, pluginRoot }) {
  const run = latestRun(n.projectDir, n.sessionId, contract.agent.name);
  const lens = run?.st?.review?.lenses?.[lensName];
  if (!run || run.st.status !== 'awaiting_review' || !lens || lens.status !== 'pending') return { type: 'allow' };
  const st = run.st;
  const criteria = active(contract, st).criteria.filter((c) => (contract.reviewer.lenses?.length ? c.lens === lensName : true));

  let problem = null;
  let verdict = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(n.projectDir, lens.verdictPath), 'utf8'));
    if (raw?.dossier !== st.review.nonce) problem = 'le champ « dossier » ne correspond pas à ce dossier de revue';
    else {
      verdict = validateVerdict(raw, criteria);
      if (!verdict.valid) problem = verdict.error;
    }
  } catch (e) {
    problem = e.code === 'ENOENT' ? `verdict absent : ${lens.verdictPath}` : `verdict illisible (${e.message})`;
  }
  // Le reviewer ne doit rien modifier dans le projet.
  if (!problem) {
    try {
      const after = snapshot(n.projectDir, path.join(run.dir, `after-${lensName}.index`), 20000);
      if (after !== st.review.snapshot) {
        // Les rapports de run, écrits par le runtime lui-même, ne comptent pas.
        const own = contract.report?.path ? globToRegExp(contract.report.path.replace(/\{[a-z]+\}/g, '*')) : null;
        const touched = changedFiles(n.projectDir, st.review.snapshot, after).filter((p) => !own || !own.test(p));
        if (touched.length) problem = `le projet a été modifié pendant la revue : ${touched.slice(0, 5).join(', ')}`;
      }
    } catch { /* l'intégrité reste vérifiée par les hooks d'écriture */ }
  }

  if (problem) {
    lens.attempts += 1;
    if (lens.attempts < MAX_VERDICT_ATTEMPTS && !/modifié pendant la revue/.test(problem)) {
      saveRun(run);
      log(run.id, { kind: 'review', event: 'SubagentStop', lens: lensName, decision: 'verdict-invalid', error: problem });
      return { type: 'block', reason: `[agent-controls] Verdict invalide : ${problem}. Relis ${lens.promptFile} et réécris ${lens.verdictPath}.` };
    }
    lens.status = 'error';
    lens.error = problem;
  } else {
    lens.status = 'done';
    lens.result = { failed: verdict.failed, passed: verdict.passed, inconclusive: verdict.inconclusive };
  }
  log(run.id, { kind: 'review', event: 'SubagentStop', lens: lensName, decision: lens.status, error: lens.error, failed: lens.result?.failed.map((f) => f.id), inconclusive: lens.result?.inconclusive.map((f) => f.id) });
  saveRun(run);
  if (Object.values(st.review.lenses).some((l) => l.status === 'pending')) return { type: 'allow' };
  const outcome = conclude({ contract, n, run, log, criteria: active(contract, st).criteria });
  return { type: 'allow', response: outcome };
}

/** Toutes les lentilles ont rendu : statut recalculé à partir des findings, jamais lu dans le verdict. */
function conclude({ contract, n, run, log, criteria }) {
  const st = run.st;
  const r = contract.reviewer;
  const blockOn = new Set(r.block_on || ['blocker', 'high', 'medium']);
  const policy = r.on_inconclusive || 'escalate';
  const max = contract.runtime?.max_iterations ?? 3;
  const report = { controls: [], lenses: [], observations: [] };
  const blockers = [];
  const toEscalate = [];
  for (const [name, lens] of Object.entries(st.review.lenses)) {
    if (lens.status === 'error') {
      blockers.push(`[agent-controls] La revue « ${name} » n'a pas abouti : ${lens.error}.`);
      report.lenses.push({ name, status: 'error', error: lens.error, findings: [] });
      continue;
    }
    const findings = [];
    let failing = false;
    const describe = (f, answer) => {
      const c = criteria.find((x) => x.id === f.id);
      const sev = c?.severity || 'high';
      findings.push({ criterion: f.id, severity: sev, answer, question: c?.question || '', evidence: f.evidence.map((e) => ({ ...e, note: mask(e.note) })) });
      const where = f.evidence.map((e) => `  → ${e.path}${e.line ? `:${e.line}` : ''} — ${mask(e.note)}`).join('\n');
      return { sev, text: `[${f.id}] (${sev}${answer === 'inconclusive' ? ', indéterminé' : ''}) ${c?.question || ''}\n${where}` };
    };
    for (const f of lens.result.failed) {
      const { sev, text } = describe(f, 'no');
      if (blockOn.has(sev)) { blockers.push(text); failing = true; } else report.observations.push(text);
    }
    for (const f of lens.result.inconclusive) {
      const { text } = describe(f, 'inconclusive');
      if (policy === 'block') { blockers.push(text); failing = true; } else if (policy === 'observe') report.observations.push(text); else toEscalate.push(text);
    }
    report.lenses.push({ name, status: failing ? 'fail' : lens.result.inconclusive.length ? 'inconclusive' : 'pass', findings });
  }
  if (report.observations.length) {
    try { fs.writeFileSync(path.join(run.dir, `observations-${st.review.round}.md`), report.observations.join('\n\n')); } catch { /* ignore */ }
  }
  const iteration = st.iteration;
  if (toEscalate.length) {
    escalate({ contract, n, run, log, iteration, findings: [...blockers, ...toEscalate], report, reason: 'indéterminé' });
    return `[agent-controls] ESCALADE (indéterminé) — revue de ${contract.agent.name} terminée sans pouvoir juger certains critères.`;
  }
  if (!blockers.length) {
    st.status = 'passed';
    saveRun(run);
    log(run.id, { kind: 'run', event: 'review', decision: 'passed', iteration });
    writeRunReport({ contract, run, projectDir: n.projectDir, status: 'passed', iteration, ...report });
    return `[agent-controls] Revue de ${contract.agent.name} validée.`;
  }
  if (iteration >= max) {
    escalate({ contract, n, run, log, iteration, findings: blockers, report });
    return `[agent-controls] ESCALADE — revue de ${contract.agent.name} refusée après ${iteration} tentative(s).`;
  }
  st.status = 'rework_required';
  st.findings = blockers.join('\n\n');
  saveRun(run);
  try { fs.writeFileSync(path.join(run.dir, 'findings.md'), st.findings); } catch { /* ignore */ }
  st.reportPath = writeRunReport({ contract, run, projectDir: n.projectDir, status: 'rework_required', iteration, ...report });
  saveRun(run);
  log(run.id, { kind: 'run', event: 'review', decision: 'rework_required', iteration });
  return pendingAction(contract, run);
}

// ───────────────────────────── 3. Ce que le thread principal doit faire

/** Action en attente pour le thread principal, ou null. */
export function pendingAction(contract, run) {
  const st = run?.st;
  if (!st) return null;
  const agent = contract.agent.name;
  if (st.status === 'awaiting_review') {
    const todo = Object.values(st.review.lenses).filter((l) => l.status === 'pending');
    return [
      `[agent-controls] Le travail de ${agent} doit être revu avant de continuer. Lance ces reviewers (subagents du plugin), en parallèle si possible :`,
      ...todo.map((l) => `- subagent « ${l.agent} », consigne exacte : « Dossier de revue : ${l.dossier} »`),
      'N\'interprète pas leurs verdicts : ils sont enregistrés automatiquement.',
    ].join('\n');
  }
  if (st.status === 'rework_required') {
    const max = contract.runtime?.max_iterations ?? 3;
    return [
      `[agent-controls] La revue de ${agent} a refusé le travail (tentative ${st.iteration}/${max}). Relance le subagent « ${agent} » pour une reprise, en lui transmettant ces points${st.reportPath ? ` (rapport : ${st.reportPath})` : ''} :`,
      '', st.findings || '',
    ].join('\n');
  }
  return null;
}

export function onMainStop({ contract, n, run, escalations }) {
  const action = pendingAction(contract, run);
  if (action) return { type: 'block', reason: `${action}\n\nNe conclus pas avant que ce soit fait.` };
  if (!escalations.length) return { type: 'allow' };
  const parts = escalations.map((e) =>
    `L'agent ${e.agent} n'a pas passé ses contrôles (${e.reason || 'tentatives épuisées'}, ${e.iteration} tentative(s), run ${e.run})${e.report ? `. Rapport : ${e.report}` : ''}. Points en suspens :\n\n${e.findings}`);
  return {
    type: 'block',
    reason: ['[agent-controls] Escalade : ne conclus pas comme si le travail était validé.',
      'Présente ces points à l\'utilisateur et demande-lui comment poursuivre.', '', ...parts].join('\n'),
  };
}

// ───────────────────────────── Utilitaires

async function checkBlocked({ contract, n, pluginRoot, message, changed, baseline }) {
  const c = contract.blocked_exit?.check;
  if (!c) return { ok: true };
  try {
    const mod = await import(pathToFileURL(path.join(pluginRoot, c.module)).href);
    const res = await mod.default({
      message, changed, baseline, projectDir: n.projectDir, params: c.params || {},
      fs: {
        exists: (p) => fs.existsSync(path.join(n.projectDir, p)),
        readText: (p) => fs.readFileSync(path.join(n.projectDir, p), 'utf8'),
        list: (d) => fs.readdirSync(path.join(n.projectDir, d)),
      },
    });
    if (!res || typeof res.ok !== 'boolean') return { ok: false, details: `${c.module} a retourné une valeur invalide` };
    return res;
  } catch (e) {
    return { ok: false, details: `vérification impossible (${e.message})` };
  }
}

function escalate({ contract, n, run, log, iteration, findings, report = { controls: [], lenses: [], observations: [] }, reason = 'tentatives épuisées' }) {
  const st = run.st;
  st.iteration = iteration;
  st.status = 'escalated';
  saveRun(run);
  const text = findings.join('\n\n');
  try { fs.writeFileSync(path.join(run.dir, 'findings.md'), text); } catch { /* ignore */ }
  const reportRel = writeRunReport({ contract, run, projectDir: n.projectDir, status: 'escalated', iteration, ...report });
  saveEscalation(n.projectDir, n.sessionId, run.id, { agent: contract.agent.name, run: run.id, iteration, reason, report: reportRel, findings: text });
  log(run.id, { kind: 'run', decision: 'escalated', reason, iteration });
  const signal = `[agent-controls] ESCALADE (${reason}) — le travail de ${contract.agent.name} n'est pas validé.${reportRel ? ` Rapport : ${reportRel}` : ''}`;
  return { type: 'allow', response: `${n.finalMessage ? `${n.finalMessage}\n\n` : ''}${signal}\n\n${text}` };
}

export { DEBUG };
