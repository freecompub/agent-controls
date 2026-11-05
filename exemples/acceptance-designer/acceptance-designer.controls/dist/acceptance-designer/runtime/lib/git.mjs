// Snapshots Git sans toucher à l'index ni à l'historique de l'utilisateur.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(args, cwd, env = {}, timeout = 30000) {
  const r = spawnSync('git', args, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (r.error) throw new Error(`git ${args[0]} : ${r.error.code || r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args[0]} : ${(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
}

export function isRepo(cwd) {
  try { return git(['rev-parse', '--is-inside-work-tree'], cwd, {}, 5000).trim() === 'true'; } catch { return false; }
}

/**
 * Photographie l'arbre de travail (fichiers non suivis compris, .gitignore respecté) dans un index
 * temporaire, et retourne l'identifiant de l'arbre. L'index réel est copié pour accélérer le calcul.
 */
export function snapshot(cwd, indexPath, timeout) {
  const realIndex = path.resolve(cwd, git(['rev-parse', '--git-path', 'index'], cwd, {}, timeout).trim());
  try { fs.copyFileSync(realIndex, indexPath); } catch { /* dépôt sans index : on part de zéro */ }
  const env = { GIT_INDEX_FILE: indexPath };
  git(['add', '-A', '--', '.'], cwd, env, timeout);
  const tree = git(['write-tree'], cwd, env, timeout).trim();
  try { fs.unlinkSync(indexPath); } catch { /* ignore */ }
  return tree;
}

export function diff(cwd, a, b, timeout, excludePrefixes = []) {
  const excludes = excludePrefixes.filter(Boolean).map((p) => `:(exclude)${p}`);
  return git(['diff', '--no-color', '--no-ext-diff', '--no-renames', a, b, ...(excludes.length ? ['--', '.', ...excludes] : [])], cwd, {}, timeout);
}

export function changedFiles(cwd, a, b, timeout) {
  return git(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRT', a, b], cwd, {}, timeout)
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Lecture seule de l'état du projet à la baseline du run (arbre Git), avec cache. */
export function baselineReader(cwd, tree) {
  const cache = new Map();
  const show = (p) => {
    if (!tree) return null;
    if (cache.has(p)) return cache.get(p);
    const r = spawnSync('git', ['show', `${tree}:${p}`], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const v = r.status === 0 ? r.stdout : null;
    cache.set(p, v);
    return v;
  };
  const list = () => {
    if (!tree) return [];
    const r = spawnSync('git', ['ls-tree', '-r', '--name-only', tree], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  };
  let files = null;
  return {
    exists: (p) => { files ??= new Set(list()); return files.has(p); },
    read: (p) => show(p),
    list: () => { files ??= new Set(list()); return [...files]; },
  };
}
