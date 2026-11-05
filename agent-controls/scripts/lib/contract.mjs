// Chargement et validation complète d'un contrat : schéma + règles croisées.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from '../vendor/js-yaml.mjs';
import { validate } from './jsonschema.mjs';
import { readAgent } from './agentfile.mjs';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const EXPECT = { PreToolUse: ['allow', 'deny'], PostToolUse: ['allow', 'block'], SubagentStop: ['allow', 'block'], Stop: ['allow', 'block'] };
const BLOCKING = new Set(['deny', 'block']);

function compileRegex(pattern) {
  const m = /^\(\?([ims]+)\)/.exec(pattern);
  return m ? new RegExp(pattern.slice(m[0].length), m[1]) : new RegExp(pattern);
}

export function loadContract(contractPath) {
  const errors = [];
  const warnings = [];
  const file = path.resolve(contractPath);
  const dir = path.dirname(file);
  let contract;
  try { contract = yaml.load(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { errors: [`lecture du contrat impossible : ${e.message}`], warnings };
  }

  // 1. Schéma
  const schema = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'assets', 'controls.schema.json'), 'utf8'));
  const schemaErrors = validate(schema, contract);
  if (schemaErrors.length) return { contract, dir, errors: schemaErrors.map((e) => `schéma — ${e}`), warnings };

  // 2. Agent source
  const agentFile = path.resolve(dir, contract.agent.definition);
  let agent = null;
  if (!fs.existsSync(agentFile)) errors.push(`agent introuvable : ${agentFile}`);
  else {
    agent = readAgent(agentFile);
    const sha = sha256File(agentFile);
    if (!contract.agent.source_sha256) errors.push(`agent.source_sha256 absent ; valeur actuelle du fichier : ${sha}`);
    else if (contract.agent.source_sha256 !== sha) errors.push(`l'agent a changé depuis l'analyse (empreinte ${sha}) : reprends à la phase 1`);
    if (agent.id !== contract.agent.name) errors.push(`agent.name « ${contract.agent.name} » ≠ identifiant de l'agent « ${agent.id} » : les hooks filtrent sur ce nom`);
  }

  // 3. Identifiants uniques et couverture
  const fmIds = contract.failure_modes.map((f) => f.id);
  const dup = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
  for (const d of new Set(dup(fmIds))) errors.push(`mode de défaillance en double : ${d}`);
  const ctrlIds = contract.controls.map((c) => c.id);
  for (const d of new Set(dup(ctrlIds))) errors.push(`contrôle en double : ${d}`);
  const criteria = contract.reviewer?.criteria || [];
  for (const d of new Set(dup(criteria.map((c) => c.id)))) errors.push(`critère en double : ${d}`);

  const coveredBy = new Map(fmIds.map((id) => [id, []]));
  const cover = (refs, who) => refs.forEach((r) => {
    if (!coveredBy.has(r)) errors.push(`${who} couvre ${r}, qui n'existe pas`);
    else coveredBy.get(r).push(who);
  });
  contract.controls.forEach((c) => cover(c.covers, c.id));
  criteria.forEach((c) => cover(c.covers, `reviewer ${c.id}`));
  if (contract.blocked_exit?.check) cover(contract.blocked_exit.check.covers, 'blocked_exit');
  for (const [id, by] of coveredBy) if (!by.length) errors.push(`${id} n'est couvert par aucun contrôle ni critère`);

  // 4. Contrôles
  const loadFixture = (f, owner) => {
    const p = path.resolve(dir, f.input);
    if (!fs.existsSync(p)) { errors.push(`${owner} : fixture introuvable ${f.input}`); return null; }
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { errors.push(`${owner} : fixture ${f.input} illisible (${e.message})`); return null; }
  };
  for (const c of contract.controls) {
    const exp = c.fixtures.map((f) => f.expect);
    if (!exp.some((e) => e === 'allow')) errors.push(`${c.id} : aucune fixture qui doit passer`);
    if (!exp.some((e) => BLOCKING.has(e))) errors.push(`${c.id} : aucune fixture qui doit bloquer`);
    for (const f of c.fixtures) {
      if (!EXPECT[c.event].includes(f.expect)) errors.push(`${c.id} : expect « ${f.expect} » incohérent avec ${c.event}`);
      const fx = loadFixture(f, c.id);
      if (fx && fx.event && fx.event !== c.event) errors.push(`${c.id} : la fixture ${f.name} simule ${fx.event} au lieu de ${c.event}`);
    }
    if (c.check.type === 'require-file' && !c.match.paths) errors.push(`${c.id} : require-file exige match.paths`);
    if (c.check.type === 'deny-command') {
      for (const p of c.check.patterns) { try { compileRegex(p); } catch (e) { errors.push(`${c.id} : expression invalide ${p} (${e.message})`); } }
    }
    if (c.check.type === 'custom' && !fs.existsSync(path.resolve(dir, c.check.module))) errors.push(`${c.id} : module ${c.check.module} introuvable`);
    if (c.check.type === 'content') {
      if (!(c.check.require || []).length && !(c.check.forbid || []).length) errors.push(`${c.id} : content sans require ni forbid`);
      for (const p of [...(c.check.require || []), ...(c.check.forbid || [])]) { try { compileRegex(p); } catch (e) { errors.push(`${c.id} : expression invalide ${p} (${e.message})`); } }
      if (c.event === 'PreToolUse') warnings.push(`${c.id} : en PreToolUse, seul le contenu transmis par l'outil est vu (une édition partielle n'est pas le fichier complet) ; PostToolUse est plus fiable`);
    }
    if (c.check.type === 'schema') {
      const sp = path.resolve(dir, c.check.schema);
      if (!path.posix.normalize(c.check.schema).startsWith('schemas/')) errors.push(`${c.id} : le schéma doit être dans schemas/`);
      else if (!fs.existsSync(sp)) errors.push(`${c.id} : schéma ${c.check.schema} introuvable`);
      else { try { JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (e) { errors.push(`${c.id} : schéma illisible (${e.message})`); } }
    }
    if (c.check.type === 'allow-paths' && !c.match.paths) warnings.push(`${c.id} : allow-paths sans match.paths s'applique à tous les chemins écrits`);
    for (const pat of [...(c.check.type === 'allow-command' ? c.check.patterns : []), ...(c.check.allow_changed || [])]) {
      try { compileRegex(pat); } catch (e) { errors.push(`${c.id} : expression invalide ${pat} (${e.message})`); }
    }
    if (c.check.type === 'append-only' && c.event === 'PreToolUse') errors.push(`${c.id} : append-only compare le fichier écrit à la baseline : PostToolUse ou SubagentStop`);
    if (c.check.type === 'allow-command' && !(c.match.tools || []).includes('shell.exec')) warnings.push(`${c.id} : allow-command sans match.tools [shell.exec]`);
    if (c.check.type === 'require-changed' && c.event !== 'SubagentStop') errors.push(`${c.id} : require-changed ne s'utilise qu'en SubagentStop`);
    for (const m of c.only_in_modes || []) if (!(contract.modes || []).some((x) => x.name === m)) errors.push(`${c.id} : mode inconnu ${m}`);
    if (c.check.type === 'custom' && !path.posix.normalize(c.check.module).startsWith('checks/')) errors.push(`${c.id} : les modules custom doivent être dans checks/`);
    if (c.event === 'PostToolUse' && contract.agent.clients.some((x) => x.startsWith('copilot'))) {
      warnings.push(`${c.id} : sous Copilot, un PostToolUse ne bloque pas ; il sera rejoué et imposé au SubagentStop`);
    }
  }
  // Lentilles et sévérités
  const lenses = contract.reviewer?.lenses || [];
  for (const d of new Set(dup(lenses.map((l) => l.name)))) errors.push(`lentille en double : ${d}`);
  for (const c of criteria) {
    if (lenses.length && !c.lens) errors.push(`reviewer ${c.id} : lentille obligatoire quand des lentilles sont déclarées`);
    if (c.lens && !lenses.some((l) => l.name === c.lens)) errors.push(`reviewer ${c.id} : lentille inconnue ${c.lens}`);
    const blockOn = contract.reviewer.block_on || ['blocker', 'high', 'medium'];
    if (!blockOn.includes(c.severity || 'high')) warnings.push(`reviewer ${c.id} (${c.severity}) ne bloque jamais : il est seulement consigné`);
  }
  for (const l of lenses) if (!criteria.some((c) => c.lens === l.name)) errors.push(`lentille ${l.name} sans critère`);
  for (const k of contract.reviewer?.knowledge || []) {
    if (!path.posix.normalize(k.path).startsWith('knowledge/')) errors.push(`connaissance ${k.path} : doit être dans knowledge/`);
    else if (!fs.existsSync(path.resolve(dir, k.path))) errors.push(`connaissance ${k.path} introuvable`);
    else if (fs.statSync(path.resolve(dir, k.path)).size > 40000) warnings.push(`connaissance ${k.path} : plus de 40 Ko, elle sera tronquée dans le prompt`);
    for (const ln of k.lenses || []) if (lenses.length && !lenses.some((l) => l.name === ln)) errors.push(`connaissance ${k.path} : lentille inconnue ${ln}`);
  }
  if (contract.report) {
    const rp = contract.report.path;
    if (path.isAbsolute(rp) || rp.startsWith('..') || rp.startsWith('.agent-controls')) errors.push(`report.path doit être relatif au projet, hors de .agent-controls : ${rp}`);
    if (!rp.includes('{run}')) warnings.push('report.path sans {run} : chaque run écrasera le rapport du précédent');
  }

  for (const c of criteria) for (const m of c.only_in_modes || []) if (!(contract.modes || []).some((x) => x.name === m)) errors.push(`reviewer ${c.id} : mode inconnu ${m}`);
  const bc = contract.blocked_exit?.check;
  if (bc) {
    if (!fs.existsSync(path.resolve(dir, bc.module))) errors.push(`blocked_exit : module ${bc.module} introuvable`);
    if (!path.posix.normalize(bc.module).startsWith('checks/')) errors.push('blocked_exit : le module doit être dans checks/');
    const exp = bc.fixtures.map((f) => f.expect);
    if (!exp.includes('allow') || !exp.includes('block')) errors.push('blocked_exit : il faut au moins une fixture « allow » et une « block »');
    for (const f of bc.fixtures) {
      const fx = loadFixture(f, 'blocked_exit');
      if (fx && !fx.final_message) errors.push(`blocked_exit : la fixture ${f.name} n'a pas de final_message`);
    }
  }
  if (contract.reviewer) {
    const exp = contract.reviewer.fixtures.map((f) => f.expect);
    if (!exp.includes('allow') || !exp.includes('block')) errors.push('reviewer : il faut au moins une fixture « allow » et une « block »');
    for (const f of contract.reviewer.fixtures) {
      if (!['allow', 'block'].includes(f.expect)) errors.push(`reviewer : expect « ${f.expect} » incohérent`);
      const fx = loadFixture(f, 'reviewer');
      if (fx && !fx.mock_verdict && !fx.live) errors.push(`reviewer : la fixture ${f.name} n'a ni mock_verdict ni live`);
    }
    const live = contract.reviewer.fixtures.map((f) => ({ f, fx: loadFixture(f, 'reviewer') })).filter((x) => x.fx?.live);
    if (!live.some((x) => x.f.expect === 'allow') || !live.some((x) => x.f.expect === 'block')) {
      errors.push('reviewer : il faut au moins une fixture live « allow » et une « block » — sans elles, le jugement réel n\'est jamais vérifié');
    }
    for (const x of live) if (x.fx.mock_verdict) errors.push(`reviewer : la fixture live ${x.f.name} ne doit pas avoir de mock_verdict`);
    if (!contract.reviewer.model) warnings.push('reviewer.model absent : le reviewer utilisera le modèle par défaut du client');
    else if (agent?.model && [contract.reviewer.model, contract.reviewer.model?.claude, contract.reviewer.model?.copilot].includes(agent.model)) warnings.push('le reviewer utilise le même modèle que l\'agent : risque d\'auto-complaisance');
  }

  // 4 ter. Contrôles reportés : ils documentent un durcissement futur, ils ne couvrent rien.
  for (const d of contract.deferred || []) {
    for (const r of d.covers) if (!coveredBy.has(r)) errors.push(`${d.id} vise ${r}, qui n'existe pas`);
  }
  for (const d of new Set(dup((contract.deferred || []).map((d) => d.id)))) errors.push(`contrôle reporté en double : ${d}`);
  if ((contract.deferred || []).length) warnings.push(`${contract.deferred.length} contrôle(s) reporté(s) faute d'exemple : ${contract.deferred.map((d) => d.id).join(', ')}`);

  // 4 bis. Sortie bloquée et modes
  for (const p of contract.blocked_exit?.patterns || []) {
    try { compileRegex(p); } catch (e) { errors.push(`blocked_exit : expression invalide ${p} (${e.message})`); }
  }
  const knownIds = new Set([...ctrlIds, ...criteria.map((c) => c.id)]);
  for (const m of contract.modes || []) {
    try { compileRegex(m.task_pattern); } catch (e) { errors.push(`mode ${m.name} : expression invalide (${e.message})`); }
    for (const id of m.disable) if (!knownIds.has(id)) errors.push(`mode ${m.name} : ${id} n'existe pas`);
  }
  for (const d of new Set(dup((contract.modes || []).map((m) => m.name)))) errors.push(`mode en double : ${d}`);
  if (contract.blocked_exit && !contract.reviewer) warnings.push('blocked_exit sans reviewer : il ne sert qu\'à vérifier qu\'une sortie bloquée n\'a rien modifié');

  // 5. Exigences sur les modes critiques
  for (const fm of contract.failure_modes.filter((f) => f.severity === 'critical')) {
    const hooks = contract.controls.filter((c) => c.covers.includes(fm.id));
    if (!hooks.length) warnings.push(`${fm.id} (critique) n'est couvert que par le reviewer : jugement LLM, pas enforcement`);
    else if (!hooks.some((c) => c.on_error === 'block')) warnings.push(`${fm.id} (critique) : aucun de ses hooks n'a on_error: block`);
  }
  if ((contract.uncovered_sources || []).length) warnings.push(`${contract.uncovered_sources.length} source(s) de règles non fournie(s) : ${contract.uncovered_sources.map((u) => u.name).join(', ')} — leurs règles ne sont pas contrôlées`);
  if (contract.failure_modes.length > 20) warnings.push(`${contract.failure_modes.length} modes de défaillance : regroupe`);

  return { contract, dir, file, agentFile, agent, errors, warnings };
}
