#!/usr/bin/env node
// Rapport de mesure à partir des logs locaux d'un projet.
//   node <plugin>/runtime/report.mjs [--project <dossier>] [--since <date>] [--by-version] [--all] [--json]
//   node <plugin>/runtime/report.mjs --blocks [--control <id>]          liste les blocages avec leur identifiant
//   node <plugin>/runtime/report.mjs --false-positive <id> [--note "…"]  annote un blocage injustifié
// Sans dépendance. Lit .agent-controls/.runs/*/events.jsonl ; n'écrit que les annotations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const opt = (k) => (has(k) ? args[args.indexOf(k) + 1] : undefined);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = (() => { try { return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'controls.json'), 'utf8')); } catch { return null; } })();
const project = path.resolve(opt('--project') || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const root = path.join(project, '.agent-controls', '.runs');
const annotationsFile = path.join(root, '_annotations.jsonl');
const agentFilter = has('--all') ? null : contract?.agent?.name || null;
const since = opt('--since') ? new Date(opt('--since')) : null;

if (!fs.existsSync(root)) { console.log(`Aucun log dans ${root}.`); process.exit(0); }

// --- Annotation d'un faux positif
if (has('--false-positive')) {
  const id = opt('--false-positive');
  if (!id || !/^[0-9a-f]{16}:\d+$/.test(id)) { console.log('Identifiant attendu au format <run>:<ligne> (voir --blocks).'); process.exit(2); }
  fs.appendFileSync(annotationsFile, `${JSON.stringify({ id, kind: 'false-positive', note: opt('--note') || '', ts: new Date().toISOString() })}\n`);
  console.log(`Blocage ${id} annoté comme faux positif.`);
  process.exit(0);
}

// --- Lecture des événements (identifiant stable : run + numéro de ligne, les logs ne sont qu'ajoutés)
const events = [];
for (const run of fs.readdirSync(root).filter((d) => !d.startsWith('_'))) {
  const f = path.join(root, run, 'events.jsonl');
  if (!fs.existsSync(f)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      if (agentFilter && e.agent !== agentFilter) return;
      if (since && new Date(e.ts) < since) return;
      events.push({ ...e, run, id: `${run}:${i + 1}` });
    } catch { /* ligne corrompue : ignorée */ }
  });
}
const falsePositives = new Set();
if (fs.existsSync(annotationsFile)) {
  for (const l of fs.readFileSync(annotationsFile, 'utf8').split('\n')) {
    try { const a = JSON.parse(l); if (a.kind === 'false-positive') falsePositives.add(a.id); } catch { /* ignore */ }
  }
}
const BLOCK = new Set(['deny', 'block', 'error-block']);

// --- Liste des blocages
if (has('--blocks')) {
  const ctl = opt('--control');
  const blocks = events.filter((e) => e.kind === 'control' && BLOCK.has(e.decision) && (!ctl || e.control === ctl));
  if (!blocks.length) { console.log('Aucun blocage.'); process.exit(0); }
  for (const e of blocks) {
    console.log(`${e.id}  ${e.ts.slice(0, 19)}  ${e.control.padEnd(13)} ${e.event.padEnd(13)} ${e.decision.padEnd(12)} ${e.target || ''}${falsePositives.has(e.id) ? '  [faux positif]' : ''}`);
  }
  console.log('\nAnnoter un blocage injustifié : report.mjs --false-positive <id> --note "pourquoi"');
  process.exit(0);
}

// --- Statistiques
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]); };
const rate = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '—');

function analyse(evts) {
  const controls = {};
  for (const e of evts.filter((x) => x.kind === 'control')) {
    const c = (controls[e.control] ??= { evaluations: 0, blocks: 0, errors: 0, falsePositives: 0, ms: [] });
    c.evaluations += 1;
    if (BLOCK.has(e.decision)) c.blocks += 1;
    if (e.decision?.startsWith('error')) c.errors += 1;
    if (falsePositives.has(e.id)) c.falsePositives += 1;
    if (typeof e.ms === 'number') c.ms.push(e.ms);
  }
  const latency = {};
  for (const e of evts.filter((x) => x.kind === 'dispatch' && typeof x.ms === 'number')) (latency[e.event] ??= []).push(e.ms);
  const runs = {};
  for (const e of evts.filter((x) => x.kind === 'run')) {
    const r = (runs[e.run] ??= { status: 'en cours', iterations: 0 });
    if (e.decision === 'passed') { r.status = 'validé'; r.iterations = e.iteration; }
    if (e.decision === 'escalated') { r.status = 'escaladé'; r.iterations = e.iteration; }
    if (e.decision === 'blocked') { r.status = 'bloqué'; r.iterations = e.iteration; }
    if (e.decision === 'rework_required') { r.status = 'reprise demandée'; r.iterations = e.iteration; }
    if (e.decision === 'awaiting_review') r.status = 'revue en attente';
  }
  const reviews = evts.filter((x) => x.kind === 'review');
  const criteria = {};
  for (const r of reviews) for (const id of r.failed || []) criteria[id] = (criteria[id] || 0) + 1;
  const unknownTools = {};
  for (const w of evts.filter((x) => x.kind === 'warning' && x.tool)) unknownTools[w.tool] = (unknownTools[w.tool] || 0) + 1;
  const passed = Object.values(runs).filter((r) => r.status === 'validé');
  return {
    controls, latency, criteria, unknownTools,
    runs: {
      total: Object.keys(runs).length,
      passed: passed.length,
      escalated: Object.values(runs).filter((r) => r.status === 'escaladé').length,
      blocked: Object.values(runs).filter((r) => r.status === 'bloqué').length,
      rework: Object.values(runs).filter((r) => r.status === 'reprise demandée').length,
      awaiting: Object.values(runs).filter((r) => r.status === 'revue en attente').length,
      open: Object.values(runs).filter((r) => r.status === 'en cours').length,
      meanIterationsToPass: passed.length ? +(passed.reduce((s, r) => s + r.iterations, 0) / passed.length).toFixed(2) : null,
      passedFirstTime: passed.filter((r) => r.iterations === 1).length,
    },
    observations: reviews.reduce((s, r) => s + (r.observations || []).length, 0),
    reviews: { total: reviews.filter((r) => ['done', 'error'].includes(r.decision)).length, refused: evts.filter((x) => x.kind === 'run' && x.decision === 'rework_required').length, failedToRun: reviews.filter((r) => r.decision === 'error').length, invalidVerdicts: reviews.filter((r) => r.decision === 'verdict-invalid').length, ms: reviews.map((r) => r.ms).filter((x) => typeof x === 'number') },
  };
}

