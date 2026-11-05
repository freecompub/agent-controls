// Contrôles prédéfinis et modules custom.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { globToRegExp } from './glob.mjs';
import { compileRegex, fillTemplate, mask, truncate } from './util.mjs';
import { validate as validateSchema } from './jsonschema.mjs';

/**
 * Exécute le contrôle. Retourne { ok: true } ou { ok: false, details }.
 * Lève une exception en cas d'erreur du contrôle lui-même : l'appelant applique on_error.
 * ctx : { projectDir, pluginRoot, agent, event, tool, paths, content, command, remaining() }
 */
export async function runCheck(control, ctx) {
  const c = control.check;
  switch (c.type) {
    case 'deny-path': {
      const hits = ctx.paths.filter((p) => c.patterns.some((g) => globToRegExp(g).test(p)));
      return hits.length ? { ok: false, details: `chemin(s) interdit(s) : ${hits.join(', ')}` } : { ok: true };
    }
    case 'allow-paths': {
      const outside = ctx.paths.filter((p) => !c.patterns.some((g) => globToRegExp(g).test(p)));
      return outside.length ? { ok: false, details: `hors du périmètre autorisé : ${outside.join(', ')}` } : { ok: true };
    }
    case 'content': {
      const problems = [];
      const targets = ctx.paths.length ? ctx.paths : [null];
      for (const p of targets) {
        const abs = p ? path.join(ctx.projectDir, p) : null;
        const text = abs && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ctx.content;
        if (typeof text !== 'string') throw new Error(`contenu introuvable pour ${p ?? 'l\'appel'}`);
        for (const pat of c.require || []) {
          if (!compileRegex(pat).test(text)) problems.push(`${p ?? ''} : motif requis absent ${pat}`.trim());
        }
        for (const pat of c.forbid || []) {
          const re = compileRegex(pat);
          const lines = text.split(/\r?\n/);
          const i = lines.findIndex((l) => re.test(l));
          const hit = i >= 0 ? i + 1 : (re.test(text) ? 0 : -1);
          if (hit >= 0) problems.push(`${p ?? ''}${hit ? `:${hit}` : ''} : motif interdit ${pat}`.trim());
        }
      }
      return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
    }
    case 'require-changed': {
      const pool = c.scope === 'present'
        ? (g) => listFiles(ctx.projectDir, g)
        : (g) => (ctx.changed || []).filter((p) => globToRegExp(g).test(p));
      const missing = c.patterns.filter((g) => !pool(g).length);
      const what = c.scope === 'present' ? 'aucun fichier présent' : 'aucun fichier modifié';
      return missing.length ? { ok: false, details: `${what} pour : ${missing.join(', ')}` } : { ok: true };
    }
    case 'schema': {
      const schema = JSON.parse(fs.readFileSync(path.join(ctx.pluginRoot, c.schema), 'utf8'));
      const problems = [];
      for (const p of ctx.paths) {
        const abs = path.join(ctx.projectDir, p);
        if (!fs.existsSync(abs)) continue;
        let data;
        try { data = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { problems.push(`${p} : JSON illisible (${e.message})`); continue; }
        for (const err of validateSchema(schema, data).slice(0, 10)) problems.push(`${p} : ${err}`);
      }
      return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
    }
    case 'append-only': {
      // Les lignes existantes à la baseline restent identiques et à leur place ; on ne peut qu'ajouter à la fin.
      // Exception : les lignes qui correspondent à allow_changed peuvent changer (en restant conformes au motif).
      if (!ctx.baseline) throw new Error('baseline indisponible');
      const allowed = (c.allow_changed || []).map(compileRegex);
      const isAllowed = (l) => allowed.some((re) => re.test(l));
      const lines = (t) => t.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
      const problems = [];
      for (const p of ctx.paths) {
        const before = ctx.baseline.read(p);
        if (before === null) continue; // fichier nouveau
        const abs = path.join(ctx.projectDir, p);
        if (!fs.existsSync(abs)) { problems.push(`${p} : fichier existant supprimé`); continue; }
        const b = lines(before); const a = lines(fs.readFileSync(abs, 'utf8'));
        if (a.length < b.length) { problems.push(`${p} : ${b.length - a.length} ligne(s) existante(s) supprimée(s)`); continue; }
        const i = b.findIndex((line, k) => line !== a[k] && !(isAllowed(line) && isAllowed(a[k])));
        if (i >= 0) problems.push(`${p}:${i + 1} : ligne existante modifiée (« ${truncate(b[i], 80)} »)`);
      }
      return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
    }
    case 'allow-command': {
      if (!ctx.command) return { ok: true };
      const first = ctx.command.split(/\r?\n/)[0].trim();
      const unquoted = first.replace(/'[^']*'|"[^"]*"/g, '""');
      if (/&&|\|\||;|\||\$\(|`/.test(unquoted)) return { ok: false, details: 'enchaînement de commandes interdit : une seule commande par appel' };
      return c.patterns.some((pat) => compileRegex(pat).test(first)) ? { ok: true } : { ok: false, details: `commande non autorisée : ${truncate(first, 120)}` };
    }
    case 'require-file': {
      const missing = [];
      for (const p of ctx.paths) {
        const required = fillTemplate(c.path, p);
        if (!fs.existsSync(path.join(ctx.projectDir, required))) missing.push(required);
      }
      return missing.length ? { ok: false, details: `fichier(s) requis absent(s) : ${missing.join(', ')}` } : { ok: true };
    }
    case 'deny-command': {
      if (!ctx.command) return { ok: true };
      for (const pattern of c.patterns) {
        if (compileRegex(pattern).test(ctx.command)) return { ok: false, details: `motif interdit : ${pattern}` };
      }
      return { ok: true };
    }
    case 'run-command': {
      const targets = ctx.paths.length ? ctx.paths : [null];
      const failures = [];
      for (const p of targets) {
        const cmd = p ? fillTemplate(c.command, p, true) : c.command;
        const timeout = Math.max(1, Math.min(c.timeout_ms || 2000, ctx.remaining()));
        const r = spawnSync(cmd, {
          shell: true, cwd: ctx.projectDir, encoding: 'utf8', timeout,
          env: { ...process.env, AGENT_CONTROLS_ROLE: 'check' },
          maxBuffer: 4 * 1024 * 1024, windowsHide: true,
        });
        if (r.error) throw new Error(`commande « ${c.command} » : ${r.error.code || r.error.message}`);
        if (r.status !== 0) failures.push(`${p ?? ''} ${truncate(mask(`${r.stdout || ''}${r.stderr || ''}`).trim(), 400)}`.trim());
      }
      return failures.length ? { ok: false, details: failures.join('\n') } : { ok: true };
    }
    case 'custom': {
      const modPath = path.join(ctx.pluginRoot, c.module);
      const mod = await import(pathToFileURL(modPath).href);
      if (typeof mod.default !== 'function') throw new Error(`${c.module} n'exporte pas de fonction par défaut`);
      const res = await mod.default({
        event: ctx.event, tool: ctx.tool, agent: ctx.agent, projectDir: ctx.projectDir, params: c.params || {},
        input: { paths: ctx.paths, path: ctx.paths[0] ?? null, content: ctx.content, command: ctx.command },
        fs: readOnlyFs(ctx.projectDir),
        baseline: ctx.baseline || null, // { exists(p), read(p), list() } : état du projet au début du run
        changed: ctx.changed || null,
      });
      if (!res || typeof res.ok !== 'boolean') throw new Error(`${c.module} a retourné une valeur invalide`);
      return res.ok ? { ok: true } : { ok: false, details: res.details ? String(res.details) : '' };
    }
    default:
      throw new Error(`type de contrôle inconnu : ${c.type}`);
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.agent-controls', 'bin', 'obj']);

/** Fichiers du projet correspondant à un glob ; le parcours part du préfixe fixe du motif. */
export function listFiles(projectDir, glob) {
  const segs = glob.split('/');
  const fixed = [];
  for (const s of segs) { if (/[*?{]/.test(s)) break; fixed.push(s); }
  const start = path.join(projectDir, ...fixed.slice(0, Math.max(0, fixed.length === segs.length ? fixed.length - 1 : fixed.length)));
  const re = globToRegExp(glob);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 25 || out.length > 1000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, depth + 1); continue; }
      const rel = path.relative(projectDir, abs).split(path.sep).join('/');
      if (re.test(rel)) out.push(rel);
    }
  };
  walk(start, 0);
  return out;
}

function readOnlyFs(projectDir) {
  const abs = (p) => path.join(projectDir, p);
  return {
    exists: (p) => fs.existsSync(abs(p)),
    readText: (p) => fs.readFileSync(abs(p), 'utf8'),
    list: (d) => fs.readdirSync(abs(d)),
  };
}

/**
 * Le contrôle s'applique-t-il à cet événement normalisé ?
 * Retourne { applies, paths, error } — error quand un chemin est nécessaire mais introuvable.
 */
export function applicability(control, n, overridePaths) {
  const m = control.match || {};
  if (m.tools && !overridePaths && !m.tools.includes(n.tool)) return { applies: false };
  const candidates = overridePaths ?? n.input.paths;
  if (!m.paths) return { applies: true, paths: candidates };
  if (!candidates.length) {
    const fileTool = overridePaths ? false : (n.tool === 'file.write' || n.tool === 'file.read');
    return fileTool
      ? { applies: true, paths: [], error: `chemin introuvable dans l'appel à ${n.toolName}` }
      : { applies: false };
  }
  const paths = candidates.filter((p) => m.paths.some((g) => globToRegExp(g).test(p)));
  return paths.length ? { applies: true, paths } : { applies: false };
}

export function formatMessage(control, details, paths = [], isError = false) {
  const msg = control.message || {};
  const fill = (t) => (t && paths[0] ? fillTemplate(t, paths[0]) : t);
  if (isError) {
    return [`[${control.id}] BLOQUÉ — contrôle impossible à évaluer, action refusée par précaution.`,
      `Détails : ${mask(details)}`,
      'Action : reformule l\'action avec un outil standard et un chemin explicite ; si le problème persiste, signale-le.'].join('\n');
  }
  const lines = [`[${control.id}] BLOQUÉ — ${fill(msg.problem) || 'contrôle en échec'}`];
  if (msg.expected) lines.push(`Attendu : ${fill(msg.expected)}`);
  if (msg.action) lines.push(`Action : ${fill(msg.action)}`);
  if (details) lines.push(`Détails : ${mask(details)}`);
  return lines.join('\n');
}
