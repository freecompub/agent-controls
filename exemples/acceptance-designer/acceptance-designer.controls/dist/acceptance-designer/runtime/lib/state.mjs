// État d'un run : une exécution d'un subagent contrôlé dans une session.
import fs from 'node:fs';
import path from 'node:path';
import { hash, readJSON, writeJSONAtomic } from './util.mjs';
import { runsDir } from './log.mjs';
import { isRepo, snapshot } from './git.mjs';
import { detectMode } from './modes.mjs';

export const runIdFor = (sessionId, agentId) => hash(`${sessionId}|${agentId || 'principal'}`);

export function loadRun(projectDir, runId) {
  const dir = path.join(runsDir(projectDir), runId);
  return { id: runId, dir, st: readJSON(path.join(dir, 'state.json')) };
}

export function saveRun(run) {
  writeJSONAtomic(path.join(run.dir, 'state.json'), run.st);
}

/** Récupère le run, ou le crée (baseline Git + consigne en attente). Sûr en cas d'appels concurrents. */
export function getOrCreateRun({ projectDir, sessionId, agentId, agent, contract, remaining }) {
  const id = runIdFor(sessionId, agentId);
  const dir = path.join(runsDir(projectDir), id);
  const sp = path.join(dir, 'state.json');
  const existing = readJSON(sp);
  if (existing) return { id, dir, st: existing, created: false };
  // Reprise : si le run précédent de cet agent dans la session attend une reprise, le nouveau run en hérite
  // (même baseline, même compteur) pour que la revue suivante juge le travail cumulé.
  const prev = latestRun(projectDir, sessionId, agent);
  const inherit = prev?.st?.status === 'rework_required' ? prev : null;

  fs.mkdirSync(dir, { recursive: true });
  const st = {
    run: id, session: sessionId, agentId, agent,
    created: new Date().toISOString(), iteration: 0, status: 'running',
    baseline: null, baselineError: null, task: null, previous: inherit?.id || null,
  };
  const t0 = Date.now();
  if (inherit) {
    st.baseline = inherit.st.baseline;
    st.baselineError = inherit.st.baselineError;
    st.iteration = inherit.st.iteration;
  } else if (isRepo(projectDir)) {
    try { st.baseline = snapshot(projectDir, path.join(dir, 'baseline.index'), Math.max(1000, remaining() - 200)); }
    catch (e) { st.baselineError = String(e.message || e); }
  } else {
    st.baselineError = 'le projet n\'est pas un dépôt Git';
  }
  st.baselineMs = Date.now() - t0;
  st.task = consumePendingTask(projectDir, sessionId, agent);
  st.mode = detectMode(contract, st.task);

  try {
    fs.writeFileSync(sp, JSON.stringify(st, null, 2), { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return { id, dir, st: readJSON(sp), created: false };
    throw e;
  }
  if (inherit) { inherit.st.status = 'superseded'; inherit.st.superseded_by = id; saveRun(inherit); }
  setLatestRun(projectDir, sessionId, agent, id);
  purge(projectDir, contract.runtime?.logs || {});
  return { id, dir, st, created: true };
}

// --- Index de session : dernier run de chaque agent contrôlé, pour les hooks du thread principal et des reviewers.

const sessionFile = (projectDir, sessionId) => path.join(runsDir(projectDir), '_sessions', `${hash(sessionId, 12)}.json`);

export function setLatestRun(projectDir, sessionId, agent, runId) {
  const f = sessionFile(projectDir, sessionId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const idx = readJSON(f, {});
  idx[agent] = runId;
  writeJSONAtomic(f, idx);
}

export function latestRun(projectDir, sessionId, agent) {
  const runId = readJSON(sessionFile(projectDir, sessionId), {})[agent];
  if (!runId) return null;
  const run = loadRun(projectDir, runId);
  return run.st ? run : null;
}

// --- Consignes de délégation : capturées côté thread principal, consommées à la création du run.

const pendingDir = (projectDir) => path.join(runsDir(projectDir), '_pending');

export function savePendingTask(projectDir, sessionId, agent, prompt) {
  const dir = pendingDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${hash(sessionId, 8)}-${hash(agent, 8)}-${Date.now()}-${process.pid}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ prompt }));
}

function consumePendingTask(projectDir, sessionId, agent) {
  try {
    const dir = pendingDir(projectDir);
    const prefix = `${hash(sessionId, 8)}-${hash(agent, 8)}-`;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const data = readJSON(p);
        fs.unlinkSync(p); // consommation : celui qui supprime le fichier le possède
        return data?.prompt ?? null;
      } catch { /* pris par un autre processus */ }
    }
  } catch { /* aucun */ }
  return null;
}

// --- Escalades : écrites par SubagentStop, consommées par le Stop du thread principal.

const escDir = (projectDir) => path.join(runsDir(projectDir), '_escalations');

export function saveEscalation(projectDir, sessionId, runId, data) {
  const dir = escDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hash(sessionId, 8)}-${runId}.json`), JSON.stringify(data));
}

export function consumeEscalations(projectDir, sessionId) {
  const out = [];
  try {
    const dir = escDir(projectDir);
    const prefix = `${hash(sessionId, 8)}-`;
    for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(prefix))) {
      const p = path.join(dir, f);
      const data = readJSON(p);
      try { fs.unlinkSync(p); if (data) out.push(data); } catch { /* déjà consommé */ }
    }
  } catch { /* aucun */ }
  return out;
}

// --- Rétention

function purge(projectDir, { retention_runs = 50, retention_days = 14 }) {
  try {
    const root = runsDir(projectDir);
    const now = Date.now();
    const runs = fs.readdirSync(root)
      .filter((d) => !d.startsWith('_'))
      .map((d) => ({ d, t: fs.statSync(path.join(root, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    runs.forEach((r, i) => {
      if (i >= retention_runs || now - r.t > retention_days * 86400000) {
        fs.rmSync(path.join(root, r.d), { recursive: true, force: true });
      }
    });
  } catch { /* best effort */ }
}