const budgets = contract?.runtime?.budget_ms || {};
const summarise = (a) => ({
  runs: a.runs,
  controls: Object.fromEntries(Object.entries(a.controls).map(([id, c]) => [id, { ...c, ms: undefined, p50: pct(c.ms, 50), p95: pct(c.ms, 95) }])),
  latency: Object.fromEntries(Object.entries(a.latency).map(([ev, arr]) => [ev, { n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), budget: budgets[ev] ?? null }])),
  observations: a.observations,
  reviews: { ...a.reviews, ms: undefined, p50: pct(a.reviews.ms, 50), p95: pct(a.reviews.ms, 95), failedCriteria: a.criteria },
  unknownTools: a.unknownTools,
});

const groups = has('--by-version')
  ? Object.entries(events.reduce((g, e) => { (g[e.plugin || 'inconnue'] ??= []).push(e); return g; }, {}))
  : [['', events]];
const result = groups.map(([version, evts]) => ({ version: version || undefined, ...summarise(analyse(evts)) }));

if (has('--json')) { console.log(JSON.stringify({ project, agent: agentFilter, since: since?.toISOString(), groups: result }, null, 2)); process.exit(0); }

const pad = (s, n) => String(s ?? '—').padEnd(n);
console.log(`Projet : ${project}${agentFilter ? ` — agent : ${agentFilter}` : ''}${since ? ` — depuis ${since.toISOString().slice(0, 10)}` : ''}`);
for (const g of result) {
  if (g.version) console.log(`\n══ Version ${g.version}`);
  const r = g.runs;
  console.log(`\nRuns : ${r.total} — validés ${r.passed} (${r.passedFirstTime} du premier coup), escaladés ${r.escalated} (${rate(r.escalated, r.total)}), arrêts « bloqué » ${r.blocked}, reprises demandées ${r.rework}, revues en attente ${r.awaiting}, en cours ou interrompus ${r.open}`);
  if (r.meanIterationsToPass !== null) console.log(`Tentatives moyennes avant validation : ${r.meanIterationsToPass}`);

  console.log(`\n${pad('Contrôle', 14)}${pad('Évalué', 8)}${pad('Bloqué', 8)}${pad('Taux', 7)}${pad('Erreurs', 9)}${pad('Faux +', 11)}${pad('p50', 7)}p95 (ms)`);
  for (const [id, c] of Object.entries(g.controls).sort()) {
    console.log(`${pad(id, 14)}${pad(c.evaluations, 8)}${pad(c.blocks, 8)}${pad(rate(c.blocks, c.evaluations), 7)}${pad(c.errors, 9)}${pad(`${c.falsePositives}${c.blocks ? ` (${rate(c.falsePositives, c.blocks)})` : ''}`, 11)}${pad(c.p50, 7)}${c.p95 ?? '—'}`);
  }

  console.log('\nLatence interne du dispatcher (hors démarrage de Node, environ 40 ms à ajouter)');
  for (const [ev, l] of Object.entries(g.latency)) {
    console.log(`  ${pad(ev, 13)}n=${pad(l.n, 5)}p50=${pad(`${l.p50} ms`, 9)}p95=${pad(`${l.p95} ms`, 9)}budget=${l.budget ?? '—'}`);
  }

  const v = g.reviews;
  if (v.total) {
    console.log(`\nRevues (par lentille) : ${v.total} — reprises demandées ${v.refused}, lentilles sans verdict valide ${v.failedToRun}, verdicts à réécrire ${v.invalidVerdicts}`);
    const crit = Object.entries(v.failedCriteria).sort((a, b) => b[1] - a[1]);
    if (g.observations) console.log(`Observations non bloquantes (sévérité hors block_on) : ${g.observations}`);
    if (crit.length) console.log(`Critères les plus souvent en échec : ${crit.map(([id, n]) => `${id} (${n})`).join(', ')}`);
  }
  const unk = Object.entries(g.unknownTools);
  if (unk.length) console.log(`\nOutils non reconnus (aucun contrôle par catégorie ne s'y applique) : ${unk.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
}
console.log('\nPour annoter un faux positif : report.mjs --blocks, puis --false-positive <id>.');
