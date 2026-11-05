#!/usr/bin/env node
// Phase 1 (dossier) : scanne un dossier contenant des agents et des skills, inspecte chaque
// agent (réutilise inspect_agent.mjs), et propose une matrice de rattachement skill → agent.
//   node inspect_folder.mjs <dossier> [--json]
// Ne décide rien : signale les asymétries (skill orphelin, skill manquant, skill partagé par
// plusieurs agents) et attend une validation humaine avant toute génération de contrat.
import fs from 'node:fs';
import path from 'node:path';
import { readAgent, collectDeclaredSkills } from './lib/agentfile.mjs';
import { sha256File } from './lib/contract.mjs';

const root = process.argv[2];
if (!root) { console.error('usage : node inspect_folder.mjs <dossier> [--json]'); process.exit(2); }
const rootAbs = path.resolve(root);
if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) { console.error(`${rootAbs} n'est pas un dossier existant.`); process.exit(2); }

// Dossiers à ne jamais descendre : sorties déjà générées par ce skill, VCS, dépendances.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.agent-controls']);
// Un dossier *.controls (contrat déjà produit pour un agent) n'est pas lui-même un agent à inspecter.
const isControlsDir = (p) => p.endsWith('.controls');

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || isControlsDir(full)) continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full, entry.name);
    }
  }
}

// --- 1. Découverte brute : fichiers d'agent candidats + fichiers SKILL.md ---
const agentFiles = [];
const skillFiles = [];
walk(rootAbs, (full, name) => {
  if (name === 'SKILL.md') { skillFiles.push(full); return; }
  if (name.endsWith('.agent.md')) { agentFiles.push(full); return; }
  if (name.endsWith('.md')) {
    // Un .md est un candidat agent seulement s'il a un frontmatter avec `name` ou `description`
    // (évite de confondre un README, un ADR ou une doc de skill avec un agent).
    const text = fs.readFileSync(full, 'utf8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (m && /^(name|description)\s*:/m.test(m[1])) agentFiles.push(full);
  }
});

// --- 2. Inspection de chaque agent détecté (réutilise la logique d'inspect_agent.mjs) ---
const agents = agentFiles.map((file) => {
  const agent = readAgent(file);
  return {
    file: path.relative(rootAbs, file),
    name: agent.id,
    format: agent.format,
    source_sha256: sha256File(file),
    declared_skills: collectDeclaredSkills(agent),
  };
});

// --- 3. Skills présents dans le dossier : nom = nom du dossier parent de SKILL.md ---
const skills = skillFiles.map((file) => ({
  name: path.basename(path.dirname(file)),
  file: path.relative(rootAbs, file),
}));
const skillNamesFound = new Set(skills.map((s) => s.name));

// --- 4. Mapping proposé : skill déclaré → agents qui le déclarent ---
const declaredBy = new Map(); // skillName -> [agentName]
for (const a of agents) {
  for (const s of a.declared_skills) {
    if (!declaredBy.has(s)) declaredBy.set(s, []);
    declaredBy.get(s).push(a.name);
  }
}

const mapping = [...declaredBy.entries()].map(([skill, declaringAgents]) => ({
  skill,
  agents: declaringAgents,
  present_in_folder: skillNamesFound.has(skill),
  shared: declaringAgents.length > 1,
}));

// Skills présents dans le dossier mais jamais déclarés par un agent détecté : orphelins.
const orphanSkills = skills.filter((s) => !declaredBy.has(s.name)).map((s) => s.name);

const result = {
  root: rootAbs,
  agents,
  skills,
  mapping,
  orphan_skills: orphanSkills,
};

if (process.argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

console.log(`Dossier : ${rootAbs}`);
console.log(`\nAgents détectés (${agents.length}) :`);
for (const a of agents) console.log(`  ${a.name.padEnd(28)} ${a.format.padEnd(8)} ${a.file}`);
if (!agents.length) console.log('  aucun');

console.log(`\nSkills détectés (${skills.length}) :`);
for (const s of skills) console.log(`  ${s.name.padEnd(28)} ${s.file}`);
if (!skills.length) console.log('  aucun');

console.log('\nMatrice de rattachement proposée (à valider, rien n\'est appliqué automatiquement) :');
if (!mapping.length) console.log('  aucun skill déclaré par les agents détectés');
for (const m of mapping) {
  const flags = [
    !m.present_in_folder ? '⚠ absent du dossier (reste en uncovered_sources)' : null,
    m.shared ? '⚠ partagé : vérifier la cohérence des règles entre agents' : null,
  ].filter(Boolean).join(' — ');
  console.log(`  ${m.skill.padEnd(28)} ← ${m.agents.join(', ')}${flags ? `  ${flags}` : ''}`);
}

if (orphanSkills.length) {
  console.log(`\n⚠ Skill(s) présent(s) dans le dossier mais déclaré(s) par aucun agent détecté : ${orphanSkills.join(', ')}`);
  console.log('  → orphelins : à clarifier avec l\'utilisateur avant de les rattacher à un agent.');
}

console.log('\nPoint d\'arrêt : cette matrice est une proposition. Aucun contrat n\'est généré tant qu\'elle n\'est pas validée par l\'utilisateur.');
